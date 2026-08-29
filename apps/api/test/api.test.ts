import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { ContractError, contentHash, sha256, verifyCriticProvenanceProof, verifyReceiptChain } from "@patchcourt/core";

import { ArtifactStore } from "../src/artifact-store.js";
import { PlaywrightEvidenceCollector } from "../src/browser-collector.js";
import { CANONICAL_USER_TASK } from "../src/constants.js";
import { blindScreenshotShape, GeminiBlindJudge, GeminiCandidatePatcher, GeminiJsonClient, selectBlindScreenshotIds, validateFactualClaims } from "../src/gemini.js";
import { authoritativeTask, ManifestClient } from "../src/manifest.js";
import { ManifestSnapshotter } from "../src/demo-adapters.js";
import { createApiServer } from "../src/server.js";
import { PatchCourtService } from "../src/service.js";
import { TargetPolicy } from "../src/target-policy.js";

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind TCP");
  return address.port;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

test("target policy rejects arbitrary public and credential-bearing targets", () => {
  const policy = new TargetPolicy();
  assert.throws(() => policy.assertAllowed("https://example.com"), ContractError);
  assert.throws(() => policy.assertAllowed("http://127.0.0.1:4173?token=synthetic"), ContractError);
  assert.throws(() => policy.assertAllowed("http://127.0.0.1:4174"), /allowlist/);
  assert.throws(() => policy.assertAllowed("http://127.1:4173"), /alternate|encoded/);
  assert.throws(() => policy.assertAllowed("http://2130706433:4173"), /alternate|encoded/);
  assert.equal(policy.assertAllowed("http://127.0.0.1:4173").origin, "http://127.0.0.1:4173");
});

test("manifest task body is recomputed and tampering is rejected", async () => {
  const task = {
    id: "test-task",
    title: "Test task",
    steps: [{
      id: "step",
      instruction: "Complete the local step",
      actions: [{ kind: "assertVisible", selector: "[data-testid='step']" }],
      capture: true,
    }],
  };
  const patchText = JSON.stringify({
    schemaVersion: 1,
    appId: "test-app",
    kind: "test",
    claimBoundary: "synthetic",
    source: "data/incumbent.json",
    candidate: "data/candidate.json",
    changes: [],
    forbiddenEffects: [],
  });
  const factsText = JSON.stringify({
    schemaVersion: 1,
    appId: "test-app",
    subjectId: "synthetic-subject",
    verifiedAt: "2026-08-30T00:00:00.000Z",
    provenance: { synthetic: true, owned: true, private: false },
    facts: [{ id: "fact-name", field: "creator.name", value: "Synthetic Creator" }],
  });
  let tampered = false;
  const server = createServer((request, response) => {
    if (request.url === "/__patchcourt/patch.json") {
      response.writeHead(200, { "Content-Type": "application/json" });
      return response.end(patchText);
    }
    if (request.url === "/__patchcourt/verified-facts.json") {
      response.writeHead(200, { "Content-Type": "application/json" });
      return response.end(factsText);
    }
    const manifest = {
      schemaVersion: 1,
      appId: "test-app",
      owned: true,
      safety: { loopbackOnly: true, realCredentialsAccepted: false, privateDataAccepted: false, externalEffects: false, mustClearPaths: [] },
      sourceSnapshotDigest: sha256("source"),
      candidateSnapshotDigest: sha256("candidate"),
      patchDigest: sha256(patchText),
      facts: {
        path: "/__patchcourt/verified-facts.json",
        digest: sha256(factsText),
        kind: "synthetic-public-fixture",
        fields: ["creator.name"],
      },
      variants: { incumbent: "/incumbent", candidate: "/candidate" },
      task,
      taskFingerprint: tampered ? sha256("forged") : contentHash(task),
      criticalInvariants: [{ id: "gate", category: "security", description: "Synthetic gate" }],
    };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(manifest));
  });
  const port = await listen(server);
  try {
    const client = new ManifestClient(new TargetPolicy([`http://127.0.0.1:${port}`]));
    const loaded = await client.load(`http://127.0.0.1:${port}`);
    assert.equal(loaded.taskFingerprint, contentHash(task));
    assert.equal((await client.verifiedFacts(`http://127.0.0.1:${port}`, loaded)).rawDigest, sha256(factsText));
    tampered = true;
    await assert.rejects(() => client.load(`http://127.0.0.1:${port}`), /fingerprint/);
  } finally {
    await close(server);
  }
});

