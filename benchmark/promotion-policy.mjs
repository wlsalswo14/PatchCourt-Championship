const REQUIRED_CANDIDATE_GATES = [
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
  "artifact_integrity"
];

export function scoreMetrics(metrics) {
  const decisionRatio = Math.min(
    1,
    metrics.decisionEvidenceCount / metrics.decisionEvidenceTarget
  );
  const taskCompletion = metrics.taskComplete ? 30 : 0;
  const decisionEvidence = decisionRatio * 25;
  const privacyAndLocalSecurity =
    metrics.internalIdentifierCount === 0 && metrics.externalRequestCount === 0
      ? 20
      : 0;
  const accessibilityAndResponsive =
    metrics.accessiblePrimaryControls && metrics.horizontalOverflowPixels === 0
      ? 15
      : 0;
  const functionalRuntimeIntegrity =
    metrics.consoleErrorCount === 0 && metrics.offerEditable && metrics.draftOnly
      ? 10
      : 0;

  return Number(
    (
      taskCompletion +
      decisionEvidence +
      privacyAndLocalSecurity +
      accessibilityAndResponsive +
      functionalRuntimeIntegrity
    ).toFixed(2)
  );
}

export function candidateReadyForBlindJudge(candidate) {
  const gateMap = new Map(candidate.gates.map((gate) => [gate.id, gate]));
  return REQUIRED_CANDIDATE_GATES.every((id) => gateMap.get(id)?.passed === true);
}

export function decidePromotion(incumbent, candidate, blindComparison) {
  const reasons = [];
  const candidateGateMap = new Map(
    candidate.gates.map((gate) => [gate.id, gate])
  );

  for (const id of REQUIRED_CANDIDATE_GATES) {
    const gate = candidateGateMap.get(id);
    if (!gate || !gate.passed) {
      reasons.push(`critical_gate_failed:${id}`);
    }
  }

  if (!blindComparison || blindComparison.status === "invalid") {
    reasons.push("blind_judge_invalid_evidence");
  } else if (blindComparison.status === "tie") {
    reasons.push("blind_judge_tie_keeps_incumbent");
  } else if (blindComparison.revealedWinner !== "candidate") {
    reasons.push("blind_judge_did_not_select_candidate");
  }

  const scoreDelta = Number((candidate.score - incumbent.score).toFixed(2));
  const decisionEvidenceDelta =
    candidate.metrics.decisionEvidenceCount -
    incumbent.metrics.decisionEvidenceCount;

  if (scoreDelta <= 0) reasons.push("no_strict_score_improvement");
  if (decisionEvidenceDelta <= 0) {
    reasons.push("no_strict_decision_evidence_improvement");
  }

  const noRegressionChecks = [
    ["task_completion_regressed", incumbent.metrics.taskComplete, candidate.metrics.taskComplete],
    ["offer_editability_regressed", incumbent.metrics.offerEditable, candidate.metrics.offerEditable],
    ["draft_safety_regressed", incumbent.metrics.draftOnly, candidate.metrics.draftOnly],
    [
      "effect_boundary_regressed",
      incumbent.metrics.effectRequestCount === 0,
      candidate.metrics.effectRequestCount === 0
    ],
    [
      "console_health_regressed",
      incumbent.metrics.consoleErrorCount === 0,
      candidate.metrics.consoleErrorCount === 0
    ],
    [
      "local_network_boundary_regressed",
      incumbent.metrics.externalRequestCount === 0,
      candidate.metrics.externalRequestCount === 0
    ]
  ];

  for (const [reason, incumbentPassed, candidatePassed] of noRegressionChecks) {
    if (incumbentPassed && !candidatePassed) reasons.push(reason);
  }

  if (reasons.length > 0) {
    return { scoreDelta, decisionEvidenceDelta, decision: "reject", reasons };
  }

  return {
    scoreDelta,
    decisionEvidenceDelta,
    decision: "promote",
    reasons: ["strict_outcome_improvement_with_all_critical_gates_passed"]
  };
}

export { REQUIRED_CANDIDATE_GATES };
