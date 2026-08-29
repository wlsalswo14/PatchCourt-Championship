import {
  ContractError,
  contentHash,
  sha256,
  type BlindJudge,
  type BlindJudgeInput,
  type BlindJudgeVerdict,
  type CandidatePatcher,
  type CriticFindingInput,
  type DimensionScores,
  type GateResult,
  type JourneyEvidence,
  type ProductCritic,
  type RegressionEvaluator,
  type RegressionReport,
  type SourceSnapshotter,
  type Variant,
} from "@patchcourt/core";

import { ArtifactStore } from "./artifact-store.js";
import { ManifestClient, manifestDigest } from "./manifest.js";
import { TargetPolicy } from "./target-policy.js";

function metricNumber(journey: JourneyEvidence, key: string): number {
  const value = journey.metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function metricBoolean(journey: JourneyEvidence, key: string): boolean {
  return journey.metrics[key] === true;
}

function screenshotFor(journey: JourneyEvidence, stepId: string, viewport = "desktop") {
  return journey.artifacts.find((artifact) => artifact.kind === "screenshot" && artifact.stepId === stepId && artifact.viewport === viewport)
    ?? journey.artifacts.find((artifact) => artifact.kind === "screenshot");
}

export class ManifestSnapshotter implements SourceSnapshotter {
  constructor(readonly manifests: ManifestClient) {}

  async capture(context: Parameters<SourceSnapshotter["capture"]>[0]) {
    const manifest = await this.manifests.load(context.targetUrl);
    if (manifest.taskFingerprint !== context.task.fingerprint) throw new ContractError("submitted task and manifest fingerprint differ");
    const [patch, facts] = await Promise.all([
      this.manifests.patch(context.targetUrl),
      this.manifests.verifiedFacts(context.targetUrl, manifest),
    ]);
    if (patch.appId !== manifest.appId) throw new ContractError("patch manifest app identity differs from source manifest");
    if (patch.rawDigest !== manifest.patchDigest) throw new ContractError("patch manifest bytes differ from their sealed digest");
    return {
      benchmarkId: "PC01",
      appId: manifest.appId,
      digest: manifest.sourceSnapshotDigest,
      candidateDigest: manifest.candidateSnapshotDigest,
      patchDigest: manifest.patchDigest,
      verifiedFactsDigest: facts.rawDigest,
      manifestDigest: manifestDigest(manifest),
      capturedAt: new Date().toISOString(),
      ownedTarget: true as const,
      allowlistedFiles: [patch.candidate],
    };
  }
}

abstract class BaseMetricCritic implements ProductCritic {
  abstract readonly id: string;
  abstract review(context: Parameters<ProductCritic["review"]>[0]): Promise<CriticFindingInput[]>;

  protected finding(context: Parameters<ProductCritic["review"]>[0], input: Omit<CriticFindingInput, "criticId" | "evidence" | "patchLocus"> & { stepId: string }): CriticFindingInput[] {
    const artifact = screenshotFor(context.incumbent, input.stepId);
    if (!artifact) return [];
    const { stepId: _stepId, ...finding } = input;
    return [{
      ...finding,
      criticId: this.id,
      patchLocus: context.snapshot.allowlistedFiles[0] ?? "candidate data",
      evidence: [{ artifactId: artifact.id, observation: artifact.observation }],
    }];
  }
}

export class DecisionEvidenceCritic extends BaseMetricCritic {
  readonly id = "deterministic-decision-evidence-critic-v1";

  async review(context: Parameters<ProductCritic["review"]>[0]): Promise<CriticFindingInput[]> {
    if (metricNumber(context.incumbent, "decisionEvidenceCount") >= 4) return [];
    return this.finding(context, {
      stepId: "inspect",
      domain: "usability",
      severity: "high",
      title: "Creator profile does not support a confident market-fit decision",
      reproduction: ["Sign in with the owned brand demo", "Search the directory for US", "Open the creator profile", "Inspect audience, channel, market-fit, and next-action evidence"],
      userImpact: "A brand operator cannot distinguish a credible match from an opaque system match",
      expectedBehavior: "All four decision evidence categories are explicit, public-facing, and actionable",
      proposedDirection: "Replace placeholders and internal rules with verified audience, channel, market-fit, and reversible next-action evidence",
      acceptanceChecks: ["Decision evidence count reaches four", "The fixed task can be answered from the interface without source access"],
      regressionRisks: ["Creator profile still opens", "Directory result remains reachable through normal navigation"],
    });
  }
}

export class PrivacyCritic extends BaseMetricCritic {
  readonly id = "deterministic-privacy-critic-v1";

  async review(context: Parameters<ProductCritic["review"]>[0]): Promise<CriticFindingInput[]> {
    if (metricNumber(context.incumbent, "internalIdentifierCount") === 0) return [];
    return this.finding(context, {
      stepId: "inspect",
      domain: "privacy",
      severity: "high",
      title: "Opaque provider metadata is rendered in the decision surface",
      reproduction: ["Open the creator profile", "Inspect the connected-provider block"],
      userImpact: "Internal identifiers erode trust and can expose implementation metadata",
      expectedBehavior: "Only public identity and verification evidence are visible",
      proposedDirection: "Remove opaque provider metadata and whitelist public verification fields",
      acceptanceChecks: ["Internal identifier count is zero", "A public verified-channel label remains visible"],
      regressionRisks: ["Channel verification remains understandable", "No credential or private provider payload is introduced"],
    });
  }
}

export class AccessibilityCritic extends BaseMetricCritic {
  readonly id = "deterministic-accessibility-critic-v1";

  async review(context: Parameters<ProductCritic["review"]>[0]): Promise<CriticFindingInput[]> {
    if (metricBoolean(context.incumbent, "accessiblePrimaryControls") && metricNumber(context.incumbent, "horizontalOverflowPixels") === 0) return [];
    return this.finding(context, {
      stepId: "offer",
      domain: "accessibility",
      severity: "high",
      title: "Primary offer controls are not reliably operable across viewports",
      reproduction: ["Replay the fixed offer step at desktop and mobile viewports", "Inspect accessible names and horizontal overflow"],
      userImpact: "Keyboard, assistive-technology, or mobile users can lose the primary action",
      expectedBehavior: "Every primary control has an accessible name and remains inside the mobile viewport",
      proposedDirection: "Preserve semantic labels and contain the offer action responsively",
      acceptanceChecks: ["All primary controls have accessible names", "Horizontal overflow is zero at 390×844"],
      regressionRisks: ["Offer message and fee remain editable", "Draft action remains visible"],
    });
  }
}

async function boundedText(url: URL): Promise<string> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new ContractError(`owned fixture data request failed: ${response.status}`);
  const text = await response.text();
  if (text.length > 1_000_000) throw new ContractError("owned fixture data exceeded the size limit");
  return text;
}

