import { expect, test } from "@playwright/test";
import {
  REQUIRED_CANDIDATE_GATES,
  candidateReadyForBlindJudge,
  decidePromotion,
  scoreMetrics
} from "../../benchmark/promotion-policy.mjs";

function metrics(overrides = {}) {
  return {
    taskComplete: true,
    decisionEvidenceCount: 4,
    decisionEvidenceTarget: 4,
    internalIdentifierCount: 0,
    externalRequestCount: 0,
    effectRequestCount: 0,
    accessiblePrimaryControls: true,
    horizontalOverflowPixels: 0,
    consoleErrorCount: 0,
    offerEditable: true,
    draftOnly: true,
    ...overrides
  };
}

function evaluation(variant, value) {
  return {
    variant,
    metrics: value,
    score: scoreMetrics(value),
    gates: REQUIRED_CANDIDATE_GATES.map((id) => ({
      id,
      critical: true,
      passed: true,
      observation: "fixture"
    }))
  };
}

const validCandidateWin = {
  status: "valid",
  revealedWinner: "candidate"
};

test("valid blind win plus objective improvement can promote", () => {
  const incumbent = evaluation("incumbent", metrics({ decisionEvidenceCount: 1, internalIdentifierCount: 2 }));
  const candidate = evaluation("candidate", metrics());
  expect(decidePromotion(incumbent, candidate, validCandidateWin).decision).toBe("promote");
});

test("invalid judge evidence cannot be read as a score win", () => {
  const incumbent = evaluation("incumbent", metrics({ decisionEvidenceCount: 1, internalIdentifierCount: 2 }));
  const candidate = evaluation("candidate", metrics());
  const result = decidePromotion(incumbent, candidate, { status: "invalid", revealedWinner: "invalid" });
  expect(result.decision).toBe("reject");
  expect(result.reasons).toContain("blind_judge_invalid_evidence");
});

test("judge tie keeps the incumbent", () => {
  const incumbent = evaluation("incumbent", metrics({ decisionEvidenceCount: 1, internalIdentifierCount: 2 }));
  const candidate = evaluation("candidate", metrics());
  const result = decidePromotion(incumbent, candidate, { status: "tie", revealedWinner: "tie" });
  expect(result.decision).toBe("reject");
  expect(result.reasons).toContain("blind_judge_tie_keeps_incumbent");
});

test("critical gate failure overrides a blind candidate win", () => {
  const incumbent = evaluation("incumbent", metrics({ decisionEvidenceCount: 1, internalIdentifierCount: 2 }));
  const candidate = evaluation("candidate", metrics());
  candidate.gates.find(({ id }) => id === "draft_not_sent").passed = false;
  expect(candidateReadyForBlindJudge(candidate)).toBe(false);
  const result = decidePromotion(incumbent, candidate, validCandidateWin);
  expect(result.decision).toBe("reject");
  expect(result.reasons).toContain("critical_gate_failed:draft_not_sent");
});
