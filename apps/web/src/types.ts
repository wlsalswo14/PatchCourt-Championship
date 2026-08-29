export type ViewName = "trial" | "evidence" | "comparison" | "receipt";

export type RunMode = "recorded" | "live";

export type GateStatus = "pass" | "fail" | "pending";

export interface ReceiptArtifact {
  id: string;
  kind: string;
  label: string;
  uri: string;
  sha256: string;
  stepId: string;
  variant: "incumbent" | "candidate";
  capturedAt: string;
}

export interface ReceiptGate {
  id: string;
  critical: boolean;
  passed: boolean;
  observation: string;
  artifactIds: string[];
}

export interface ReceiptEvaluation {
  variant: "incumbent" | "candidate";
  score: number;
  metrics: {
    taskComplete: boolean;
    decisionEvidenceCount: number;
    decisionEvidenceTarget: number;
    internalIdentifierCount: number;
    externalRequestCount: number;
    effectRequestCount: number;
    accessiblePrimaryControls: boolean;
    horizontalOverflowPixels: number;
    consoleErrorCount: number;
    offerEditable: boolean;
    draftOnly: boolean;
  };
  gates: ReceiptGate[];
}

export interface VerifiedReceipt {
  schemaVersion: 1;
  receiptId: string;
  runId: string;
  benchmarkId: "PC01";
  appId: string;
  taskFingerprint: string;
  createdAt: string;
  target: {
    origin: string;
    owned: boolean;
    loopbackOnly: boolean;
    externalRequestsBlocked: boolean;
  };
  source: {
    incumbentSha256: string;
    candidateSha256: string;
    patchSha256: string;
    factsSha256: string;
  };
  execution: {
    mode: "offline-demo" | "live-gemini";
    criticProvider: string;
    patchProvider: string;
    judgeProvider: string;
    model: string | null;
  };
  criticProvenance: {
    entries: Array<{
      criticId: string;
      proposedCount: number;
      acceptedCount: number;
      rejectedCount: number;
    }>;
    acceptedCriticIdsDigest: string;
    digest: string;
  };
  artifacts: ReceiptArtifact[];
  evaluations: {
    incumbent: ReceiptEvaluation;
    candidate: ReceiptEvaluation;
  };
  blindComparison: {
    protocolVersion: 1;
    orderCommitmentSha256: string;
    status: "valid" | "tie" | "invalid";
    invocationCount: number;
    validationRepair: {
      mode: "none" | "format-completion" | "full-rejudge";
      rejectedResponseSha256: string | null;
      invalidFields: string[];
      digest: string;
    };
    winnerLabel: "A" | "B" | null;
    revealedWinner: "incumbent" | "candidate" | "tie" | "invalid";
    mappingReveal: {
      A: "incumbent" | "candidate";
      B: "incumbent" | "candidate";
      nonce: string;
    };
    judge: {
      kind: string;
      provider: string;
      model: string;
      responseId: string | null;
      reasoningEffort: string | null;
    };
    invalidReason: string | null;
    evaluatedAt: string;
  };
  comparison: {
    scoreDelta: number;
    decisionEvidenceDelta: number;
    decision: "promote" | "reject";
    reasons: string[];
  };
  lineage: { previousReceiptSha256: string | null };
  integrity: {
    algorithm: string;
    payloadSha256: string;
    ledgerHead?: string;
    ledgerLength?: number;
    attestationReceiptId?: string;
  };
}

export interface LiveRunSummary {
  id: string;
  status: string;
  events?: Array<{ id?: string; message?: string; at?: string; status?: string }>;
  receipt?: unknown;
}

export interface LiveRunEvent {
  id?: string;
  sequence?: number;
  type?: string;
  status?: string;
  at?: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface InvalidRunSummary {
  runId: string;
  status: "invalid";
  receiptId: string | null;
  failure: {
    code: string;
    stage: string;
    message: string;
  } | null;
  execution: {
    mode: "offline-demo" | "live-gemini";
    criticProvider: string;
    patchProvider: string;
    judgeProvider: string;
    model: string | null;
  } | null;
}