function patchSummary(before: unknown, after: unknown, path = "root"): string[] {
  if (typeof before === "string" && typeof after === "string") {
    if (before === after) return [];
    const safeBefore = /(?:providerDebug|credential|token|secret)/i.test(path) || /oauth|profile_id|https?:\/\//i.test(before)
      ? "[REDACTED_INTERNAL_VALUE]"
      : before;
    return [`~ ${path}: ${JSON.stringify(safeBefore)} -> ${JSON.stringify(after)}`];
  }
  if (!before || !after || typeof before !== "object" || typeof after !== "object" || Array.isArray(before) || Array.isArray(after)) return [];
  return Object.keys(before as Record<string, unknown>).flatMap((key) => patchSummary(
    (before as Record<string, unknown>)[key],
    (after as Record<string, unknown>)[key],
    `${path}.${key}`,
  ));
}

export class ReferenceCandidatePatcher implements CandidatePatcher {
  constructor(readonly manifests: ManifestClient, readonly policy = new TargetPolicy()) {}

  async apply(context: Parameters<CandidatePatcher["apply"]>[0]) {
    const target = this.policy.assertAllowed(context.targetUrl);
    const [manifest, patch, incumbentText, candidateText] = await Promise.all([
      this.manifests.load(context.targetUrl),
      this.manifests.patch(context.targetUrl),
      boundedText(new URL("/__patchcourt/data.json?variant=incumbent", target.origin)),
      boundedText(new URL("/__patchcourt/data.json?variant=candidate", target.origin)),
    ]);
    const facts = await this.manifests.verifiedFacts(context.targetUrl, manifest);
    if (manifest.sourceSnapshotDigest !== context.snapshot.digest || manifest.candidateSnapshotDigest !== context.snapshot.candidateDigest || manifest.patchDigest !== context.snapshot.patchDigest || patch.rawDigest !== manifest.patchDigest || facts.rawDigest !== context.snapshot.verifiedFactsDigest) {
      throw new ContractError("owned fixture changed after snapshot sealing");
    }
    const incumbentData = JSON.parse(incumbentText) as unknown;
    const candidateData = JSON.parse(candidateText) as unknown;
    const diff = [
      `--- ${patch.source}`,
      `+++ ${patch.candidate}`,
      "@@ deterministic championship reference candidate @@",
      ...patchSummary(incumbentData, candidateData),
      "",
    ].join("\n");
    return {
      id: `patch-${manifest.patchDigest.slice(0, 16)}`,
      title: "Decision-ready creator evidence reference patch",
      status: "applied" as const,
      baseDigest: context.snapshot.digest,
      candidateDigest: manifest.candidateSnapshotDigest,
      diffDigest: sha256(diff),
      diff,
      files: [patch.candidate],
      rationale: patch.changes.map((change) => change.intent).join(" "),
      appliedAt: new Date().toISOString(),
      provider: { name: "patchcourt", model: "deterministic-reference-candidate-v1", mode: "deterministic" as const },
      claimBoundary: patch.claimBoundary,
    };
  }
}

