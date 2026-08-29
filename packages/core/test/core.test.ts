import assert from "node:assert/strict";
import test from "node:test";

import {
  ContractError,
  CourtOrchestrator,
  LifecycleError,
  MemoryRunRepository,
  appendReceipt,
  buildCriticProvenanceProof,
  compileFindings,
  contentHash,
  decidePromotion,
  fingerprintTask,
  redactText,
  sha256,
  validatePatchCandidate,
  verifyCriticProvenanceProof,
  verifyReceiptChain,
} from "../src/index.js";
import type {
  BlindJudge,
  CandidatePatcher,
  CourtAdapters,
  CriticFindingInput,
  EvidenceCollector,
  FrozenTaskContract,
  ProductCritic,
  RegressionEvaluator,
  SourceSnapshotter,
} from "../src/index.js";

class FixedClock {
  #tick = 0;
  now(): string {
    this.#tick += 1;
    return new Date(Date.UTC(2026, 7, 29, 0, 0, this.#tick)).toISOString();
  }
}

class FixedIds {
  #next = 0;
  next(prefix: string): string {
    this.#next += 1;
    return `${prefix}_${this.#next}`;
  }
}

const taskDefaults: Partial<FrozenTaskContract> = {
  version: "bu01-v1",
  steps: [
    { id: "sign-in", instruction: "Sign in as the brand demo account" },
    { id: "search", instruction: "Search the Creator Directory for US" },
    { id: "profile", instruction: "Open John Smith and decide market fit" },
    { id: "offer", instruction: "Edit the offer amount and prepare to send" },
  ],
  viewports: [
    { name: "desktop", width: 1280, height: 720 },
    { name: "mobile", width: 390, height: 844 },
  ],
  criticalInvariants: [
    { id: "brand-login", category: "functionality", description: "Brand login succeeds" },
    { id: "offer-editable", category: "functionality", description: "Offer fields remain editable" },
    { id: "no-internal-id", category: "privacy", description: "No internal identifier is exposed" },
  ],
};

function evidenceId(variant: "incumbent" | "candidate", step: string, viewport: string) {
  return `arm-${variant === "incumbent" ? "7e31" : "9b42"}-${step}-${viewport}`;
}

function adapters(options: { tie?: boolean; failGate?: boolean; malformedCandidate?: boolean; judgeCalls?: { count: number }; judgeRepair?: boolean } = {}): CourtAdapters {
  const snapshotter: SourceSnapshotter = {
    async capture() {
      return {
        benchmarkId: "PC01",
        appId: "patchcourt-brand-match",
        digest: contentHash("sealed-source"),
        manifestDigest: contentHash("manifest-v1"),
        capturedAt: "2026-08-29T00:00:00.000Z",
        ownedTarget: true,
        allowlistedFiles: ["src/components/CreatorProfile.tsx", "src/styles/profile.css"],
      };
    },
  };
  const collector: EvidenceCollector = {
    async collect(context) {
      const steps = context.task.steps.map((step) => ({
        ...step,
        status: "passed" as const,
        observation: context.variant === "incumbent" ? "Task completes but decision evidence is unclear" : "Task completes with decision evidence visible",
        evidenceIds: context.task.viewports.map((viewport) => evidenceId(context.variant, step.id, viewport.name)),
      }));
      const artifacts = context.task.steps.flatMap((step) => context.task.viewports.map((viewport) => {
        const id = evidenceId(context.variant, step.id, viewport.name);
        return {
          id,
          kind: "screenshot" as const,
          label: `${step.id} ${viewport.name}`,
          uri: `/api/artifacts/${id}.webp`,
          sha256: contentHash(`${context.variant}:${step.id}:${viewport.name}`),
          stepId: options.malformedCandidate && context.variant === "candidate" && step.id === "offer" ? "wrong-step" : step.id,
          variant: context.variant,
          viewport: viewport.name,
          capturedAt: "2026-08-29T00:00:01.000Z",
          observation: context.variant === "incumbent" ? "Opaque provider identifier is visible" : "Verified audience evidence is visible",
        };
      }));
      return {
        variant: context.variant,
        targetUrl: `${context.targetUrl}/${context.variant}`,
        taskFingerprint: context.task.fingerprint,
        taskSucceeded: true,
        steps,
        artifacts,
        metrics: {},
        startedAt: "2026-08-29T00:00:00.000Z",
        completedAt: "2026-08-29T00:00:02.000Z",
      };
    },
  };
  const critic: ProductCritic = {
    id: "evidence-critic",
    async review(context) {
      return [{
        criticId: "evidence-critic",
        domain: "usability",
        severity: "high",
        title: "Creator profile lacks decision-ready evidence",
        evidence: [{ artifactId: evidenceId("incumbent", "profile", "desktop"), observation: "Profile shows an opaque provider identifier instead of audience evidence" }],
        reproduction: ["Sign in", "Search US", "Open John Smith", "Inspect the profile summary"],
        userImpact: "A brand operator cannot confidently judge creator fit",
        expectedBehavior: "Audience, verification, market fit, and next action are visible",
        patchLocus: "src/components/CreatorProfile.tsx",
        proposedDirection: "Replace opaque provider data with verified decision evidence",
        acceptanceChecks: ["The profile exposes no opaque provider identifier", "The profile states audience and market fit"],
        regressionRisks: ["Profile route still opens", "Offer fields remain editable"],
      }];
    },
  };
  const patcher: CandidatePatcher = {
    async apply(context) {
      const diff = "--- a/src/components/CreatorProfile.tsx\n+++ b/src/components/CreatorProfile.tsx\n@@ profile\n- internal id\n+ verified audience evidence\n";
      return {
        id: "patch-profile-evidence",
        title: "Make creator evidence decision-ready",
        status: "applied",
        baseDigest: context.snapshot.digest,
        candidateDigest: contentHash({ base: context.snapshot.digest, diff }),
        diffDigest: sha256(diff),
        diff,
        files: ["src/components/CreatorProfile.tsx"],
        rationale: "Resolve the highest-impact grounded finding",
        appliedAt: "2026-08-29T00:00:03.000Z",
      };
    },
  };
  const regression: RegressionEvaluator = {
    async evaluate(context) {
      const gates = context.task.criticalInvariants.map((invariant) => ({
        id: invariant.id,
        category: invariant.category,
        critical: true,
        incumbentPassed: invariant.id !== "no-internal-id",
        candidatePassed: options.failGate ? invariant.id !== "offer-editable" : true,
        evidenceIds: [evidenceId("candidate", invariant.id === "offer-editable" ? "offer" : "profile", "desktop")],
        details: "Checked through the frozen browser journey",
      }));
      return {
        taskFingerprint: context.task.fingerprint,
        exactReplay: true,
        incumbentTaskSucceeded: true,
        candidateTaskSucceeded: true,
        gates,
        scores: {
          incumbent: {
            taskSuccessClarity: 62,
            decisionUsefulness: 38,
            authoredVisualQuality: 55,
            accessibilityResponsive: 70,
            functionalRegression: 100,
            securityPrivacy: 55,
          },
          candidate: {
            taskSuccessClarity: 91,
            decisionUsefulness: 92,
            authoredVisualQuality: 88,
            accessibilityResponsive: 91,
            functionalRegression: options.failGate ? 40 : 100,
            securityPrivacy: 96,
          },
        },
        newHighRiskSecurityFindings: [],
        passed: !options.failGate,
        evaluatedAt: "2026-08-29T00:00:04.000Z",
      };
    },
  };
  const judge: BlindJudge = {
    async judge(input) {
      if (options.judgeCalls) options.judgeCalls.count += 1;
      assert.equal("variant" in input.arms[0], false, "blind judge input leaked arm identity");
      if (options.tie) return {
        winner: "tie",
        confidence: 0.9,
        rationale: ["Observable outcomes are equivalent"],
        dimensionDeltas: {},
        judge: { kind: "deterministic", provider: "patchcourt", model: "paired-score-v1", responseId: null },
      };
      const score = (arm: typeof input.arms[number]) => Object.values(arm.dimensionScores).reduce((sum, value) => sum + value, 0);
      const winner = score(input.arms[0]) > score(input.arms[1]) ? input.arms[0] : input.arms[1];
      const [armA, armB] = input.arms;
      const repairPayload = {
        mode: "format-completion" as const,
        rejectedResponseSha256: sha256("rejected anonymous judge response"),
        invalidFields: ["rationale"],
      };
      return {
        winner: winner.label,
        confidence: 0.96,
        rationale: ["The winning arm makes the fixed user decision materially clearer"],
        dimensionDeltas: {
          taskSuccessClarity: armB.dimensionScores.taskSuccessClarity - armA.dimensionScores.taskSuccessClarity,
          decisionUsefulness: armB.dimensionScores.decisionUsefulness - armA.dimensionScores.decisionUsefulness,
          authoredVisualQuality: armB.dimensionScores.authoredVisualQuality - armA.dimensionScores.authoredVisualQuality,
          accessibilityResponsive: armB.dimensionScores.accessibilityResponsive - armA.dimensionScores.accessibilityResponsive,
          functionalRegression: armB.dimensionScores.functionalRegression - armA.dimensionScores.functionalRegression,
          securityPrivacy: armB.dimensionScores.securityPrivacy - armA.dimensionScores.securityPrivacy,
        },
        judge: { kind: "deterministic", provider: "patchcourt", model: "paired-score-v1", responseId: null },
        ...(options.judgeRepair ? {
          providerInvocationCount: 2,
          validationRepair: { ...repairPayload, digest: contentHash(repairPayload) },
        } : {}),
      };
    },
  };
  return { snapshotter, collector, critics: [critic], patcher, regression, judge };
}

async function runCourt(options: Parameters<typeof adapters>[0] = {}) {
  const repository = new MemoryRunRepository();
  const orchestrator = new CourtOrchestrator(repository, adapters(options), {
    clock: new FixedClock(),
    ids: new FixedIds(),
    taskDefaults,
  });
  const created = await orchestrator.create({
    targetUrl: "http://127.0.0.1:4173",
    userTask: "Sign in, inspect John Smith, judge market fit, and prepare an editable offer",
    taskContractVersion: "bu01-v1",
  });
  return { orchestrator, created, completed: await orchestrator.execute(created.id) };
}

test("strict compiler accepts grounded evidence and rejects vague feedback", () => {
  const evidence = [{
    id: "screen-1",
    kind: "screenshot" as const,
    label: "Profile",
    uri: "/screen.webp",
    sha256: contentHash("screen"),
    stepId: "profile",
    variant: "incumbent" as const,
    viewport: "desktop",
    capturedAt: "2026-08-29T00:00:00.000Z",
    observation: "Opaque identifier is visible",
  }];
  const valid: CriticFindingInput = {
    criticId: "critic",
    domain: "privacy",
    severity: "high",
    title: "Opaque identifier exposed",
    evidence: [{ artifactId: "screen-1", observation: "Numeric provider id appears in the hero" }],
    reproduction: ["Open profile"],
    userImpact: "Internal metadata is exposed",
    expectedBehavior: "Only user-facing identity is shown",
    patchLocus: "profile hero",
    proposedDirection: "Whitelist public fields",
    acceptanceChecks: ["Opaque identifier is absent"],
    regressionRisks: ["Profile still opens"],
  };
  const vague = { ...valid, criticId: "vague", evidence: [], acceptanceChecks: [] };
  const brief = compileFindings({
    findings: [vague, valid],
    evidence,
    taskFingerprint: fingerprintTask("A sufficiently specific task"),
    compiledAt: "2026-08-29T00:00:00.000Z",
    invokedCriticIds: ["vague", "critic", "silent"],
  });
  assert.equal(brief.findings.length, 1);
  assert.equal(brief.rejectedFindings.length, 1);
  assert.deepEqual(brief.criticProvenance, [
    { criticId: "critic", proposedCount: 1, acceptedCount: 1, rejectedCount: 0 },
    { criticId: "silent", proposedCount: 0, acceptedCount: 0, rejectedCount: 0 },
    { criticId: "vague", proposedCount: 1, acceptedCount: 0, rejectedCount: 1 },
  ]);
  assert.equal(brief.acceptedCriticIdsDigest, contentHash(["critic"]));
  const provenance = buildCriticProvenanceProof(brief);
  assert.equal(verifyCriticProvenanceProof(provenance), true);
  assert.equal(verifyCriticProvenanceProof({
    ...provenance,
    entries: provenance.entries.map((entry, index) => index === 0 ? { ...entry, acceptedCount: entry.acceptedCount + 1 } : entry),
  }), false);
  assert.equal(verifyCriticProvenanceProof({ ...provenance, acceptedCriticIdsDigest: contentHash(["tampered"]) }), false);
  assert.match(brief.findings[0]?.id ?? "", /^PC-/);
});

test("receipt chain is deterministic, linked, and tamper evident", () => {
  const first = appendReceipt([], "one", { result: "sealed" }, "2026-08-29T00:00:00.000Z");
  const second = appendReceipt([first], "two", { result: "judged" }, "2026-08-29T00:00:01.000Z");
  assert.equal(verifyReceiptChain([first, second]), true);
  assert.equal(verifyReceiptChain([first, { ...second, payloadHash: contentHash("tampered") }]), false);
});

test("secret-like strings and credential query parameters never persist verbatim", () => {
  const synthetic = `key=${"AIza" + "x".repeat(28)}&authorization=Bearer ${"y".repeat(24)}`;
  const redacted = redactText(synthetic);
  assert.equal(redacted.includes("AIza"), false);
  assert.equal(redacted.includes("Bearer"), false);
});

test("full court run promotes only after exact replay, gates, and blinded improvement", async () => {
  const { completed } = await runCourt();
  assert.equal(completed.status, "promoted");
  assert.equal(completed.decision?.outcome, "promoted");
  assert.equal(completed.events.some((event) => event.status === "observing_incumbent"), true);
  assert.equal(completed.events.some((event) => event.status === "observing_candidate"), true);
  assert.equal(completed.receipt?.outcome, "promoted");
  assert.equal(completed.receipt?.ledgerHead, completed.receiptLedger.at(-1)?.hash);
  assert.equal(completed.receipt?.criticProvenanceDigest, completed.receipt?.criticProvenance?.digest);
  assert.equal(completed.receipt?.criticProvenance ? verifyCriticProvenanceProof(completed.receipt.criticProvenance) : false, true);
  const commitmentIndex = completed.receiptLedger.findIndex((entry) => entry.kind === "blind-order-commitment");
  const comparisonIndex = completed.receiptLedger.findIndex((entry) => entry.kind === "blind-comparison");
  assert.ok(commitmentIndex >= 0 && comparisonIndex > commitmentIndex);
  assert.equal(verifyReceiptChain(completed.receiptLedger), true);
});

test("blind format repair seals the exact provider call count and rejected-response proof", async () => {
  const { completed } = await runCourt({ judgeRepair: true });
  assert.equal(completed.status, "promoted");
  assert.equal(completed.comparison?.judgeInvocationCount, 2);
  assert.deepEqual(completed.comparison?.validationRepair.invalidFields, ["rationale"]);
  assert.equal(completed.comparison?.validationRepair.mode, "format-completion");
  assert.equal(completed.comparison?.validationRepair.digest, contentHash({
    mode: "format-completion",
    rejectedResponseSha256: sha256("rejected anonymous judge response"),
    invalidFields: ["rationale"],
  }));
});

test("role critics start concurrently while adapter order remains authoritative", async () => {
  const courtAdapters = adapters();
  const sourceCritic = courtAdapters.critics[0]!;
  const starts: number[] = [];
  let active = 0;
  let maximumActive = 0;
  let release!: () => void;
  const allStarted = new Promise<void>((resolve) => { release = resolve; });
  courtAdapters.critics = [0, 1, 2].map((index) => ({
    id: `critic-${index}`,
    async review(context) {
      starts.push(index);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (starts.length === 3) release();
      await allStarted;
      await new Promise((resolve) => setTimeout(resolve, (2 - index) * 2));
      const findings = await sourceCritic.review(context);
      active -= 1;
      return findings.map((finding) => ({ ...finding, criticId: `critic-${index}` }));
    },
  }));
  const orchestrator = new CourtOrchestrator(new MemoryRunRepository(), courtAdapters, { clock: new FixedClock(), ids: new FixedIds(), taskDefaults });
  const created = await orchestrator.create({
    targetUrl: "http://127.0.0.1:4173",
    userTask: "Sign in, inspect John Smith, judge market fit, and prepare an editable offer",
    taskContractVersion: "bu01-v1",
  });
  const completed = await orchestrator.execute(created.id);
  assert.equal(completed.status, "promoted");
  assert.deepEqual(starts, [0, 1, 2]);
  assert.equal(maximumActive, 3);
  assert.equal(completed.findings[0]?.criticId, "critic-0");
  assert.deepEqual(completed.brief?.rejectedFindings.map((finding) => finding.criticId), ["critic-1", "critic-2"]);
});

test("one failed concurrent critic invalidates the visible run", async () => {
  const courtAdapters = adapters();
  courtAdapters.critics = [
    courtAdapters.critics[0]!,
    { id: "failed-provider", async review() { throw new Error("synthetic provider outage"); } },
  ];
  const orchestrator = new CourtOrchestrator(new MemoryRunRepository(), courtAdapters, { clock: new FixedClock(), ids: new FixedIds(), taskDefaults });
  const created = await orchestrator.create({
    targetUrl: "http://127.0.0.1:4173",
    userTask: "Sign in, inspect John Smith, judge market fit, and prepare an editable offer",
    taskContractVersion: "bu01-v1",
  });
  const completed = await orchestrator.execute(created.id);
  assert.equal(completed.status, "invalid");
  assert.equal(completed.failure?.code, "infrastructure_error");
  assert.equal(completed.failure?.stage, "criticizing");
  assert.equal(completed.receipt?.outcome, "invalid");
});

test("live patch proof requires paired runtime and grounding artifacts bound to sealed facts", () => {
  const diff = "--- data/incumbent.json\n+++ data/candidate.json\n";
  const snapshot = {
    benchmarkId: "PC01",
    appId: "patchcourt-brand-match",
    digest: sha256("source"),
    verifiedFactsDigest: sha256("facts"),
    manifestDigest: sha256("manifest"),
    capturedAt: "2026-08-30T00:00:00.000Z",
    ownedTarget: true as const,
    allowlistedFiles: ["data/candidate.json"],
  };
  assert.throws(() => validatePatchCandidate({
    id: "patch-live",
    title: "Live patch",
    status: "applied",
    baseDigest: snapshot.digest,
    candidateDigest: sha256("candidate"),
    diffDigest: sha256(diff),
    diff,
    files: ["data/candidate.json"],
    rationale: "Sealed facts only",
    appliedAt: "2026-08-30T00:00:01.000Z",
    provider: { name: "google", model: "gemini-3.6-flash", mode: "live" },
  }, snapshot), /runtime, grounding, or verified-facts proof/);
  const sealedLivePatch = {
    id: "patch-live-sealed",
    title: "Live sealed patch",
    status: "applied" as const,
    baseDigest: snapshot.digest,
    candidateDigest: sha256("candidate-sealed"),
    diffDigest: sha256(diff),
    diff,
    files: ["data/candidate.json"],
    rationale: "Sealed facts only",
    appliedAt: "2026-08-30T00:00:01.000Z",
    provider: { name: "google", model: "gemini-3.6-flash", mode: "live" as const },
    runtimeArtifactId: "art-runtime-proof.json",
    runtimeArtifactSha256: sha256("runtime"),
    groundingArtifactId: "art-grounding-proof.json",
    groundingArtifactSha256: sha256("grounding"),
    verifiedFactsDigest: snapshot.verifiedFactsDigest,
    synthesisAttemptCount: 1,
    rejectedSynthesisDigests: [],
  };
  assert.doesNotThrow(() => validatePatchCandidate(sealedLivePatch, snapshot));
  assert.throws(() => validatePatchCandidate({ ...sealedLivePatch, synthesisAttemptCount: 2 }, snapshot), /rejected synthesis digests/);
});

test("blind tie rejects candidate and preserves incumbent", async () => {
  const { completed } = await runCourt({ tie: true });
  assert.equal(completed.status, "rejected");
  assert.equal(completed.decision?.reasons.some((reason) => reason.includes("tied")), true);
});

test("critical regression rejects even a visually preferred candidate", async () => {
  const judgeCalls = { count: 0 };
  const { completed } = await runCourt({ failGate: true, judgeCalls });
  assert.equal(completed.status, "rejected");
  assert.equal(completed.decision?.allCriticalGatesPassed, false);
  assert.match(completed.decision?.reasons.join(" ") ?? "", /critical gates failed/);
  assert.equal(judgeCalls.count, 0, "critical deterministic gates must short-circuit model judgment");
  assert.equal(completed.comparison?.verdict.judge.model, "critical-gate-short-circuit-v1");
});

test("asymmetric browser evidence invalidates the run instead of guessing", async () => {
  const { completed } = await runCourt({ malformedCandidate: true });
  assert.equal(completed.status, "invalid");
  assert.equal(completed.failure?.code, "contract_error");
  assert.equal(completed.decision, undefined);
  assert.equal(completed.receipt?.outcome, "invalid");
});

test("illegal lifecycle transitions fail closed", async () => {
  const repository = new MemoryRunRepository();
  const orchestrator = new CourtOrchestrator(repository, adapters(), { clock: new FixedClock(), ids: new FixedIds(), taskDefaults });
  const run = await orchestrator.create({ targetUrl: "http://127.0.0.1:4173", userTask: "Inspect a creator and prepare an editable brand offer" });
  await assert.rejects(() => repository.save({ ...run, revision: 1, status: "promoted" }, 99), LifecycleError);
  await assert.rejects(
    async () => decidePromotion({
      regression: {
        taskFingerprint: run.task.fingerprint,
        exactReplay: false,
        incumbentTaskSucceeded: true,
        candidateTaskSucceeded: true,
        gates: [],
        scores: {
          incumbent: { taskSuccessClarity: 1, decisionUsefulness: 1, authoredVisualQuality: 1, accessibilityResponsive: 1, functionalRegression: 1, securityPrivacy: 1 },
          candidate: { taskSuccessClarity: 2, decisionUsefulness: 2, authoredVisualQuality: 2, accessibilityResponsive: 2, functionalRegression: 2, securityPrivacy: 2 },
        },
        newHighRiskSecurityFindings: [],
        passed: true,
        evaluatedAt: "now",
      },
      comparison: {
        assignment: { incumbent: "A", candidate: "B" },
        protocolVersion: 1,
        orderCommitmentSha256: contentHash({ mapping: { A: "incumbent", B: "candidate" }, nonce: "0123456789abcdef", taskFingerprint: run.task.fingerprint }),
        mappingNonce: "0123456789abcdef",
        judgeInvocationCount: 1,
        validationRepair: {
          mode: "none",
          rejectedResponseSha256: null,
          invalidFields: [],
          digest: contentHash({ mode: "none", rejectedResponseSha256: null, invalidFields: [] }),
        },
        verdict: {
          winner: "B",
          confidence: 1,
          rationale: [],
          dimensionDeltas: { taskSuccessClarity: 1 },
          judge: { kind: "deterministic", provider: "test", model: "test", responseId: null },
        },
        candidateWon: true,
        evaluatedAt: "now",
      },
      decidedAt: "now",
    }),
    ContractError,
  );
});
