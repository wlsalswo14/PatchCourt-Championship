import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
  ContractError,
  CourtOrchestrator,
  RUN_EVENT_TYPES,
  RUN_STATUSES,
  contentHash,
  isTerminal,
  normalizeTaskText,
  sha256,
  type CourtRun,
  type FrozenTaskContract,
  type RunRequest,
} from "@patchcourt/core";

import { ArtifactStore } from "./artifact-store.js";
import { PlaywrightEvidenceCollector } from "./browser-collector.js";
import { canonicalReceipt } from "./canonical-receipt.js";
import { CANONICAL_USER_TASK, DEFAULT_TARGET_URL, EXECUTION_MODE, GEMINI_DESIGN_MODEL, TASK_CONTRACT_VERSION } from "./constants.js";
import {
  DeterministicBlindJudge,
  DeterministicRegressionEvaluator,
  ManifestSnapshotter,
  ReferenceCandidatePatcher,
  offlineCritics,
} from "./demo-adapters.js";
import { EventBroker } from "./event-broker.js";
import { FileRunRepository } from "./file-repository.js";
import { GeminiBlindJudge, GeminiCandidatePatcher, GeminiJsonClient, liveGeminiCritics } from "./gemini.js";
import { authoritativeTask, ManifestClient } from "./manifest.js";
import { TargetPolicy } from "./target-policy.js";

class ApiIds {
  next(prefix: string): string {
    return prefix === "run" ? `pc01-${randomUUID()}` : `${prefix}-${randomUUID()}`;
  }
}

class SerialRunQueue {
  #tail: Promise<void> = Promise.resolve();
  readonly #jobs = new Map<string, Promise<CourtRun>>();

  enqueue(runId: string, operation: () => Promise<CourtRun>, broker: EventBroker): void {
    const job = this.#tail
      .catch(() => undefined)
      .then(operation);
    this.#tail = job.then(() => undefined, () => undefined);
    this.#jobs.set(runId, job);
    void job.then((run) => broker.receiptReady(run)).finally(() => this.#jobs.delete(runId));
  }

  async wait(runId: string): Promise<CourtRun | undefined> {
    return this.#jobs.get(runId);
  }
}

export interface ServiceOptions {
  runtimeRoot?: string;
  mode?: "offline-demo" | "live-gemini";
  geminiApiKey?: string;
  geminiModel?: string;
  ownedOrigins?: string[];
}

export class PatchCourtService {
  readonly policy: TargetPolicy;
  readonly manifests: ManifestClient;
  readonly broker = new EventBroker();
  readonly artifacts: ArtifactStore;
  readonly repository: FileRunRepository;
  readonly orchestrator: CourtOrchestrator;
  readonly mode: "offline-demo" | "live-gemini";
  readonly model: string | null;
  readonly #queue = new SerialRunQueue();

  constructor(options: ServiceOptions = {}) {
    const runtimeRoot = resolve(options.runtimeRoot ?? process.env.PATCHCOURT_RUNTIME_ROOT ?? resolve(process.cwd(), "runtime"));
    this.policy = new TargetPolicy(options.ownedOrigins);
    this.manifests = new ManifestClient(this.policy);
    this.mode = options.mode ?? EXECUTION_MODE;
    this.artifacts = new ArtifactStore(resolve(runtimeRoot, "artifacts"));
    this.repository = new FileRunRepository(resolve(runtimeRoot, "runs"));
    const snapshotter = new ManifestSnapshotter(this.manifests);
    const collector = new PlaywrightEvidenceCollector(this.manifests, this.artifacts);
    const regression = new DeterministicRegressionEvaluator(this.artifacts);
    if (this.mode === "live-gemini") {
      const client = new GeminiJsonClient({ apiKey: options.geminiApiKey, model: options.geminiModel });
      this.model = client.model;
      this.orchestrator = new CourtOrchestrator(this.repository, {
        snapshotter,
        collector,
        critics: [...offlineCritics(), ...liveGeminiCritics(client, this.artifacts)],
        patcher: new GeminiCandidatePatcher(client, this.manifests, this.artifacts, this.policy),
        regression,
        judge: new GeminiBlindJudge(client, this.artifacts),
      }, {
        ids: new ApiIds(),
        onEvent: (event, run) => this.broker.publish(event, run),
        executionMetadata: {
          mode: "live-gemini",
          criticProvider: "patchcourt:three-role-metric-critics-v1+google:three-role-grounded-court",
          patchProvider: "google:value-only-isolated-candidate",
          judgeProvider: "google:blinded-multimodal-pairwise",
          model: client.model,
        },
      });
    } else {
      this.model = null;
      this.orchestrator = new CourtOrchestrator(this.repository, {
        snapshotter,
        collector,
        critics: offlineCritics(),
        patcher: new ReferenceCandidatePatcher(this.manifests, this.policy),
        regression,
        judge: new DeterministicBlindJudge(),
      }, {
        ids: new ApiIds(),
        onEvent: (event, run) => this.broker.publish(event, run),
        executionMetadata: {
          mode: "offline-demo",
          criticProvider: "patchcourt:three-role-metric-critics-v1",
          patchProvider: "patchcourt:prebuilt-reference-candidate-v1",
          judgeProvider: "patchcourt:paired-outcome-v1",
          model: null,
        },
      });
    }
  }