async function artifactIntegrity(journey: JourneyEvidence, artifacts: ArtifactStore): Promise<boolean> {
  for (const artifact of journey.artifacts) {
    if (!artifact.uri.startsWith("artifact://")) return false;
    const stored = await artifacts.read(artifact.uri.slice("artifact://".length));
    if (sha256(stored.bytes) !== artifact.sha256) return false;
  }
  return true;
}

function stepPassed(journey: JourneyEvidence, id: string): boolean {
  return journey.steps.find((step) => step.id === id)?.status === "passed";
}

const GATE_EVIDENCE: Record<string, { steps?: string[]; kinds?: JourneyEvidence["artifacts"][number]["kind"][]; mobileOnly?: boolean; all?: boolean }> = {
  owned_local_target: { kinds: ["trace", "network"] },
  same_task_fingerprint: { kinds: ["trace"] },
  brand_demo_login: { steps: ["login"], kinds: ["screenshot"] },
  directory_search: { steps: ["search"], kinds: ["screenshot"] },
  profile_open: { steps: ["profile"], kinds: ["screenshot"] },
  decision_evidence_complete: { steps: ["inspect"], kinds: ["screenshot"] },
  offer_fields_editable: { steps: ["offer"], kinds: ["screenshot"] },
  draft_not_sent: { steps: ["confirm"], kinds: ["screenshot", "network"] },
  no_internal_identifier_exposure: { steps: ["inspect"], kinds: ["screenshot"] },
  accessible_primary_controls: { kinds: ["accessibility"] },
  responsive_primary_action: { steps: ["confirm"], kinds: ["screenshot"], mobileOnly: true },
  console_and_network_clean: { kinds: ["console", "network"] },
  artifact_integrity: { all: true },
};

function gateEvidenceIds(id: string, journey: JourneyEvidence): string[] {
  const rule = GATE_EVIDENCE[id];
  if (!rule) return [];
  return journey.artifacts
    .filter((artifact) => rule.all || (
      (!rule.steps || rule.steps.includes(artifact.stepId)) &&
      (!rule.kinds || rule.kinds.includes(artifact.kind)) &&
      (!rule.mobileOnly || artifact.viewport === "mobile")
    ))
    .map((artifact) => artifact.id);
}

function gatePassed(id: string, journey: JourneyEvidence, integrity: boolean): boolean {
  switch (id) {
    case "owned_local_target": return true;
    case "same_task_fingerprint": return true;
    case "brand_demo_login": return stepPassed(journey, "login");
    case "directory_search": return stepPassed(journey, "directory") && stepPassed(journey, "search");
    case "profile_open": return stepPassed(journey, "profile");
    case "decision_evidence_complete": return metricNumber(journey, "decisionEvidenceCount") >= 4;
    case "offer_fields_editable": return metricBoolean(journey, "offerEditable");
    case "draft_not_sent": return metricBoolean(journey, "draftOnly") && metricNumber(journey, "effectRequestCount") === 0;
    case "no_internal_identifier_exposure": return metricNumber(journey, "internalIdentifierCount") === 0;
    case "accessible_primary_controls": return metricBoolean(journey, "accessiblePrimaryControls");
    case "responsive_primary_action": return metricNumber(journey, "horizontalOverflowPixels") === 0 && metricBoolean(journey, "responsivePrimaryAction");
    case "console_and_network_clean": return metricNumber(journey, "consoleErrorCount") === 0 && metricNumber(journey, "externalRequestCount") === 0 && metricNumber(journey, "effectRequestCount") === 0;
    case "artifact_integrity": return integrity;
    default: return false;
  }
}

