export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const RUN_STATUSES = [
  "created",
  "snapshotting",
  "observing_incumbent",
  "criticizing",
  "compiling_feedback",
  "patching_candidate",
  "observing_candidate",
  "deterministic_gates",
  "blind_comparison",
  "promoted",
  "rejected",
  "invalid",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];
export type TerminalRunStatus = Extract<RunStatus, "promoted" | "rejected" | "invalid">;
export type Variant = "incumbent" | "candidate";
export type BlindLabel = "A" | "B";

export interface ViewportContract {
  name: string;
  width: number;
  height: number;
}

export interface TaskStepContract {
  id: string;
  instruction: string;
}

export interface CriticalInvariantContract {
  id: string;
  category: "functionality" | "accessibility" | "security" | "privacy" | "responsive";
  description: string;
}

export interface FrozenTaskContract {
  version: string;
  userTask: string;
  fingerprint: string;
  steps: TaskStepContract[];
  viewports: ViewportContract[];
  criticalInvariants: CriticalInvariantContract[];
}

export interface RunRequest {
  targetUrl: string;
  userTask: string;
  taskContractVersion?: string;
  demoSlug?: string;
}

export interface SourceSnapshot {
  benchmarkId: string;
  appId: string;
  digest: string;
  candidateDigest?: string;
  patchDigest?: string;
  verifiedFactsDigest?: string;
  manifestDigest: string;
  capturedAt: string;
  ownedTarget: true;
  allowlistedFiles: string[];
}

export type EvidenceKind =
  | "screenshot"
  | "dom"
  | "accessibility"
  | "console"
  | "network"
  | "trace";

export interface EvidenceArtifact {
  id: string;
  kind: EvidenceKind;
  label: string;
  uri: string;
  sha256: string;
  stepId: string;
  variant: Variant;
  viewport: string;
  capturedAt: string;
  observation: string;
}

export interface JourneyStep {
  id: string;
  instruction: string;
  status: "passed" | "failed" | "blocked";
  observation: string;
  evidenceIds: string[];
}

export interface JourneyEvidence {
  variant: Variant;
  targetUrl: string;
  taskFingerprint: string;
  taskSucceeded: boolean;
  steps: JourneyStep[];
  artifacts: EvidenceArtifact[];
  metrics: Record<string, string | number | boolean>;
  startedAt: string;
  completedAt: string;
}

export const FINDING_DOMAINS = [
  "design",
  "usability",
  "functionality",
  "security",
  "privacy",
  "accessibility",
] as const;
export type FindingDomain = (typeof FINDING_DOMAINS)[number];

export const FINDING_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export interface FindingEvidenceReference {
  artifactId: string;
  observation: string;
}

export interface CriticFindingInput {
  id?: string;
  criticId: string;
  domain: FindingDomain;
  severity: FindingSeverity;
  title: string;
  evidence: FindingEvidenceReference[];
  reproduction: string[];
  userImpact: string;
  expectedBehavior: string;
  patchLocus: string;
  proposedDirection: string;
  acceptanceChecks: string[];
  regressionRisks: string[];
}

export interface AtomicFinding extends Omit<CriticFindingInput, "id"> {
  id: string;
  evidenceIds: string[];
  fingerprint: string;
}

export interface RejectedFinding {
  criticId: string;
  proposedId?: string;
  reasons: string[];
}

export interface CriticProvenanceEntry {
  criticId: string;
  proposedCount: number;
  acceptedCount: number;
  rejectedCount: number;
}

export interface CriticProvenanceProof {
  entries: CriticProvenanceEntry[];
  acceptedCriticIdsDigest: string;
  digest: string;
}

export interface ImplementationBrief {
  schemaVersion: 1;
  digest: string;
  taskFingerprint: string;
  findings: AtomicFinding[];
  acceptanceChecks: string[];
  protectedBehaviors: string[];
  rejectedFindings: RejectedFinding[];
  criticProvenance: CriticProvenanceEntry[];
  acceptedCriticIdsDigest: string;
  compiledAt: string;
}

export interface PatchCandidate {
  id: string;
  title: string;
  status: "applied";
  baseDigest: string;
  candidateDigest: string;
  diffDigest: string;
  diff: string;
  files: string[];
  rationale: string;
  appliedAt: string;
  provider?: {
    name: string;
    model: string;
    requestId?: string;
    mode: "live" | "deterministic";
  };
  runtimeArtifactId?: string;
  runtimeArtifactSha256?: string;
  groundingArtifactId?: string;
  groundingArtifactSha256?: string;
  verifiedFactsDigest?: string;
  synthesisAttemptCount?: number;
  rejectedSynthesisDigests?: string[];
  claimBoundary?: string;
}

export interface ExecutionMetadata {
  mode: "offline-demo" | "live-gemini";
  criticProvider: string;
  patchProvider: string;
  judgeProvider: string;
  model: string | null;
}

export interface GateResult {
  id: string;
  category: CriticalInvariantContract["category"];
  critical: boolean;
  incumbentPassed: boolean;
  candidatePassed: boolean;
  evidenceIds: string[];
  details: string;
}