  capabilities() {
    return {
      schemaVersion: 1,
      executionMode: this.mode,
      designAuthority: { provider: "google", model: GEMINI_DESIGN_MODEL },
      runtimeModel: this.model,
      syntheticFixtureOnly: true,
      activeSecurityTesting: false,
      defaultTargetUrl: DEFAULT_TARGET_URL,
      canonicalUserTask: CANONICAL_USER_TASK,
      taskContractVersion: TASK_CONTRACT_VERSION,
      statuses: RUN_STATUSES,
      streams: ["server-sent-events"],
      eventStream: {
        transport: "server-sent-events",
        urlTemplate: "/api/runs/{runId}/events",
        namedEvents: [...RUN_EVENT_TYPES, "receipt_ready"],
        heartbeatSeconds: 15,
      },
      receiptEndpointTemplate: "/api/runs/{runId}/receipt",
      receipts: ["pc01-canonical", "sha256-chain-v1"],
      claimBoundary: this.mode === "offline-demo"
        ? "Deterministic recorded/reference candidate replay; no claim of live AI patch generation"
        : "Live Gemini critics, value-only isolated patch synthesis, and blinded multimodal judgment against the synthetic owned fixture",
    };
  }

  async create(request: RunRequest): Promise<CourtRun> {
    this.policy.assertAllowed(request.targetUrl);
    if (request.taskContractVersion && request.taskContractVersion !== TASK_CONTRACT_VERSION) {
      throw new ContractError(`unsupported task contract version: ${request.taskContractVersion}`);
    }
    let task: FrozenTaskContract | undefined;
    try {
      const manifest = await this.manifests.load(request.targetUrl);
      if (normalizeTaskText(request.userTask) === CANONICAL_USER_TASK) task = authoritativeTask(request.userTask, manifest);
    } catch {
      // The run is still created so snapshotting records a durable invalid receipt.
    }
    const run = await this.orchestrator.create(request, task);
    this.#queue.enqueue(run.id, () => this.orchestrator.execute(run.id), this.broker);
    return run;
  }

  async get(runId: string): Promise<CourtRun> {
    return this.orchestrator.get(runId);
  }

  async list(): Promise<CourtRun[]> {
    return this.orchestrator.list();
  }

  async cancel(runId: string): Promise<CourtRun> {
    return this.orchestrator.cancel(runId);
  }

  async wait(runId: string): Promise<CourtRun> {
    const queued = await this.#queue.wait(runId);
    return queued ?? this.get(runId);
  }

  async receipt(runId: string): Promise<unknown> {
    const run = await this.get(runId);
    if (!isTerminal(run.status) || !run.receipt) throw new ContractError("run receipt is not ready");
    if (!run.decision || !run.comparison || !run.regression) return run.receipt;
    for (const artifact of run.evidence) {
      const stored = await this.artifacts.read(artifact.id);
      if (sha256(stored.bytes) !== artifact.sha256) throw new ContractError(`receipt artifact bytes do not match the sealed run: ${artifact.id}`);
    }
    if (run.patch?.groundingArtifactId) {
      const grounding = await this.artifacts.read(run.patch.groundingArtifactId);
      if (!run.patch.groundingArtifactSha256 || sha256(grounding.bytes) !== run.patch.groundingArtifactSha256) {
        throw new ContractError("receipt grounding artifact bytes do not match the sealed patch");
      }
    }
    const previous = (await this.list())
      .filter((candidate) => candidate.id !== run.id && candidate.createdAt < run.createdAt && candidate.decision && candidate.receipt && candidate.snapshot?.verifiedFactsDigest)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    const previousHash = previous ? contentHash(canonicalReceipt(previous)) : null;
    return canonicalReceipt(run, previousHash);
  }

  async demoRun(slug: string): Promise<{ runId: string; status: CourtRun["status"]; receipt: unknown } | undefined> {
    const run = (await this.list()).find((candidate) => candidate.demoSlug === slug && isTerminal(candidate.status));
    if (!run) return undefined;
    return { runId: run.id, status: run.status, receipt: await this.receipt(run.id) };
  }
}