function dimensionScores(journey: JourneyEvidence): DimensionScores {
  const decision = Math.min(100, metricNumber(journey, "decisionEvidenceCount") * 25);
  return {
    taskSuccessClarity: journey.taskSucceeded ? 100 : 0,
    decisionUsefulness: decision,
    authoredVisualQuality: 50,
    accessibilityResponsive: metricBoolean(journey, "accessiblePrimaryControls") && metricNumber(journey, "horizontalOverflowPixels") === 0 && metricBoolean(journey, "responsivePrimaryAction") ? 100 : 0,
    functionalRegression: metricNumber(journey, "consoleErrorCount") === 0 && metricNumber(journey, "effectRequestCount") === 0 && metricBoolean(journey, "offerEditable") && metricBoolean(journey, "draftOnly") ? 100 : 0,
    securityPrivacy: metricNumber(journey, "internalIdentifierCount") === 0 && metricNumber(journey, "externalRequestCount") === 0 ? 100 : 0,
  };
}

export class DeterministicRegressionEvaluator implements RegressionEvaluator {
  constructor(readonly artifacts: ArtifactStore) {}

  async evaluate(context: Parameters<RegressionEvaluator["evaluate"]>[0]): Promise<RegressionReport> {
    const [incumbentIntegrity, candidateIntegrity] = await Promise.all([
      artifactIntegrity(context.incumbent, this.artifacts),
      artifactIntegrity(context.candidate, this.artifacts),
    ]);
    const gates: GateResult[] = context.task.criticalInvariants.map((invariant) => ({
      id: invariant.id,
      category: invariant.category,
      critical: true,
      incumbentPassed: gatePassed(invariant.id, context.incumbent, incumbentIntegrity),
      candidatePassed: gatePassed(invariant.id, context.candidate, candidateIntegrity),
      evidenceIds: [
        ...gateEvidenceIds(invariant.id, context.incumbent),
        ...gateEvidenceIds(invariant.id, context.candidate),
      ],
      details: `${invariant.description}; incumbent/candidate evidence packets are symmetric and hash-verified`,
    }));
    const newHighRiskSecurityFindings = [
      ...(metricNumber(context.candidate, "internalIdentifierCount") > 0 ? ["opaque internal identifier exposed"] : []),
      ...(metricNumber(context.candidate, "externalRequestCount") > 0 ? ["candidate attempted an external request"] : []),
      ...(metricNumber(context.candidate, "effectRequestCount") > 0 ? ["candidate attempted a state-changing request"] : []),
    ];
    return {
      taskFingerprint: context.task.fingerprint,
      exactReplay: context.incumbent.taskFingerprint === context.candidate.taskFingerprint && context.candidate.taskFingerprint === context.task.fingerprint,
      incumbentTaskSucceeded: context.incumbent.taskSucceeded,
      candidateTaskSucceeded: context.candidate.taskSucceeded,
      gates,
      scores: { incumbent: dimensionScores(context.incumbent), candidate: dimensionScores(context.candidate) },
      newHighRiskSecurityFindings,
      passed: gates.every((gate) => !gate.critical || gate.candidatePassed) && newHighRiskSecurityFindings.length === 0,
      evaluatedAt: new Date().toISOString(),
    };
  }
}

const WEIGHTS: Record<keyof DimensionScores, number> = {
  taskSuccessClarity: 0.3,
  decisionUsefulness: 0.2,
  authoredVisualQuality: 0.2,
  accessibilityResponsive: 0.1,
  functionalRegression: 0.1,
  securityPrivacy: 0.1,
};

function scoreArm(arm: BlindJudgeInput["arms"][number]): number {
  return (Object.keys(WEIGHTS) as Array<keyof DimensionScores>)
    .reduce((sum, key) => sum + arm.dimensionScores[key] * WEIGHTS[key], 0);
}

export class DeterministicBlindJudge implements BlindJudge {
  async judge(input: BlindJudgeInput): Promise<BlindJudgeVerdict> {
    const [armA, armB] = input.arms;
    const scoreA = scoreArm(armA);
    const scoreB = scoreArm(armB);
    const dimensionDeltas = Object.fromEntries((Object.keys(WEIGHTS) as Array<keyof DimensionScores>)
      .map((key) => [key, armB.dimensionScores[key] - armA.dimensionScores[key]]));
    const delta = Number((scoreB - scoreA).toFixed(2));
    return {
      winner: Math.abs(delta) < 0.01 ? "tie" : delta > 0 ? "B" : "A",
      confidence: Math.min(0.99, 0.75 + Math.abs(delta) / 100),
      rationale: [Math.abs(delta) < 0.01 ? "Anonymous arms have equal deterministic outcome scores" : `Anonymous outcome score delta is ${Math.abs(delta).toFixed(2)}`],
      dimensionDeltas,
      judge: { kind: "deterministic", provider: "patchcourt", model: "pc01-paired-outcome-v1", responseId: null },
    };
  }
}

export function offlineCritics(): ProductCritic[] {
  return [new DecisionEvidenceCritic(), new PrivacyCritic(), new AccessibilityCritic()];
}
