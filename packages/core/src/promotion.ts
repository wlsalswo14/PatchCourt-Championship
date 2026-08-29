import { ContractError } from "./errors.js";
import type { BlindComparison, PromotionDecision, RegressionReport } from "./types.js";

const SCORE_WEIGHTS = {
  taskSuccessClarity: 0.3,
  decisionUsefulness: 0.2,
  authoredVisualQuality: 0.2,
  accessibilityResponsive: 0.1,
  functionalRegression: 0.1,
  securityPrivacy: 0.1,
} as const;

export function weightedBlindScore(comparison: BlindComparison, label: "A" | "B"): number {
  const arm = comparison.verdict.dimensionDeltas;
  const sign = label === "B" ? 1 : -1;
  return Object.entries(SCORE_WEIGHTS).reduce((score, [dimension, weight]) => {
    const delta = arm[dimension as keyof typeof SCORE_WEIGHTS] ?? 0;
    return score + delta * weight * sign;
  }, 0);
}

export function decidePromotion(input: {
  regression: RegressionReport;
  comparison: BlindComparison;
  decidedAt: string;
  minimumConfidence?: number;
}): PromotionDecision {
  if (!input.regression.exactReplay) throw new ContractError("blind comparison cannot decide mismatched task replays");
  const failedCritical = input.regression.gates.filter((gate) => gate.critical && !gate.candidatePassed);
  const allCriticalGatesPassed = failedCritical.length === 0 && input.regression.newHighRiskSecurityFindings.length === 0;
  const confidenceEnough = input.comparison.verdict.confidence >= (input.minimumConfidence ?? 0.6);
  const candidateLabel = input.comparison.assignment.candidate;
  const candidateWonBlindComparison = input.comparison.verdict.winner === candidateLabel;
  const scoreDelta = weightedBlindScore(input.comparison, candidateLabel);
  const taskImproved = candidateWonBlindComparison && scoreDelta > 0 && input.regression.candidateTaskSucceeded;
  const reasons: string[] = [];

  if (!input.regression.candidateTaskSucceeded) reasons.push("candidate did not complete the frozen user task");
  if (failedCritical.length > 0) reasons.push(`critical gates failed: ${failedCritical.map((gate) => gate.id).join(", ")}`);
  if (input.regression.newHighRiskSecurityFindings.length > 0) reasons.push("candidate introduced a high-risk security or privacy regression");
  if (input.comparison.verdict.winner === "tie") reasons.push("blind comparison tied; incumbent is protected");
  else if (!candidateWonBlindComparison) reasons.push("incumbent won the blind comparison");
  if (!confidenceEnough) reasons.push("blind comparison confidence is below the promotion floor");
  if (candidateWonBlindComparison && scoreDelta <= 0) reasons.push("blind dimension evidence does not show a positive weighted outcome");

  const promoted = allCriticalGatesPassed && taskImproved && confidenceEnough;
  if (promoted) reasons.push("candidate improved the frozen user outcome and every critical gate passed");
  return {
    outcome: promoted ? "promoted" : "rejected",
    reasons,
    candidateWonBlindComparison,
    allCriticalGatesPassed,
    taskImproved,
    decidedAt: input.decidedAt,
  };
}