test("artifact store verifies actual bytes again on every read", async () => {
  const root = await mkdtemp(join(tmpdir(), "patchcourt-artifacts-"));
  try {
    const store = new ArtifactStore(root);
    const saved = await store.put({
      runId: "pc01-test",
      variant: "candidate",
      viewport: "desktop",
      stepId: "profile",
      kind: "screenshot",
      extension: "png",
      bytes: Buffer.from("synthetic png bytes"),
    });
    assert.equal(sha256((await store.read(saved.id)).bytes), saved.sha256);
    await writeFile(join(root, saved.id), "tampered bytes");
    await assert.rejects(() => store.read(saved.id), /SHA-256/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser evidence blocks same-origin effects and rejects an offscreen mobile CTA even with zero document overflow", async () => {
  const task = {
    id: "adversarial-task",
    title: "Adversarial local safety task",
    steps: [{
      id: "confirm",
      instruction: "Confirm a visible unsent draft",
      actions: [{ kind: "assertVisible", selector: "[data-testid='draft-status']" }],
      capture: true,
    }],
  };
  const factsText = JSON.stringify({
    schemaVersion: 1,
    appId: "adversarial-owned-app",
    subjectId: "synthetic-subject",
    verifiedAt: "2026-08-30T00:00:00.000Z",
    provenance: { synthetic: true, owned: true, private: false },
    facts: [{ id: "safe", field: "fixture.safe", value: "local" }],
  });
  const manifest = {
    schemaVersion: 1,
    appId: "adversarial-owned-app",
    owned: true,
    safety: { loopbackOnly: true, realCredentialsAccepted: false, privateDataAccepted: false, externalEffects: false, mustClearPaths: [] },
    sourceSnapshotDigest: sha256("adversarial-source"),
    candidateSnapshotDigest: sha256("adversarial-candidate"),
    patchDigest: sha256("adversarial-patch"),
    facts: { path: "/__patchcourt/verified-facts.json", digest: sha256(factsText), kind: "synthetic-public-fixture", fields: ["fixture.safe"] },
    variants: { incumbent: "/incumbent", candidate: "/candidate" },
    task,
    taskFingerprint: contentHash(task),
    criticalInvariants: [{ id: "responsive_primary_action", category: "responsive", description: "Primary action stays usable" }],
  };
  const html = `<!doctype html><html><head><style>html,body{overflow:hidden}button{position:fixed;left:calc(100vw + 8px);top:8px;width:48px;height:48px}</style></head><body>
    <label>Message<textarea data-testid="offer-message">Draft</textarea></label>
    <label>Amount<input data-testid="offer-amount" value="1500"></label>
    <button data-testid="prepare-offer">Prepare draft</button><div data-testid="draft-status">Draft - not sent</div>
    <script>fetch('/same-origin-effect',{method:'POST'}).catch(()=>{});</script></body></html>`;
  const server = createServer((request, response) => {
    if (request.url === "/__patchcourt/manifest.json") {
      response.writeHead(200, { "Content-Type": "application/json" });
      return response.end(JSON.stringify(manifest));
    }
    if (request.url === "/__patchcourt/verified-facts.json") {
      response.writeHead(200, { "Content-Type": "application/json" });
      return response.end(factsText);
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
  });
  const port = await listen(server);
  const root = await mkdtemp(join(tmpdir(), "patchcourt-adversarial-"));
  try {
    const origin = `http://127.0.0.1:${port}`;
    const manifests = new ManifestClient(new TargetPolicy([origin]));
    const loaded = await manifests.load(origin);
    const collector = new PlaywrightEvidenceCollector(manifests, new ArtifactStore(root));
    const journey = await collector.collect({
      runId: "pc01-adversarial",
      targetUrl: origin,
      variant: "candidate",
      task: authoritativeTask("Confirm a visible unsent draft", loaded),
      snapshot: {
        benchmarkId: "PC01",
        appId: manifest.appId,
        digest: manifest.sourceSnapshotDigest,
        candidateDigest: manifest.candidateSnapshotDigest,
        patchDigest: manifest.patchDigest,
        verifiedFactsDigest: manifest.facts.digest,
        manifestDigest: contentHash(loaded),
        capturedAt: "2026-08-30T00:00:00.000Z",
        ownedTarget: true,
        allowlistedFiles: ["data/candidate.json"],
      },
    });
    assert.equal(journey.metrics.horizontalOverflowPixels, 0);
    assert.equal(journey.metrics.effectRequestCount, 2);
    assert.equal(journey.metrics.draftOnly, false);
    assert.equal(journey.metrics.responsivePrimaryAction, false);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("secret-file loader accepts design-compatible dotenv GEMMA_API_KEY without logging it", async () => {
  const root = await mkdtemp(join(tmpdir(), "patchcourt-secret-"));
  const file = join(root, "provider.json");
  const previous = process.env.PATCHCOURT_SECRET_FILE;
  const previousEnv = process.env.GEMINI_API_KEY;
  try {
    await writeFile(file, "UNRELATED_SETTING=ignored\nGEMMA_API_KEY='synthetic-key-for-constructor-only'\n");
    delete process.env.GEMINI_API_KEY;
    process.env.PATCHCOURT_SECRET_FILE = file;
    const client = new GeminiJsonClient({ model: "gemini-3.6-flash" });
    assert.equal(client.model, "gemini-3.6-flash");
  } finally {
    if (previous === undefined) delete process.env.PATCHCOURT_SECRET_FILE;
    else process.env.PATCHCOURT_SECRET_FILE = previous;
    if (previousEnv === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousEnv;
    await rm(root, { recursive: true, force: true });
  }
});

test("blind judge selects symmetric high-value inspect and confirm frames without arm names", () => {
  const ids = [
    "art-abc123-desktop-login-screenshot-a.png",
    "art-abc123-desktop-inspect-screenshot-b.png",
    "art-abc123-mobile-inspect-screenshot-c.png",
    "art-abc123-desktop-confirm-screenshot-d.png",
    "art-abc123-mobile-confirm-screenshot-e.png",
  ];
  const selected = selectBlindScreenshotIds(ids);
  assert.deepEqual(selected, ids.slice(1));
  assert.deepEqual(blindScreenshotShape(ids), ["desktop:confirm", "desktop:inspect", "mobile:confirm", "mobile:inspect"]);
  assert.equal(selected.some((id) => /incumbent|candidate/i.test(id)), false);
});

test("blind judge performs one anonymous bounded format repair and seals both provider calls", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "patchcourt-judge-repair-"));
  try {
    const dimensions = {
      taskSuccessClarity: 20,
      decisionUsefulness: 40,
      authoredVisualQuality: 10,
      accessibilityResponsive: 0,
      functionalRegression: 0,
      securityPrivacy: 20,
    };
    class RepairingJudgeClient extends GeminiJsonClient {
      calls: Array<Record<string, any>> = [];
      constructor() { super({ apiKey: "synthetic-constructor-key", model: "gemini-3.6-flash" }); }
      override async generate<T>(input: Record<string, any>): Promise<{ value: T; responseId: string | null; contentSha256: string }> {
        this.calls.push(input);
        const value = this.calls.length === 1
          ? { winner: "B", confidence: 0.91, rationale: "Arm B makes the decision clearer", dimensionDeltas: dimensions }
          : { winner: "B", confidence: 0.91, rationale: ["Arm B makes the decision clearer"], dimensionDeltas: dimensions };
        return { value: value as T, responseId: `synthetic-judge-${this.calls.length}`, contentSha256: sha256(`synthetic-raw-${this.calls.length}`) };
      }
    }
    const client = new RepairingJudgeClient();
    const judge = new GeminiBlindJudge(client, new ArtifactStore(runtime));
    const score = {
      taskSuccessClarity: 50,
      decisionUsefulness: 50,
      authoredVisualQuality: 50,
      accessibilityResponsive: 50,
      functionalRegression: 100,
      securityPrivacy: 100,
    };
    const verdict = await judge.judge({
      userTask: "Choose the clearer anonymous arm",
      taskFingerprint: sha256("anonymous-task"),
      arms: [
        { label: "A", taskSucceeded: true, dimensionScores: score, evidenceIds: [], gateFacts: [] },
        { label: "B", taskSucceeded: true, dimensionScores: score, evidenceIds: [], gateFacts: [] },
      ],
    });
    assert.equal(client.calls.length, 2);
    assert.equal(verdict.providerInvocationCount, 2);
    assert.equal(verdict.winner, "B");
    assert.deepEqual(verdict.rationale, ["Arm B makes the decision clearer"]);
    assert.deepEqual(verdict.validationRepair, {
      mode: "format-completion",
      rejectedResponseSha256: sha256("synthetic-raw-1"),
      invalidFields: ["rationale"],
      digest: contentHash({ mode: "format-completion", rejectedResponseSha256: sha256("synthetic-raw-1"), invalidFields: ["rationale"] }),
    });
    const repairPacket = JSON.stringify(client.calls[1]);
    const repairInstruction = JSON.parse(client.calls[1]?.parts?.[0]?.text ?? "{}") as Record<string, any>;
    assert.equal(repairInstruction.validationRepair.lockedWinner, "B");
    assert.equal(/incumbent|candidate/i.test(repairPacket), false);
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
});

test("blind judge full-rejudges once when the first anonymous winner is invalid", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "patchcourt-judge-rejudge-"));
  try {
    const dimensions = {
      taskSuccessClarity: 10,
      decisionUsefulness: 20,
      authoredVisualQuality: 5,
      accessibilityResponsive: 0,
      functionalRegression: 0,
      securityPrivacy: 10,
    };
    class FullRejudgeClient extends GeminiJsonClient {
      calls: Array<Record<string, any>> = [];
      constructor() { super({ apiKey: "synthetic-constructor-key", model: "gemini-3.6-flash" }); }
      override async generate<T>(input: Record<string, any>): Promise<{ value: T; responseId: string | null; contentSha256: string }> {
        this.calls.push(input);
        const value = this.calls.length === 1
          ? { winner: "candidate", confidence: 0.8, rationale: ["Invalid identity-bearing label"], dimensionDeltas: dimensions }
          : { winner: "A", confidence: 0.8, rationale: ["Anonymous arm A is clearer"], dimensionDeltas: dimensions };
        return { value: value as T, responseId: `synthetic-rejudge-${this.calls.length}`, contentSha256: sha256(`synthetic-rejudge-raw-${this.calls.length}`) };
      }
    }
    const client = new FullRejudgeClient();
    const judge = new GeminiBlindJudge(client, new ArtifactStore(runtime));
    const score = {
      taskSuccessClarity: 50,
      decisionUsefulness: 50,
      authoredVisualQuality: 50,
      accessibilityResponsive: 50,
      functionalRegression: 100,
      securityPrivacy: 100,
    };
    const verdict = await judge.judge({
      userTask: "Choose the clearer anonymous arm",
      taskFingerprint: sha256("anonymous-rejudge-task"),
      arms: [
        { label: "A", taskSucceeded: true, dimensionScores: score, evidenceIds: [], gateFacts: [] },
        { label: "B", taskSucceeded: true, dimensionScores: score, evidenceIds: [], gateFacts: [] },
      ],
    });
    assert.equal(client.calls.length, 2);
    assert.equal(verdict.providerInvocationCount, 2);
    assert.equal(verdict.winner, "A");
    assert.equal(verdict.validationRepair?.mode, "full-rejudge");
    assert.deepEqual(verdict.validationRepair?.invalidFields, ["winner"]);
    const instruction = JSON.parse(client.calls[1]?.parts?.[0]?.text ?? "{}") as Record<string, any>;
    assert.equal(instruction.validationRepair.lockedWinner, null);
    assert.equal(/incumbent|candidate/i.test(JSON.stringify(client.calls[1])), false);
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
});

test("live candidate factual claims must be lexically grounded in referenced sealed facts", () => {
  const incumbent = { trust: { audience: "TBD", channel: "Public channel" } };
  const facts = {
    schemaVersion: 1 as const,
    appId: "test-app",
    subjectId: "synthetic-subject",
    verifiedAt: "2026-08-30T00:00:00.000Z",
    provenance: { synthetic: true as const, owned: true as const, private: false as const },
    facts: [{ id: "audience-us", field: "audience.country.US", value: 68, unit: "percent" }],
  };
  const normalizedGrounding = validateFactualClaims(
    { trust: { audience: "68% US audience", channel: "Public channel" } },
    incumbent,
    facts,
    "Determine the audience",
    [
      { path: "trust.audience", factIds: ["audience-us"] },
      { path: "root.trust.channel", factIds: [] },
    ],
  );
  assert.equal(normalizedGrounding[0]?.path, "root.trust.audience");
  assert.throws(() => validateFactualClaims(
    { trust: { audience: "68% Canada audience", channel: "Public channel" } },
    incumbent,
    facts,
    "Determine the audience",
    [{ path: "root.trust.audience", factIds: ["audience-us"] }],
  ), /unsealed public claim token/);
  assert.throws(() => validateFactualClaims(
    { trust: { audience: "68% US audience", channel: "Public channel" } },
    incumbent,
    facts,
    "Determine the audience",
    [],
  ), /ungrounded path/);
});

test("live patch synthesis performs one bounded repair and seals only digests of the rejected candidate", async () => {
  const demoPath = resolve(process.cwd(), "../../demo/brand-match/server.mjs");
  const demoModule = await import(pathToFileURL(demoPath).href) as { server: Server };
  const demo = demoModule.server;
  const port = await listen(demo);
  const runtime = await mkdtemp(join(tmpdir(), "patchcourt-repair-"));
  try {
    const origin = `http://127.0.0.1:${port}`;
    const policy = new TargetPolicy([origin]);
    const manifests = new ManifestClient(policy);
    const manifest = await manifests.load(origin);
    const task = authoritativeTask(CANONICAL_USER_TASK, manifest);
    const snapshot = await new ManifestSnapshotter(manifests).capture({ runId: "pc01-repair", targetUrl: origin, task });
    const incumbentData = await fetch(`${origin}/__patchcourt/data.json?variant=incumbent`).then((response) => response.json()) as Record<string, any>;
    const first = structuredClone(incumbentData);
    first.trust.audience = "68% Canada audience";
    first.trust.providerDebug = "";
    const second = structuredClone(incumbentData);
    second.trust.audience = "68% US audience";
    second.trust.channel = "YouTube @johnsmith";
    second.trust.channelDetail = "Channel ownership verified";
    second.trust.marketFit = "practical consumer technology";
    second.trust.marketFitDetail = "practical consumer technology";
    second.trust.providerDebug = "";
    const grounding = [
      { path: "trust.audience", factIds: ["audience-country-us"] },
      { path: "trust.channel", factIds: ["channel-platform", "channel-public-handle"] },
      { path: "trust.channelDetail", factIds: ["channel-ownership"] },
      { path: "trust.marketFit", factIds: ["recent-content-category"] },
      { path: "trust.marketFitDetail", factIds: ["recent-content-category"] },
      { path: "trust.providerDebug", factIds: [] },
    ];
    class RepairingClient extends GeminiJsonClient {
      calls = 0;
      constructor() { super({ apiKey: "synthetic-constructor-key", model: "gemini-3.6-flash" }); }
      override async generate<T>(): Promise<{ value: T; responseId: string | null }> {
        this.calls += 1;
        return {
          value: ({ candidateData: this.calls === 1 ? first : second, grounding } as unknown) as T,
          responseId: `synthetic-repair-${this.calls}`,
        };
      }
    }
    const client = new RepairingClient();
    const artifacts = new ArtifactStore(runtime);
    const patcher = new GeminiCandidatePatcher(client, manifests, artifacts, policy);
    const patch = await patcher.apply({
      runId: "pc01-repair",
      targetUrl: origin,
      task,
      snapshot,
      incumbent: {
        variant: "incumbent",
        targetUrl: `${origin}/incumbent`,
        taskFingerprint: task.fingerprint,
        taskSucceeded: true,
        steps: [],
        artifacts: [],
        metrics: {},
        startedAt: "2026-08-30T00:00:00.000Z",
        completedAt: "2026-08-30T00:00:01.000Z",
      },
      brief: {
        schemaVersion: 1,
        digest: contentHash("synthetic-brief"),
        taskFingerprint: task.fingerprint,
        findings: [],
        acceptanceChecks: [],
        protectedBehaviors: [],
        rejectedFindings: [],
        criticProvenance: [],
        acceptedCriticIdsDigest: contentHash([]),
        compiledAt: "2026-08-30T00:00:02.000Z",
      },
    });
    assert.equal(client.calls, 2);
    assert.equal(patch.synthesisAttemptCount, 2);
    assert.equal(patch.rejectedSynthesisDigests?.length, 1);
    assert.match(patch.rejectedSynthesisDigests?.[0] ?? "", /^[a-f0-9]{64}$/);
    const groundingArtifact = JSON.parse((await artifacts.read(patch.groundingArtifactId ?? "")).bytes.toString("utf8")) as Record<string, any>;
    assert.deepEqual(groundingArtifact.synthesisValidation, {
      outcome: "accepted",
      attemptCount: 2,
      rejectedCandidateDigests: patch.rejectedSynthesisDigests,
    });
    assert.equal(JSON.stringify(groundingArtifact).includes("Canada"), false);
    const runtimeCandidate = JSON.parse((await artifacts.read(patch.runtimeArtifactId ?? "")).bytes.toString("utf8")) as Record<string, any>;
    assert.equal(runtimeCandidate.trust.channel, "YouTube @johnsmith");
    assert.equal(runtimeCandidate.trust.channelDetail, "Channel ownership verified");
    assert.equal(runtimeCandidate.trust.marketFitDetail, "practical consumer technology");
    assert.equal(runtimeCandidate.trust.providerDebug, "");
    assert.deepEqual(groundingArtifact.safetyPolicy, { mustClearPaths: ["trust.providerDebug"] });
  } finally {
    await close(demo);
    await rm(runtime, { recursive: true, force: true });
  }
});

test("owned demo completes a real Chromium evidence-to-promotion run and canonical receipt", async () => {
  const demoPath = resolve(process.cwd(), "../../demo/brand-match/server.mjs");
  const demoModule = await import(pathToFileURL(demoPath).href) as { server: Server };
  const demo = demoModule.server;
  const port = await listen(demo);
  const runtime = await mkdtemp(join(tmpdir(), "patchcourt-run-"));
  try {
    const service = new PatchCourtService({ runtimeRoot: runtime, mode: "offline-demo", ownedOrigins: [`http://127.0.0.1:${port}`] });
    const created = await service.create({
      targetUrl: `http://127.0.0.1:${port}`,
      userTask: CANONICAL_USER_TASK,
      taskContractVersion: "pc01-v1",
      demoSlug: "integration-test",
    });
    assert.equal(created.task.version, "pc01-v1");
    const completed = await service.wait(created.id);
    assert.equal(completed.status, "promoted");
    assert.equal(completed.evidence.length, 44);
    assert.equal(completed.findings.length, 3);
    assert.equal(completed.regression?.gates.length, 13);
    assert.equal(completed.comparison?.judgeInvocationCount, 1);
    assert.equal(completed.evidence.some((artifact) => /incumbent|candidate/i.test(artifact.id)), false);
    assert.equal(completed.journeys.candidate?.metrics.effectRequestCount, 0);
    assert.equal(verifyReceiptChain(completed.receiptLedger), true);
    for (const gate of completed.regression?.gates ?? []) {
      const referenced = completed.evidence.filter((artifact) => gate.evidenceIds.includes(artifact.id));
      assert.ok(referenced.length > 0, `${gate.id} must cite actual evidence`);
      assert.deepEqual([...new Set(referenced.map((artifact) => artifact.variant))].sort(), ["candidate", "incumbent"]);
      const shape = (variant: "incumbent" | "candidate") => referenced
        .filter((artifact) => artifact.variant === variant)
        .map((artifact) => `${artifact.kind}:${artifact.stepId}:${artifact.viewport}`)
        .sort();
      assert.deepEqual(shape("incumbent"), shape("candidate"), `${gate.id} evidence must be arm-symmetric`);
    }
    const gateRefs = (id: string) => {
      const ids = completed.regression?.gates.find((gate) => gate.id === id)?.evidenceIds ?? [];
      return completed.evidence.filter((artifact) => ids.includes(artifact.id));
    };
    assert.equal(gateRefs("brand_demo_login").every((artifact) => artifact.kind === "screenshot" && artifact.stepId === "login"), true);
    assert.equal(gateRefs("directory_search").every((artifact) => artifact.kind === "screenshot" && artifact.stepId === "search"), true);
    assert.equal(gateRefs("same_task_fingerprint").every((artifact) => artifact.kind === "trace"), true);
    assert.equal(gateRefs("console_and_network_clean").every((artifact) => artifact.kind === "console" || artifact.kind === "network"), true);
    const receipt = await service.receipt(created.id) as Record<string, any>;
    assert.equal(receipt.comparison.decision, "promote");
    assert.equal(receipt.blindComparison.invocationCount, 1);
    assert.deepEqual(receipt.blindComparison.validationRepair, {
      mode: "none",
      rejectedResponseSha256: null,
      invalidFields: [],
      digest: contentHash({ mode: "none", rejectedResponseSha256: null, invalidFields: [] }),
    });
    assert.equal(receipt.source.factsSha256, completed.snapshot?.verifiedFactsDigest);
    assert.deepEqual(receipt.execution, completed.execution);
    assert.equal(verifyCriticProvenanceProof(receipt.criticProvenance), true);
    assert.equal(receipt.criticProvenance.digest, completed.receipt?.criticProvenanceDigest);
    const reveal = receipt.blindComparison.mappingReveal;
    assert.equal(receipt.blindComparison.orderCommitmentSha256, contentHash({
      mapping: { A: reveal.A, B: reveal.B },
      nonce: reveal.nonce,
      taskFingerprint: receipt.taskFingerprint,
    }));
    const { integrity, ...payload } = receipt;
    assert.equal(integrity.payloadSha256, contentHash(payload));
    for (const artifact of completed.evidence) {
      assert.equal(sha256((await service.artifacts.read(artifact.id)).bytes), artifact.sha256);
    }

    const api = createApiServer(service);
    const apiPort = await listen(api);
    try {
      const healthResponse = await fetch(`http://127.0.0.1:${apiPort}/api/health`, { headers: { Origin: "http://127.0.0.1:4175" } });
      const health = await healthResponse.json() as { ok: boolean };
      const capabilities = await fetch(`http://127.0.0.1:${apiPort}/api/capabilities`).then((response) => response.json()) as {
        syntheticFixtureOnly: boolean;
        taskContractVersion: string;
        eventStream: { namedEvents: string[]; urlTemplate: string };
        receiptEndpointTemplate: string;
      };
      assert.equal(health.ok, true);
      assert.equal(healthResponse.headers.get("access-control-allow-origin"), "http://127.0.0.1:4175");
      assert.equal(capabilities.syntheticFixtureOnly, true);
      assert.equal(capabilities.taskContractVersion, "pc01-v1");
      assert.ok(capabilities.eventStream.namedEvents.includes("stage_started"));
      assert.ok(capabilities.eventStream.namedEvents.includes("receipt_ready"));
      assert.equal(capabilities.eventStream.urlTemplate, "/api/runs/{runId}/events");
      assert.equal(capabilities.receiptEndpointTemplate, "/api/runs/{runId}/receipt");

      const sse = await fetch(`http://127.0.0.1:${apiPort}/api/runs/${created.id}/events`).then((response) => response.text());
      assert.match(sse, /event: stage_started/);
      assert.match(sse, /event: receipt_ready/);
      assert.match(sse, new RegExp(`"status":"promoted".*"receiptUrl":"/api/runs/${created.id}/receipt"`));
      assert.equal(service.broker.subscriberCount(created.id), 0);
      const receiptResponse = await fetch(`http://127.0.0.1:${apiPort}/api/runs/${created.id}/receipt`);
      assert.equal(receiptResponse.status, 200);
      assert.equal(((await receiptResponse.json()) as Record<string, any>).comparison.decision, "promote");

      const demoResponse = await fetch(`http://127.0.0.1:${apiPort}/api/demo-runs/integration-test`).then((response) => response.json()) as Record<string, any>;
      assert.equal(demoResponse.runId, created.id);
      assert.equal(demoResponse.status, "promoted");
      assert.equal(demoResponse.receipt.comparison.decision, "promote");

      const invalidCreateResponse = await fetch(`http://127.0.0.1:${apiPort}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUrl: `http://127.0.0.1:${port}`,
          userTask: "Run a deliberately mismatched owned-fixture journey and preserve the invalid result",
          taskContractVersion: "pc01-v1",
          demoSlug: "invalid-contract-test",
        }),
      });
      assert.equal(invalidCreateResponse.status, 202);
      const invalidCreated = await invalidCreateResponse.json() as { id: string };
      const invalidDone = await service.wait(invalidCreated.id);
      assert.equal(invalidDone.status, "invalid");
      const invalidSummary = await fetch(`http://127.0.0.1:${apiPort}/api/runs/${invalidCreated.id}`).then((response) => response.json()) as Record<string, any>;
      assert.equal(invalidSummary.status, "invalid");
      assert.equal(invalidSummary.failure.code, "contract_error");
      assert.equal(typeof invalidSummary.failure.stage, "string");
      assert.equal(typeof invalidSummary.failure.message, "string");
      assert.match(invalidSummary.receipt.receiptId, /^receipt_/);
      assert.equal(/AIza|Bearer\s|profile_id=|googleapis\.com/i.test(JSON.stringify(invalidSummary)), false);
      const invalidSse = await fetch(`http://127.0.0.1:${apiPort}/api/runs/${invalidCreated.id}/events`).then((response) => response.text());
      assert.match(invalidSse, /event: receipt_ready/);
      assert.match(invalidSse, /"status":"invalid"/);

      const wrongVersion = await fetch(`http://127.0.0.1:${apiPort}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUrl: `http://127.0.0.1:${port}`, userTask: CANONICAL_USER_TASK, taskContractVersion: "pc01-v2" }),
      });
      assert.equal(wrongVersion.status, 400);
      assert.match(JSON.stringify(await wrongVersion.json()), /unsupported task contract version/);
    } finally {
      await close(api);
    }
  } finally {
    await close(demo);
    await rm(runtime, { recursive: true, force: true });
  }
});
