import { randomUUID } from "node:crypto";

import { CancellationError, ContractError, LifecycleError, NotFoundError } from "./errors.js";
import { buildCriticProvenanceProof, compileFindings } from "./feedback.js";
import { appendEvent, appendReceipt, contentHash, redactText } from "./hash.js";
import { decidePromotion } from "./promotion.js";
import { assertTransition, isTerminal } from "./state-machine.js";
import { createFrozenTask, validateFrozenTaskOverride, validatePatchCandidate, validateRunRequest, validateSnapshot } from "./contracts.js";
import type {
  BlindArm,
  BlindComparison,
  BlindLabel,
  BlindJudgeValidationRepair,
  CourtRun,
  CriticFindingInput,
  EvidenceArtifact,
  FrozenTaskContract,
  JourneyEvidence,
  JsonValue,
  RunEventType,
  RunFailure,
  RunRequest,
  RunStatus,
  TerminalReceipt,
  TerminalRunStatus,
  Variant,
} from "./types.js";
import type { CourtAdapters, OrchestratorOptions, RunRepository } from "./ports.js";

const SHA256 = /^[a-f0-9]{64}$/;

const codeUnitCompare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function noBlindValidationRepair(): BlindJudgeValidationRepair {
  const payload = { mode: "none" as const, rejectedResponseSha256: null, invalidFields: [] as string[] };
  return { ...payload, digest: contentHash(payload) };
}

function validateBlindInvocationProof(
  invocationCount: number,
  repair: BlindJudgeValidationRepair,
): void {
  if (!Number.isInteger(invocationCount) || invocationCount < 0 || invocationCount > 2) {
    throw new ContractError("blind judge provider invocation count is invalid");
  }
  const sortedFields = [...repair.invalidFields].sort(codeUnitCompare);
  if (repair.invalidFields.length > 16
    || JSON.stringify(repair.invalidFields) !== JSON.stringify(sortedFields)
    || new Set(repair.invalidFields).size !== repair.invalidFields.length
    || repair.invalidFields.some((field) => !/^[a-z][a-zA-Z0-9._-]{0,99}$/.test(field))) {
    throw new ContractError("blind judge validation repair fields are invalid");
  }
  const repaired = repair.mode === "format-completion" || repair.mode === "full-rejudge";
  if ((repair.mode === "none" && (repair.rejectedResponseSha256 !== null || repair.invalidFields.length !== 0 || ![0, 1].includes(invocationCount)))
    || (repaired && (invocationCount !== 2 || !repair.rejectedResponseSha256 || !SHA256.test(repair.rejectedResponseSha256) || repair.invalidFields.length === 0))) {
    throw new ContractError("blind judge validation repair does not match provider invocations");
  }
  const payload = { mode: repair.mode, rejectedResponseSha256: repair.rejectedResponseSha256, invalidFields: repair.invalidFields };
  if (!SHA256.test(repair.digest) || repair.digest !== contentHash(payload)) {
    throw new ContractError("blind judge validation repair digest is invalid");
  }
}

const systemClock = { now: () => new Date().toISOString() };
const uuidGenerator = { next: (prefix: string) => `${prefix}_${randomUUID()}` };

interface MutationEvent {
  type: RunEventType;
  message: string;
  data?: Record<string, JsonValue>;
}

interface MutationReceipt {
  kind: string;
  payload: unknown;
}

function cleanArtifact(artifact: EvidenceArtifact): EvidenceArtifact {
  return {
    ...artifact,
    label: redactText(artifact.label),
    uri: redactText(artifact.uri),
    observation: redactText(artifact.observation),
  };
}