export interface RegressionReport {
  taskFingerprint: string;
  exactReplay: boolean;
  incumbentTaskSucceeded: boolean;
  candidateTaskSucceeded: boolean;
  gates: GateResult[];
  scores: Record<Variant, DimensionScores>;
  newHighRiskSecurityFindings: string[];
  passed: boolean;
  evaluatedAt: string;
}

export interface DimensionScores {
  taskSuccessClarity: number;
  decisionUsefulness: number;
  authoredVisualQuality: number;
  accessibilityResponsive: number;
  functionalRegression: number;
  securityPrivacy: number;
}

export interface BlindArm {
  label: BlindLabel;
  taskSucceeded: boolean;
  dimensionScores: DimensionScores;
  evidenceIds: string[];
  gateFacts: Array<{ id: string; passed: boolean }>;
}

export interface BlindJudgeInput {
  userTask: string;
  taskFingerprint: string;
  arms: [BlindArm, BlindArm];
}

export interface BlindJudgeVerdict {
  winner: BlindLabel | "tie";
  confidence: number;
  rationale: string[];
  /** Per-dimension B score minus A score. */
  dimensionDeltas: Partial<Record<keyof DimensionScores, number>>;
  judge: {
    kind: "model" | "human" | "deterministic";
    provider: string;
    model: string;
    responseId: string | null;
    reasoningEffort?: string | null;
  };
}

export interface BlindJudgeValidationRepair {
  mode: "none" | "format-completion" | "full-rejudge";
  rejectedResponseSha256: string | null;
  invalidFields: string[];
  digest: string;
}

/** Adapter-only call accounting; the orchestrator normalizes this into BlindComparison. */
export interface BlindJudgeResult extends BlindJudgeVerdict {
  providerInvocationCount?: number;
  validationRepair?: BlindJudgeValidationRepair;
}

export interface BlindOrderCommitment {
  orderCommitmentSha256: string;
  committedAt: string;
}

export interface BlindComparison {
  protocolVersion: 1;
  orderCommitmentSha256: string;
  mappingNonce: string;
  judgeInvocationCount: number;
  validationRepair: BlindJudgeValidationRepair;
  assignment: Record<Variant, BlindLabel>;
  verdict: BlindJudgeVerdict;
  candidateWon: boolean;
  evaluatedAt: string;
}

export interface PromotionDecision {
  outcome: "promoted" | "rejected";
  reasons: string[];
  candidateWonBlindComparison: boolean;
  allCriticalGatesPassed: boolean;
  taskImproved: boolean;
  decidedAt: string;
}

export interface ReceiptEntry {
  sequence: number;
  kind: string;
  issuedAt: string;
  payloadHash: string;
  previousHash: string | null;
  hash: string;
}

export interface TerminalReceipt {
  schemaVersion: 1;
  receiptId: string;
  runId: string;
  outcome: TerminalRunStatus;
  taskContractVersion: string;
  taskFingerprint: string;
  sourceSnapshotDigest: string | null;
  verifiedFactsDigest: string | null;
  incumbentEvidenceDigest: string | null;
  candidateEvidenceDigest: string | null;
  patchDigest: string | null;
  groundingArtifactDigest: string | null;
  criticProvenanceDigest: string | null;
  criticProvenance: CriticProvenanceProof | null;
  deterministicGateDigest: string | null;
  blindComparisonDigest: string | null;
  decisionDigest: string;
  execution: ExecutionMetadata;
  ledgerHead: string;
  ledgerLength: number;
  issuedAt: string;
  verification: {
    algorithm: "sha256-chain-v1";
    canonicalization: "sorted-json-v1";
  };
}

export interface RunFailure {
  code: "cancelled_by_user" | "contract_error" | "infrastructure_error";
  stage: RunStatus;
  message: string;
}

export const RUN_EVENT_TYPES = [
  "run_created",
  "stage_started",
  "stage_completed",
  "evidence_collected",
  "findings_compiled",
  "patch_applied",
  "gates_evaluated",
  "comparison_completed",
  "run_terminal",
] as const;

export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

export interface RunEvent {
  id: string;
  sequence: number;
  type: RunEventType;
  status: RunStatus;
  at: string;
  message: string;
  data: Record<string, JsonValue>;
  payloadHash: string;
  previousHash: string | null;
  hash: string;
}

export interface CourtRun {
  schemaVersion: 1;
  id: string;
  revision: number;
  status: RunStatus;
  targetUrl: string;
  execution: ExecutionMetadata;
  task: FrozenTaskContract;
  demoSlug?: string;
  createdAt: string;
  updatedAt: string;
  snapshot?: SourceSnapshot;
  evidence: EvidenceArtifact[];
  journeys: Partial<Record<Variant, JourneyEvidence>>;
  findings: AtomicFinding[];
  brief?: ImplementationBrief;
  patch?: PatchCandidate;
  regression?: RegressionReport;
  blindCommitment?: BlindOrderCommitment;
  comparison?: BlindComparison;
  decision?: PromotionDecision;
  failure?: RunFailure;
  events: RunEvent[];
  receiptLedger: ReceiptEntry[];
  receipt?: TerminalReceipt;
  cancellationRequested: boolean;
}
