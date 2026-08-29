import type {
  AtomicFinding,
  BlindJudgeInput,
  BlindJudgeResult,
  CourtRun,
  CriticFindingInput,
  FrozenTaskContract,
  ImplementationBrief,
  JourneyEvidence,
  PatchCandidate,
  RegressionReport,
  RunEvent,
  SourceSnapshot,
  Variant,
} from "./types.js";

export interface SnapshotContext {
  runId: string;
  targetUrl: string;
  task: FrozenTaskContract;
}

export interface ObservationContext extends SnapshotContext {
  variant: Variant;
  snapshot: SourceSnapshot;
  patch?: PatchCandidate;
}

export interface CriticContext {
  runId: string;
  task: FrozenTaskContract;
  snapshot: SourceSnapshot;
  incumbent: JourneyEvidence;
}

export interface PatchContext {
  runId: string;
  targetUrl: string;
  task: FrozenTaskContract;
  snapshot: SourceSnapshot;
  incumbent: JourneyEvidence;
  brief: ImplementationBrief;
}

export interface RegressionContext {
  runId: string;
  task: FrozenTaskContract;
  incumbent: JourneyEvidence;
  candidate: JourneyEvidence;
  patch: PatchCandidate;
}

export interface SourceSnapshotter {
  capture(context: SnapshotContext): Promise<SourceSnapshot>;
}

export interface EvidenceCollector {
  collect(context: ObservationContext): Promise<JourneyEvidence>;
}

export interface ProductCritic {
  readonly id: string;
  review(context: CriticContext): Promise<CriticFindingInput[]>;
}

export interface CandidatePatcher {
  apply(context: PatchContext): Promise<PatchCandidate>;
}

export interface RegressionEvaluator {
  evaluate(context: RegressionContext): Promise<RegressionReport>;
}

export interface BlindJudge {
  judge(input: BlindJudgeInput): Promise<BlindJudgeResult>;
}

export interface RunRepository {
  create(run: CourtRun): Promise<void>;
  get(runId: string): Promise<CourtRun | undefined>;
  list(): Promise<CourtRun[]>;
  save(run: CourtRun, expectedRevision: number): Promise<void>;
}

export interface Clock {
  now(): string;
}

export interface IdGenerator {
  next(prefix: string): string;
}

export type EventSink = (event: RunEvent, run: CourtRun) => void | Promise<void>;

export interface CourtAdapters {
  snapshotter: SourceSnapshotter;
  collector: EvidenceCollector;
  critics: ProductCritic[];
  patcher: CandidatePatcher;
  regression: RegressionEvaluator;
  judge: BlindJudge;
}

export interface OrchestratorOptions {
  clock?: Clock;
  ids?: IdGenerator;
  onEvent?: EventSink;
  taskDefaults?: Partial<FrozenTaskContract>;
  minimumBlindConfidence?: number;
  executionMetadata?: import("./types.js").ExecutionMetadata;
}

export type PersistedRunMutation = (run: CourtRun) => CourtRun;

export function allEvidence(run: CourtRun) {
  return Object.values(run.journeys).flatMap((journey) => journey?.artifacts ?? []);
}

export function allFindings(findings: readonly AtomicFinding[]): CriticFindingInput[] {
  return findings.map(({ evidenceIds: _evidenceIds, fingerprint: _fingerprint, ...finding }) => finding);
}