function validateJourney(journey: JourneyEvidence, expectedVariant: Variant, task: FrozenTaskContract): JourneyEvidence {
  if (journey.variant !== expectedVariant) throw new ContractError(`collector returned ${journey.variant} for ${expectedVariant}`);
  if (journey.taskFingerprint !== task.fingerprint) throw new ContractError("collector did not replay the frozen task fingerprint");
  if (journey.steps.length === 0 || journey.artifacts.length === 0) throw new ContractError("browser observation requires steps and evidence artifacts");
  const actualSteps = journey.steps.map((step) => ({ id: step.id, instruction: step.instruction.trim().replace(/\s+/g, " ") }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const expectedSteps = task.steps.map((step) => ({ id: step.id, instruction: step.instruction.trim().replace(/\s+/g, " ") }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (contentHash(actualSteps) !== contentHash(expectedSteps)) throw new ContractError("collector did not execute the exact frozen task steps");
  const ids = new Set<string>();
  const artifacts = journey.artifacts.map((artifact) => {
    if (artifact.variant !== expectedVariant) throw new ContractError("evidence artifact crossed variant boundary");
    if (!SHA256.test(artifact.sha256)) throw new ContractError(`evidence artifact lacks SHA-256: ${artifact.id}`);
    if (ids.has(artifact.id)) throw new ContractError(`duplicate evidence id: ${artifact.id}`);
    ids.add(artifact.id);
    return cleanArtifact(artifact);
  });
  for (const step of journey.steps) {
    if (step.evidenceIds.length === 0 || step.evidenceIds.some((id) => !ids.has(id))) {
      throw new ContractError(`journey step has missing evidence: ${step.id}`);
    }
  }
  const observedViewports = new Set(artifacts.map((artifact) => artifact.viewport));
  for (const viewport of task.viewports) {
    if (!observedViewports.has(viewport.name)) throw new ContractError(`collector omitted frozen viewport: ${viewport.name}`);
  }
  return {
    ...journey,
    targetUrl: redactText(journey.targetUrl),
    steps: journey.steps.map((step) => ({ ...step, observation: redactText(step.observation) })),
    artifacts,
  };
}

function assertSymmetricJourneys(incumbent: JourneyEvidence, candidate: JourneyEvidence): void {
  const shape = (journey: JourneyEvidence) => ({
    steps: journey.steps.map((step) => step.id).sort(),
    artifacts: journey.artifacts
      .map((artifact) => `${artifact.stepId}:${artifact.viewport}:${artifact.kind}`)
      .sort(),
  });
  if (contentHash(shape(incumbent)) !== contentHash(shape(candidate))) {
    throw new ContractError("incumbent and candidate evidence are not structurally symmetric");
  }
}

function blindArm(run: CourtRun, variant: Variant, label: BlindLabel): BlindArm {
  const journey = run.journeys[variant];
  const regression = run.regression;
  if (!journey || !regression) throw new LifecycleError("blind comparison requires two observations and deterministic gates");
  const evidenceIds = journey.artifacts.map((artifact) => artifact.id);
  if (evidenceIds.some((id) => /(?:^|[-_.])(incumbent|candidate)(?:[-_.]|$)/i.test(id))) {
    throw new ContractError("blind evidence identifiers leak variant identity");
  }
  return {
    label,
    taskSucceeded: journey.taskSucceeded,
    dimensionScores: regression.scores[variant],
    evidenceIds,
    gateFacts: regression.gates.map((gate) => ({
      id: gate.id,
      passed: variant === "incumbent" ? gate.incumbentPassed : gate.candidatePassed,
    })),
  };
}

export class CourtOrchestrator {
  readonly #clock;
  readonly #ids;
  readonly #onEvent;
  readonly #taskDefaults;
  readonly #minimumBlindConfidence;
  readonly #executionMetadata;

  constructor(
    readonly repository: RunRepository,
    readonly adapters: CourtAdapters,
    options: OrchestratorOptions = {},
  ) {
    if (adapters.critics.length === 0) throw new ContractError("at least one grounded product critic is required");
    this.#clock = options.clock ?? systemClock;
    this.#ids = options.ids ?? uuidGenerator;
    this.#onEvent = options.onEvent;
    this.#taskDefaults = options.taskDefaults;
    this.#minimumBlindConfidence = options.minimumBlindConfidence;
    this.#executionMetadata = options.executionMetadata ?? {
      mode: "offline-demo",
      criticProvider: "deterministic",
      patchProvider: "deterministic",
      judgeProvider: "deterministic",
      model: null,
    };
  }

  async create(request: RunRequest, authoritativeTask?: FrozenTaskContract): Promise<CourtRun> {
    validateRunRequest(request);
    if (authoritativeTask) validateFrozenTaskOverride(authoritativeTask, request);
    const now = this.#clock.now();
    const run: CourtRun = {
      schemaVersion: 1,
      id: this.#ids.next("run"),
      revision: 0,
      status: "created",
      targetUrl: redactText(request.targetUrl),
      execution: structuredClone(this.#executionMetadata),
      task: authoritativeTask ? structuredClone(authoritativeTask) : createFrozenTask(request, this.#taskDefaults),
      ...(request.demoSlug ? { demoSlug: redactText(request.demoSlug) } : {}),
      createdAt: now,
      updatedAt: now,
      evidence: [],
      journeys: {},
      findings: [],
      events: [],
      receiptLedger: [],
      cancellationRequested: false,
    };
    const receipt = appendReceipt(run.receiptLedger, "run-created", {
      runId: run.id,
      targetUrl: run.targetUrl,
      taskFingerprint: run.task.fingerprint,
    }, now);
    run.receiptLedger.push(receipt);
    const event = appendEvent(run.events, this.#ids.next("evt"), "run_created", run.status, "Court run created and task frozen", {
      runId: run.id,
      taskFingerprint: run.task.fingerprint,
    }, now);
    run.events.push(event);
    await this.repository.create(run);
    await this.#onEvent?.(event, structuredClone(run));
    return structuredClone(run);
  }

  async get(runId: string): Promise<CourtRun> {
    const run = await this.repository.get(runId);
    if (!run) throw new NotFoundError(`run not found: ${runId}`);
    return run;
  }

  async list(): Promise<CourtRun[]> {
    return this.repository.list();
  }

  async cancel(runId: string): Promise<CourtRun> {
    const run = await this.get(runId);
    if (isTerminal(run.status)) return run;
    return this.#invalidate(runId, {
      code: "cancelled_by_user",
      stage: run.status,
      message: "Run cancelled by user; no candidate was promoted",
    });
  }

  async execute(runId: string): Promise<CourtRun> {
    try {
      let run = await this.get(runId);
      if (isTerminal(run.status)) return run;
      if (run.status !== "created") throw new LifecycleError(`run cannot start from ${run.status}`);

      run = await this.#transition(runId, "snapshotting", "Sealing source snapshot", { taskFingerprint: run.task.fingerprint });
      this.#assertActive(run);
      const snapshot = await this.adapters.snapshotter.capture({ runId, targetUrl: run.targetUrl, task: run.task });
      validateSnapshot(snapshot);
      run = await this.#record(runId, (current) => ({ ...current, snapshot }), {
        type: "stage_completed",
        message: "Source snapshot sealed",
        data: { snapshotDigest: snapshot.digest, allowlistedFileCount: snapshot.allowlistedFiles.length },
      }, { kind: "source-snapshot", payload: snapshot });

      run = await this.#transition(runId, "observing_incumbent", "Running frozen task on incumbent", {});
      this.#assertActive(run);
      const incumbent = validateJourney(await this.adapters.collector.collect({
        runId,
        targetUrl: run.targetUrl,
        task: run.task,
        snapshot,
        variant: "incumbent",
      }), "incumbent", run.task);
      run = await this.#record(runId, (current) => ({
        ...current,
        journeys: { ...current.journeys, incumbent },
        evidence: [...current.evidence, ...incumbent.artifacts],
      }), {
        type: "evidence_collected",
        message: "Incumbent browser evidence sealed",
        data: { variant: "incumbent", artifactCount: incumbent.artifacts.length, taskSucceeded: incumbent.taskSucceeded },
      }, { kind: "incumbent-evidence", payload: incumbent });

      run = await this.#transition(runId, "criticizing", "Grounded critics reviewing incumbent evidence", {
        criticCount: this.adapters.critics.length,
      });
      this.#assertActive(run);
      const criticPackets: Array<{ criticId: string; findings: CriticFindingInput[] }> = await Promise.all(
        this.adapters.critics.map(async (critic) => ({
          criticId: critic.id,
          findings: (await critic.review({ runId, task: run.task, snapshot, incumbent }))
            .map((finding) => ({ ...finding, criticId: critic.id })),
        })),
      );

      run = await this.#transition(runId, "compiling_feedback", "Compiling atomic implementation brief", {
        proposedFindingCount: criticPackets.reduce((count, packet) => count + packet.findings.length, 0),
      });
      this.#assertActive(run);
      const brief = compileFindings({
        findings: criticPackets.flatMap((packet) => packet.findings),
        invokedCriticIds: criticPackets.map((packet) => packet.criticId),
        evidence: incumbent.artifacts,
        taskFingerprint: run.task.fingerprint,
        compiledAt: this.#clock.now(),
      });
      run = await this.#record(runId, (current) => ({ ...current, brief, findings: brief.findings }), {
        type: "findings_compiled",
        message: "Only grounded atomic findings entered the patch brief",
        data: { findingCount: brief.findings.length, rejectedFindingCount: brief.rejectedFindings.length, briefDigest: brief.digest },
      }, { kind: "compiled-feedback", payload: brief });

      run = await this.#transition(runId, "patching_candidate", "Applying bounded patch in isolated candidate", {
        briefDigest: brief.digest,
      });
      this.#assertActive(run);
      const patch = await this.adapters.patcher.apply({ runId, targetUrl: run.targetUrl, task: run.task, snapshot, incumbent, brief });
      validatePatchCandidate(patch, snapshot);
      run = await this.#record(runId, (current) => ({ ...current, patch }), {
        type: "patch_applied",
        message: "Candidate patch applied inside the sealed allowlist",
        data: { patchId: patch.id, candidateDigest: patch.candidateDigest, changedFileCount: patch.files.length },
      }, { kind: "candidate-patch", payload: patch });

      run = await this.#transition(runId, "observing_candidate", "Replaying exact frozen task on candidate", {});
      this.#assertActive(run);
      const candidate = validateJourney(await this.adapters.collector.collect({
        runId,
        targetUrl: run.targetUrl,
        task: run.task,
        snapshot,
        patch,
        variant: "candidate",
      }), "candidate", run.task);
      assertSymmetricJourneys(incumbent, candidate);
      run = await this.#record(runId, (current) => ({
        ...current,
        journeys: { ...current.journeys, candidate },
        evidence: [...current.evidence, ...candidate.artifacts],
      }), {
        type: "evidence_collected",
        message: "Candidate browser evidence sealed",
        data: { variant: "candidate", artifactCount: candidate.artifacts.length, taskSucceeded: candidate.taskSucceeded },
      }, { kind: "candidate-evidence", payload: candidate });

      run = await this.#transition(runId, "deterministic_gates", "Evaluating protected critical invariants", {});
      this.#assertActive(run);
      const regression = await this.adapters.regression.evaluate({ runId, task: run.task, incumbent, candidate, patch });
      if (regression.taskFingerprint !== run.task.fingerprint || !regression.exactReplay) {
        throw new ContractError("regression evaluator did not compare the exact frozen task");
      }
      if (regression.gates.length === 0) throw new ContractError("deterministic gate report is empty");
      run = await this.#record(runId, (current) => ({ ...current, regression }), {
        type: "gates_evaluated",
        message: regression.passed ? "All deterministic candidate gates passed" : "Candidate failed one or more deterministic gates",
        data: {
          passed: regression.passed,
          failedCriticalGateCount: regression.gates.filter((gate) => gate.critical && !gate.candidatePassed).length,
        },
      }, { kind: "deterministic-gates", payload: regression });

      run = await this.#transition(runId, "blind_comparison", "Comparing anonymous A/B evidence", {});
      this.#assertActive(run);
      const assignment: Record<Variant, BlindLabel> = parseInt(contentHash({ runId, snapshot: snapshot.digest }).slice(0, 2), 16) % 2 === 0
        ? { incumbent: "A", candidate: "B" }
        : { incumbent: "B", candidate: "A" };
      const mappingNonce = this.#ids.next("blind-nonce");
      const mappingByLabel = assignment.incumbent === "A"
        ? { A: "incumbent", B: "candidate" }
        : { A: "candidate", B: "incumbent" };
      const orderCommitmentSha256 = contentHash({
        mapping: mappingByLabel,
        nonce: mappingNonce,
        taskFingerprint: run.task.fingerprint,
      });
      run = await this.#record(runId, (current) => ({
        ...current,
        blindCommitment: { orderCommitmentSha256, committedAt: this.#clock.now() },
      }), {
        type: "stage_completed",
        message: "Anonymous arm order committed before judgment",
        data: { orderCommitmentSha256 },
      }, { kind: "blind-order-commitment", payload: { orderCommitmentSha256 } });
      const arms = [blindArm(run, "incumbent", assignment.incumbent), blindArm(run, "candidate", assignment.candidate)]
        .sort((left, right) => left.label.localeCompare(right.label)) as [BlindArm, BlindArm];
      const judgeResult = regression.passed
        ? await this.adapters.judge.judge({ userTask: run.task.userTask, taskFingerprint: run.task.fingerprint, arms })
        : {
            winner: "tie" as const,
            confidence: 1,
            rationale: ["Blind preference judgment skipped because deterministic critical gates failed"],
            dimensionDeltas: {},
            judge: {
              kind: "deterministic" as const,
              provider: "patchcourt",
              model: "critical-gate-short-circuit-v1",
              responseId: null,
            },
          };
      const {
        providerInvocationCount,
        validationRepair: suppliedValidationRepair,
        ...verdict
      } = judgeResult;
      const judgeInvocationCount = regression.passed ? providerInvocationCount ?? 1 : 0;
      const validationRepair = suppliedValidationRepair ?? noBlindValidationRepair();
      validateBlindInvocationProof(judgeInvocationCount, validationRepair);
      if (!["A", "B", "tie"].includes(verdict.winner) || verdict.confidence < 0 || verdict.confidence > 1) {
        throw new ContractError("blind judge returned an invalid verdict");
      }
      const comparison: BlindComparison = {
        protocolVersion: 1,
        orderCommitmentSha256,
        mappingNonce,
        judgeInvocationCount,
        validationRepair,
        assignment,
        verdict: {
          ...verdict,
          rationale: verdict.rationale.map(redactText),
        },
        candidateWon: verdict.winner === assignment.candidate,
        evaluatedAt: this.#clock.now(),
      };
      const decision = decidePromotion({
        regression,
        comparison,
        decidedAt: this.#clock.now(),
        minimumConfidence: this.#minimumBlindConfidence,
      });
      run = await this.#record(runId, (current) => ({ ...current, comparison, decision }), {
        type: "comparison_completed",
        message: "Blind comparison completed; arm identity revealed only after verdict",
        data: { winner: verdict.winner, candidateLabel: assignment.candidate, decision: decision.outcome },
      }, { kind: "blind-comparison", payload: comparison });

      run = await this.#transition(runId, decision.outcome, decision.outcome === "promoted"
        ? "Candidate promoted: outcome improved and every critical gate passed"
        : "Candidate rejected: incumbent remains champion", {
        reasons: decision.reasons,
      }, decision);
      return this.#finalizeReceipt(run.id, decision.outcome);
    } catch (error) {
      const current = await this.repository.get(runId);
      if (current && isTerminal(current.status)) return current.receipt ? current : this.#finalizeReceipt(runId, current.status as TerminalRunStatus);
      const failure: RunFailure = error instanceof CancellationError
        ? { code: "cancelled_by_user", stage: current?.status ?? "created", message: "Run cancelled by user; no candidate was promoted" }
        : error instanceof ContractError || error instanceof LifecycleError
          ? { code: "contract_error", stage: current?.status ?? "created", message: redactText(error.message) }
          : { code: "infrastructure_error", stage: current?.status ?? "created", message: "Infrastructure failure prevented a valid comparison" };
      return this.#invalidate(runId, failure);
    }
  }

  #assertActive(run: CourtRun): void {
    if (run.cancellationRequested) throw new CancellationError("run cancellation requested");
    if (isTerminal(run.status)) throw new LifecycleError(`run is already terminal: ${run.status}`);
  }

  async #transition(
    runId: string,
    status: RunStatus,
    message: string,
    data: Record<string, JsonValue>,
    receiptPayload: unknown = data,
  ): Promise<CourtRun> {
    const current = await this.get(runId);
    assertTransition(current.status, status);
    return this.#record(runId, (run) => ({ ...run, status }), {
      type: isTerminal(status) ? "run_terminal" : "stage_started",
      message,
      data,
    }, { kind: isTerminal(status) ? "terminal-decision" : `stage-${status}`, payload: receiptPayload });
  }

  async #record(
    runId: string,
    mutate: (run: CourtRun) => CourtRun,
    eventSpec: MutationEvent,
    receiptSpec: MutationReceipt,
  ): Promise<CourtRun> {
    const current = await this.get(runId);
    const now = this.#clock.now();
    let next = mutate(structuredClone(current));
    const receipt = appendReceipt(next.receiptLedger, receiptSpec.kind, receiptSpec.payload, now);
    const event = appendEvent(next.events, this.#ids.next("evt"), eventSpec.type, next.status, eventSpec.message, eventSpec.data ?? {}, now);
    next = {
      ...next,
      revision: current.revision + 1,
      updatedAt: now,
      receiptLedger: [...next.receiptLedger, receipt],
      events: [...next.events, event],
    };
    await this.repository.save(next, current.revision);
    await this.#onEvent?.(event, structuredClone(next));
    return next;
  }

  async #invalidate(runId: string, failure: RunFailure): Promise<CourtRun> {
    const current = await this.get(runId);
    if (isTerminal(current.status)) return current.receipt ? current : this.#finalizeReceipt(runId, current.status as TerminalRunStatus);
    const run = await this.#transition(runId, "invalid", "Run invalidated; incumbent remains protected", {
      code: failure.code,
      stage: failure.stage,
      message: failure.message,
    }, failure);
    const updated = await this.get(run.id);
    if (!updated.failure) {
      const withFailure = await this.#record(runId, (value) => ({ ...value, failure, cancellationRequested: failure.code === "cancelled_by_user" }), {
        type: "stage_completed",
        message: "Invalid run reason recorded",
        data: { code: failure.code, stage: failure.stage },
      }, { kind: "invalid-run", payload: failure });
      return this.#finalizeReceipt(withFailure.id, "invalid");
    }
    return this.#finalizeReceipt(run.id, "invalid");
  }

  async #finalizeReceipt(runId: string, outcome: TerminalRunStatus): Promise<CourtRun> {
    const current = await this.get(runId);
    if (current.receipt) return current;
    const issuedAt = this.#clock.now();
    const criticProvenance = current.brief ? buildCriticProvenanceProof(current.brief) : null;
    const attestation = {
      runId,
      outcome,
      taskContractVersion: current.task.version,
      taskFingerprint: current.task.fingerprint,
      sourceSnapshotDigest: current.snapshot?.digest ?? null,
      verifiedFactsDigest: current.snapshot?.verifiedFactsDigest ?? null,
      incumbentEvidenceDigest: current.journeys.incumbent ? contentHash(current.journeys.incumbent) : null,
      candidateEvidenceDigest: current.journeys.candidate ? contentHash(current.journeys.candidate) : null,
      patchDigest: current.patch?.candidateDigest ?? null,
      groundingArtifactDigest: current.patch?.groundingArtifactSha256 ?? null,
      criticProvenanceDigest: criticProvenance?.digest ?? null,
      criticProvenance,
      deterministicGateDigest: current.regression ? contentHash(current.regression) : null,
      blindComparisonDigest: current.comparison ? contentHash(current.comparison) : null,
      decisionDigest: contentHash(current.decision ?? current.failure ?? { outcome }),
      execution: current.execution,
    };
    const entry = appendReceipt(current.receiptLedger, "terminal-attestation", attestation, issuedAt);
    const receipt: TerminalReceipt = {
      schemaVersion: 1,
      receiptId: `receipt_${entry.hash.slice(0, 20)}`,
      ...attestation,
      ledgerHead: entry.hash,
      ledgerLength: current.receiptLedger.length + 1,
      issuedAt,
      verification: { algorithm: "sha256-chain-v1", canonicalization: "sorted-json-v1" },
    };
    const next: CourtRun = {
      ...current,
      revision: current.revision + 1,
      updatedAt: issuedAt,
      receiptLedger: [...current.receiptLedger, entry],
      receipt,
    };
    await this.repository.save(next, current.revision);
    return next;
  }
}
