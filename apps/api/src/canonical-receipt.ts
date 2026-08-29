import {
  ContractError,
  buildCriticProvenanceProof,
  contentHash,
  type CourtRun,
  type GateResult,
  type JourneyEvidence,
  type Variant,
} from "@patchcourt/core";

interface CanonicalMetrics {
  taskComplete: boolean;
  decisionEvidenceCount: number;
  decisionEvidenceTarget: 4;
  internalIdentifierCount: number;
  externalRequestCount: number;
  effectRequestCount: number;
  accessiblePrimaryControls: boolean;
  horizontalOverflowPixels: number;
  consoleErrorCount: number;
  offerEditable: boolean;
  draftOnly: boolean;
}

function numberMetric(journey: JourneyEvidence, key: string): number {
  const value = journey.metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function metrics(journey: JourneyEvidence): CanonicalMetrics {
  return {
    taskComplete: journey.taskSucceeded,
    decisionEvidenceCount: Math.min(4, numberMetric(journey, "decisionEvidenceCount")),
    decisionEvidenceTarget: 4,
    internalIdentifierCount: numberMetric(journey, "internalIdentifierCount"),
    externalRequestCount: numberMetric(journey, "externalRequestCount"),
    effectRequestCount: numberMetric(journey, "effectRequestCount"),
    accessiblePrimaryControls: journey.metrics.accessiblePrimaryControls === true,
    horizontalOverflowPixels: numberMetric(journey, "horizontalOverflowPixels"),
    consoleErrorCount: numberMetric(journey, "consoleErrorCount"),
    offerEditable: journey.metrics.offerEditable === true,
    draftOnly: journey.metrics.draftOnly === true && numberMetric(journey, "effectRequestCount") === 0,
  };
}

function score(value: CanonicalMetrics): number {
  const taskCompletion = value.taskComplete ? 30 : 0;
  const decisionEvidence = Math.min(1, value.decisionEvidenceCount / value.decisionEvidenceTarget) * 25;
  const privacyAndLocalSecurity = value.internalIdentifierCount === 0 && value.externalRequestCount === 0 ? 20 : 0;
  const accessibilityAndResponsive = value.accessiblePrimaryControls && value.horizontalOverflowPixels === 0 ? 15 : 0;
  const functionalRuntimeIntegrity = value.consoleErrorCount === 0 && value.offerEditable && value.draftOnly ? 10 : 0;
  return Number((taskCompletion + decisionEvidence + privacyAndLocalSecurity + accessibilityAndResponsive + functionalRuntimeIntegrity).toFixed(2));
}

function evaluation(run: CourtRun, variant: Variant) {
  const journey = run.journeys[variant];
  const regression = run.regression;
  if (!journey || !regression) throw new ContractError("canonical receipt requires both evaluations");
  const value = metrics(journey);
  const artifactIds = new Set(journey.artifacts.map((artifact) => artifact.id));
  return {
    variant,
    score: score(value),
    metrics: value,
    gates: regression.gates.map((gate: GateResult) => ({
      id: gate.id,
      critical: gate.critical,
      passed: variant === "incumbent" ? gate.incumbentPassed : gate.candidatePassed,
      observation: gate.id === "draft_not_sent"
        ? `${gate.details}; effectRequestCount=${value.effectRequestCount}`
        : gate.details,
      artifactIds: gate.evidenceIds.filter((id) => artifactIds.has(id)),
    })),
  };
}

const REQUIRED_GATE_IDS = [
  "owned_local_target",
  "same_task_fingerprint",
  "brand_demo_login",
  "directory_search",
  "profile_open",
  "decision_evidence_complete",
  "offer_fields_editable",
  "draft_not_sent",
  "no_internal_identifier_exposure",
  "accessible_primary_controls",
  "responsive_primary_action",
  "console_and_network_clean",
  "artifact_integrity",
] as const;

function canonicalDecision(incumbent: ReturnType<typeof evaluation>, candidate: ReturnType<typeof evaluation>, blind: {
  status: string;
  revealedWinner: string;
}) {
  const reasons: string[] = [];
  const gates = new Map(candidate.gates.map((gate) => [gate.id, gate]));
  for (const id of REQUIRED_GATE_IDS) if (!gates.get(id)?.passed) reasons.push(`critical_gate_failed:${id}`);
  if (blind.status === "invalid") reasons.push("blind_judge_invalid_evidence");
  else if (blind.status === "tie") reasons.push("blind_judge_tie_keeps_incumbent");
  else if (blind.revealedWinner !== "candidate") reasons.push("blind_judge_did_not_select_candidate");
  const scoreDelta = Number((candidate.score - incumbent.score).toFixed(2));
  const decisionEvidenceDelta = candidate.metrics.decisionEvidenceCount - incumbent.metrics.decisionEvidenceCount;
  if (scoreDelta <= 0) reasons.push("no_strict_score_improvement");
  if (decisionEvidenceDelta <= 0) reasons.push("no_strict_decision_evidence_improvement");
  const noRegressions: Array<[string, boolean, boolean]> = [
    ["task_completion_regressed", incumbent.metrics.taskComplete, candidate.metrics.taskComplete],
    ["offer_editability_regressed", incumbent.metrics.offerEditable, candidate.metrics.offerEditable],
    ["draft_safety_regressed", incumbent.metrics.draftOnly, candidate.metrics.draftOnly],
    ["effect_boundary_regressed", incumbent.metrics.effectRequestCount === 0, candidate.metrics.effectRequestCount === 0],
    ["console_health_regressed", incumbent.metrics.consoleErrorCount === 0, candidate.metrics.consoleErrorCount === 0],
    ["local_network_boundary_regressed", incumbent.metrics.externalRequestCount === 0, candidate.metrics.externalRequestCount === 0],
  ];
  for (const [reason, incumbentPassed, candidatePassed] of noRegressions) if (incumbentPassed && !candidatePassed) reasons.push(reason);
  return reasons.length > 0
    ? { scoreDelta, decisionEvidenceDelta, decision: "reject" as const, reasons }
    : { scoreDelta, decisionEvidenceDelta, decision: "promote" as const, reasons: ["strict_outcome_improvement_with_all_critical_gates_passed"] };
}

export function canonicalReceipt(run: CourtRun, previousReceiptSha256: string | null = null) {
  if (!run.receipt || !run.snapshot || !run.patch || !run.regression || !run.comparison || !run.decision) {
    throw new ContractError("run does not have a complete canonical comparison receipt");
  }
  if (!run.snapshot.verifiedFactsDigest) {
    throw new ContractError("canonical receipt requires a sealed verified-facts digest");
  }
  if (!run.brief) throw new ContractError("canonical receipt requires critic provenance");
  const criticProvenance = buildCriticProvenanceProof(run.brief);
  const incumbent = evaluation(run, "incumbent");
  const candidate = evaluation(run, "candidate");
  const comparison = run.comparison;
  const failedCritical = run.regression.gates.find((gate) => gate.critical && !gate.candidatePassed);
  const shortCircuited = comparison.judgeInvocationCount === 0;
  const tie = comparison.verdict.winner === "tie";
  const status = shortCircuited ? "invalid" : tie ? "tie" : "valid";
  const mappingReveal = comparison.assignment.incumbent === "A"
    ? { A: "incumbent" as const, B: "candidate" as const, nonce: comparison.mappingNonce }
    : { A: "candidate" as const, B: "incumbent" as const, nonce: comparison.mappingNonce };
  const revealedWinner = shortCircuited
    ? "invalid" as const
    : tie
      ? "tie" as const
      : comparison.verdict.winner === comparison.assignment.candidate
        ? "candidate" as const
        : "incumbent" as const;
  const artifacts = [
    ...run.evidence.map(({ viewport: _viewport, observation: _observation, ...artifact }) => artifact),
    ...(run.patch.groundingArtifactId && run.patch.groundingArtifactSha256 ? [{
      id: run.patch.groundingArtifactId,
      kind: "trace" as const,
      label: "Gemini candidate sealed-fact grounding map",
      uri: `artifact://${run.patch.groundingArtifactId}`,
      sha256: run.patch.groundingArtifactSha256,
      stepId: "patch-grounding",
      variant: "candidate" as const,
      capturedAt: run.patch.appliedAt,
    }] : []),
  ];
  const policyDecision = canonicalDecision(incumbent, candidate, { status, revealedWinner });
  if ((run.decision.outcome === "promoted" ? "promote" : "reject") !== policyDecision.decision) {
    throw new ContractError("core decision and canonical PC01 policy disagree");
  }
  const body = {
    schemaVersion: 1 as const,
    receiptId: `receipt-${contentHash(run.receipt.receiptId).slice(0, 24)}`,
    runId: run.id,
    benchmarkId: run.snapshot.benchmarkId,
    appId: run.snapshot.appId,
    taskFingerprint: run.task.fingerprint,
    createdAt: run.createdAt,
    execution: run.execution,
    criticProvenance,
    target: {
      origin: new URL(run.targetUrl).origin,
      owned: true as const,
      loopbackOnly: ["127.0.0.1", "localhost", "[::1]"].includes(new URL(run.targetUrl).hostname),
      externalRequestsBlocked: true as const,
    },
    source: {
      incumbentSha256: run.snapshot.digest,
      candidateSha256: run.patch.candidateDigest,
      patchSha256: run.execution.mode === "offline-demo" ? run.snapshot.patchDigest ?? run.patch.diffDigest : run.patch.diffDigest,
      factsSha256: run.snapshot.verifiedFactsDigest,
    },
    artifacts,
    evaluations: { incumbent, candidate },
    blindComparison: {
      protocolVersion: comparison.protocolVersion,
      orderCommitmentSha256: comparison.orderCommitmentSha256,
      status,
      invocationCount: comparison.judgeInvocationCount,
      validationRepair: comparison.validationRepair,
      winnerLabel: status === "valid" ? comparison.verdict.winner : null,
      revealedWinner,
      mappingReveal,
      judge: comparison.verdict.judge,
      invalidReason: shortCircuited ? `not_called:critical_gate_failed:${failedCritical?.id ?? "unknown"}` : null,
      evaluatedAt: comparison.evaluatedAt,
    },
    comparison: policyDecision,
    lineage: { previousReceiptSha256 },
  };
  return {
    ...body,
    integrity: {
      algorithm: "sha256-canonical-json-v1" as const,
      payloadSha256: contentHash(body),
      ledgerHead: run.receipt.ledgerHead,
      ledgerLength: run.receipt.ledgerLength,
      attestationReceiptId: run.receipt.receiptId,
    },
  };
}
