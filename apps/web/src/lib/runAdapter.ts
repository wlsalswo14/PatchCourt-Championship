import { CANONICAL_USER_TASK, recordedReceipt } from "../data/recordedRun";
import { PATCHCOURT_TARGET_URL, PUBLIC_REPLAY_ONLY } from "../config";
import type { InvalidRunSummary, LiveRunEvent, LiveRunSummary, ReceiptEvaluation, VerifiedReceipt } from "../types";
import { staticAssetUrl } from "./assets";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/u, "");
const SHA256 = /^[a-f0-9]{64}$/u;
const LOOPBACK_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::[0-9]{1,5})?$/u;
const REQUIRED_GATES = new Set([
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
]);
const SSE_EVENT_TYPES = [
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
const TERMINAL_EVENT_STATUSES = new Set(["promoted", "rejected", "invalid"]);

function apiUrl(path: string) {
  return `${apiBase}${path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown, minimum = Number.NEGATIVE_INFINITY, maximum = Number.POSITIVE_INFINITY) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isInteger(value: unknown, minimum = Number.NEGATIVE_INFINITY, maximum = Number.POSITIVE_INFINITY) {
  return Number.isInteger(value) && isFiniteNumber(value, minimum, maximum);
}

function isIsoDate(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function compareCodeUnits(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasValidMetrics(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.taskComplete === "boolean" &&
    isInteger(value.decisionEvidenceCount, 0, 4) &&
    value.decisionEvidenceTarget === 4 &&
    isInteger(value.internalIdentifierCount, 0) &&
    isInteger(value.externalRequestCount, 0) &&
    isInteger(value.effectRequestCount, 0) &&
    typeof value.accessiblePrimaryControls === "boolean" &&
    isInteger(value.horizontalOverflowPixels, 0) &&
    isInteger(value.consoleErrorCount, 0) &&
    typeof value.offerEditable === "boolean" &&
    typeof value.draftOnly === "boolean"
  );
}

function hasValidEvaluation(value: unknown, variant: "incumbent" | "candidate"): value is ReceiptEvaluation {
  if (!isRecord(value) || value.variant !== variant || !isFiniteNumber(value.score, 0, 100)) return false;
  if (!hasValidMetrics(value.metrics) || !Array.isArray(value.gates) || value.gates.length !== REQUIRED_GATES.size) {
    return false;
  }
  const ids = new Set<string>();
  for (const gate of value.gates) {
    if (
      !isRecord(gate) ||
      typeof gate.id !== "string" ||
      !REQUIRED_GATES.has(gate.id) ||
      ids.has(gate.id) ||
      gate.critical !== true ||
      typeof gate.passed !== "boolean" ||
      typeof gate.observation !== "string" ||
      gate.observation.length === 0 ||
      (gate.artifactIds !== undefined &&
        (!Array.isArray(gate.artifactIds) || gate.artifactIds.some((id) => typeof id !== "string")))
    ) {
      return false;
    }
    ids.add(gate.id);
  }
  return ids.size === REQUIRED_GATES.size;
}

function hasValidArtifact(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const uri = typeof value.uri === "string" ? value.uri : "";
  const uriIsSealed =
    /^artifact:\/\/[a-z0-9][a-z0-9._-]{2,127}$/u.test(uri) ||
    /^docs\/evidence\/(?:latest|rejection)\/[a-z0-9][a-z0-9._-]{2,200}$/u.test(uri);
  return (
    typeof value.id === "string" &&
    /^[a-z0-9][a-z0-9._-]{2,127}$/u.test(value.id) &&
    ["screenshot", "dom", "accessibility", "console", "network", "trace"].includes(String(value.kind)) &&
    typeof value.label === "string" &&
    value.label.length > 0 &&
    value.label.length <= 200 &&
    uriIsSealed &&
    SHA256.test(String(value.sha256)) &&
    typeof value.stepId === "string" &&
    value.stepId.length > 0 &&
    (value.variant === "incumbent" || value.variant === "candidate") &&
    isIsoDate(value.capturedAt)
  );
}

function hasValidJudgeValidationRepair(
  value: unknown,
  invocationCount: unknown,
  status: unknown,
): boolean {
  if (
    !isRecord(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(["digest", "invalidFields", "mode", "rejectedResponseSha256"]) ||
    !["none", "format-completion", "full-rejudge"].includes(String(value.mode)) ||
    !Array.isArray(value.invalidFields) ||
    value.invalidFields.length > 16 ||
    !SHA256.test(String(value.digest)) ||
    (value.rejectedResponseSha256 !== null && !SHA256.test(String(value.rejectedResponseSha256))) ||
    !isInteger(invocationCount, 0, 2)
  ) {
    return false;
  }
  const invalidFields = value.invalidFields;
  if (
    invalidFields.some(
      (field) => typeof field !== "string" || !/^[a-z][a-zA-Z0-9._-]{0,99}$/u.test(field),
    ) ||
    new Set(invalidFields).size !== invalidFields.length ||
    invalidFields.some(
      (field, index) => index > 0 && compareCodeUnits(invalidFields[index - 1], field) >= 0,
    )
  ) {
    return false;
  }
  if (value.mode === "none") {
    if (value.rejectedResponseSha256 !== null || invalidFields.length !== 0) return false;
    return status === "invalid" ? invocationCount === 0 : invocationCount === 1;
  }
  return (
    (status === "valid" || status === "tie") &&
    invocationCount === 2 &&
    SHA256.test(String(value.rejectedResponseSha256)) &&
    invalidFields.length > 0
  );
}

function hasValidBlindComparison(value: unknown): boolean {
  if (!isRecord(value) || value.protocolVersion !== 1 || !SHA256.test(String(value.orderCommitmentSha256))) {
    return false;
  }
  if (!isRecord(value.mappingReveal) || !isRecord(value.judge)) return false;
  const mapping = value.mappingReveal;
  const mappingValid =
    ((mapping.A === "incumbent" && mapping.B === "candidate") ||
      (mapping.A === "candidate" && mapping.B === "incumbent")) &&
    typeof mapping.nonce === "string" &&
    mapping.nonce.length >= 16 &&
    mapping.nonce.length <= 200;
  const judgeValid =
    ["model", "human", "deterministic"].includes(String(value.judge.kind)) &&
    typeof value.judge.provider === "string" &&
    value.judge.provider.length > 0 &&
    typeof value.judge.model === "string" &&
    value.judge.model.length > 0 &&
    (value.judge.responseId === null || typeof value.judge.responseId === "string") &&
    (value.judge.reasoningEffort === undefined ||
      value.judge.reasoningEffort === null ||
      typeof value.judge.reasoningEffort === "string");
  if (
    !mappingValid ||
    !judgeValid ||
    !hasValidJudgeValidationRepair(value.validationRepair, value.invocationCount, value.status) ||
    !isIsoDate(value.evaluatedAt)
  ) {
    return false;
  }
  if (value.status === "valid") {
    const winner = value.winnerLabel;
    return (
      isInteger(value.invocationCount, 1) &&
      (winner === "A" || winner === "B") &&
      (value.revealedWinner === "incumbent" || value.revealedWinner === "candidate") &&
      mapping[winner] === value.revealedWinner &&
      value.invalidReason === null
    );
  }
  if (value.status === "tie") {
    return (
      isInteger(value.invocationCount, 1) &&
      value.winnerLabel === null &&
      value.revealedWinner === "tie" &&
      (value.invalidReason === null || typeof value.invalidReason === "string")
    );
  }
  return (
    value.status === "invalid" &&
    value.winnerLabel === null &&
    value.revealedWinner === "invalid" &&
    typeof value.invalidReason === "string" &&
    value.invalidReason.length > 0
  );
}

function hasValidCriticProvenance(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !Array.isArray(value.entries) ||
    value.entries.length < 1 ||
    !SHA256.test(String(value.acceptedCriticIdsDigest)) ||
    !SHA256.test(String(value.digest))
  ) {
    return false;
  }
  const criticIds = new Set<string>();
  let previousCriticId: string | null = null;
  for (const entry of value.entries) {
    if (
      !isRecord(entry) ||
      typeof entry.criticId !== "string" ||
      entry.criticId.length < 1 ||
      entry.criticId.length > 200 ||
      entry.criticId.trim() !== entry.criticId ||
      criticIds.has(entry.criticId) ||
      (previousCriticId !== null && compareCodeUnits(previousCriticId, entry.criticId) >= 0) ||
      !isInteger(entry.proposedCount, 0) ||
      !isInteger(entry.acceptedCount, 0) ||
      !isInteger(entry.rejectedCount, 0) ||
      entry.proposedCount !== Number(entry.acceptedCount) + Number(entry.rejectedCount)
    ) {
      return false;
    }
    criticIds.add(entry.criticId);
    previousCriticId = entry.criticId;
  }
  return true;
}

function hasCanonicalReceiptShape(value: unknown): value is VerifiedReceipt {
  if (!isRecord(value)) return false;
  const receipt = value as unknown as VerifiedReceipt;
  const source = receipt.source;
  const integrity = receipt.integrity;
  const candidate = receipt.evaluations?.candidate;
  const incumbent = receipt.evaluations?.incumbent;
  const comparison = receipt.comparison;
  const execution = receipt.execution;
  if (
    receipt.schemaVersion !== 1 ||
    receipt.benchmarkId !== "PC01" ||
    receipt.appId !== "patchcourt-brand-match" ||
    typeof receipt.receiptId !== "string" ||
    !/^receipt-[a-z0-9-]+$/u.test(receipt.receiptId) ||
    typeof receipt.runId !== "string" ||
    !/^pc01-[a-z0-9-]+$/u.test(receipt.runId) ||
    receipt.taskFingerprint !== recordedReceipt.taskFingerprint ||
    !isIsoDate(receipt.createdAt) ||
    !receipt.target ||
    !LOOPBACK_ORIGIN.test(receipt.target.origin) ||
    receipt.target.owned !== true ||
    receipt.target.loopbackOnly !== true ||
    receipt.target.externalRequestsBlocked !== true ||
    !source ||
    source.incumbentSha256 !== recordedReceipt.source.incumbentSha256 ||
    source.factsSha256 !== recordedReceipt.source.factsSha256 ||
    !SHA256.test(source.candidateSha256 ?? "") ||
    !SHA256.test(source.patchSha256 ?? "") ||
    !execution ||
    (execution.mode !== "offline-demo" && execution.mode !== "live-gemini") ||
    typeof execution.criticProvider !== "string" ||
    execution.criticProvider.length === 0 ||
    typeof execution.patchProvider !== "string" ||
    execution.patchProvider.length === 0 ||
    typeof execution.judgeProvider !== "string" ||
    execution.judgeProvider.length === 0 ||
    (execution.mode === "offline-demo"
      ? execution.model !== null
      : typeof execution.model !== "string" || execution.model.length === 0) ||
    !hasValidCriticProvenance(receipt.criticProvenance) ||
    !Array.isArray(receipt.artifacts) ||
    receipt.artifacts.length < 4 ||
    !receipt.artifacts.every(hasValidArtifact) ||
    !hasValidEvaluation(incumbent, "incumbent") ||
    !hasValidEvaluation(candidate, "candidate") ||
    !hasValidBlindComparison(receipt.blindComparison) ||
    !comparison ||
    !isFiniteNumber(comparison.scoreDelta) ||
    !isInteger(comparison.decisionEvidenceDelta) ||
    !Array.isArray(comparison.reasons) ||
    comparison.reasons.length < 1 ||
    comparison.reasons.some((reason) => typeof reason !== "string" || reason.length === 0) ||
    Math.abs(comparison.scoreDelta - (candidate.score - incumbent.score)) > Number.EPSILON ||
    comparison.decisionEvidenceDelta !==
      candidate.metrics.decisionEvidenceCount - incumbent.metrics.decisionEvidenceCount ||
    !receipt.lineage ||
    (receipt.lineage.previousReceiptSha256 !== null && !SHA256.test(receipt.lineage.previousReceiptSha256)) ||
    !integrity ||
    integrity.algorithm !== "sha256-canonical-json-v1" ||
    !SHA256.test(integrity.payloadSha256 ?? "")
  ) {
    return false;
  }
  const hasLedger =
    integrity.ledgerHead !== undefined ||
    integrity.ledgerLength !== undefined ||
    integrity.attestationReceiptId !== undefined;
  if (
    hasLedger &&
    (!SHA256.test(integrity.ledgerHead ?? "") ||
      !isInteger(integrity.ledgerLength, 1) ||
      typeof integrity.attestationReceiptId !== "string" ||
      integrity.attestationReceiptId.length === 0)
  ) {
    return false;
  }
  const failedCritical = candidate.gates.some((gate) => gate.critical && !gate.passed);
  const promotionConditions =
    candidate.gates.every((gate) => gate.passed) &&
    candidate.metrics.effectRequestCount === 0 &&
    candidate.metrics.draftOnly === true &&
    comparison.scoreDelta > 0 &&
    comparison.decisionEvidenceDelta > 0 &&
    receipt.blindComparison.status === "valid" &&
    receipt.blindComparison.revealedWinner === "candidate" &&
    receipt.blindComparison.invalidReason === null;
  if (comparison.decision === "promote") return promotionConditions;
  if (comparison.decision !== "reject") return false;
  return (
    failedCritical ||
    comparison.scoreDelta <= 0 ||
    comparison.decisionEvidenceDelta <= 0 ||
    receipt.blindComparison.status !== "valid" ||
    receipt.blindComparison.revealedWinner !== "candidate"
  );
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON rejects non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) result[key] = canonicalize(value[key]);
    }
    return result;
  }
  throw new TypeError(`canonical JSON cannot encode ${typeof value}`);
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyReceipt(value: unknown): Promise<boolean> {
  if (!hasCanonicalReceiptShape(value)) return false;
  const { integrity: _integrity, ...body } = value;
  const computed = await sha256(JSON.stringify(canonicalize(body)));
  if (computed !== value.integrity.payloadSha256) return false;
  if (!(await verifyBlindOrderCommitment(value))) return false;
  if (!(await verifyCriticProvenance(value))) return false;
  return verifyJudgeValidationRepair(value);
}

export async function verifyBlindOrderCommitment(receipt: VerifiedReceipt): Promise<boolean> {
  const reveal = receipt.blindComparison.mappingReveal;
  const expectedCommitment = await sha256(
    JSON.stringify(
      canonicalize({
        mapping: { A: reveal.A, B: reveal.B },
        nonce: reveal.nonce,
        taskFingerprint: receipt.taskFingerprint,
      }),
    ),
  );
  return expectedCommitment === receipt.blindComparison.orderCommitmentSha256;
}

export async function verifyCriticProvenance(receipt: VerifiedReceipt): Promise<boolean> {
  if (!hasValidCriticProvenance(receipt.criticProvenance)) return false;
  const entries = [...receipt.criticProvenance.entries].sort((left, right) =>
    compareCodeUnits(left.criticId, right.criticId),
  );
  const acceptedCriticIds = entries
    .filter((entry) => entry.acceptedCount > 0)
    .map((entry) => entry.criticId);
  const acceptedDigest = await sha256(JSON.stringify(canonicalize(acceptedCriticIds)));
  if (acceptedDigest !== receipt.criticProvenance.acceptedCriticIdsDigest) return false;
  const proofDigest = await sha256(
    JSON.stringify(
      canonicalize({
        entries,
        acceptedCriticIdsDigest: receipt.criticProvenance.acceptedCriticIdsDigest,
      }),
    ),
  );
  return proofDigest === receipt.criticProvenance.digest;
}

export async function verifyJudgeValidationRepair(receipt: VerifiedReceipt): Promise<boolean> {
  const repair = receipt.blindComparison.validationRepair;
  if (
    !hasValidJudgeValidationRepair(
      repair,
      receipt.blindComparison.invocationCount,
      receipt.blindComparison.status,
    )
  ) {
    return false;
  }
  const expectedDigest = await sha256(
    JSON.stringify(
      canonicalize({
        mode: repair.mode,
        rejectedResponseSha256: repair.rejectedResponseSha256,
        invalidFields: repair.invalidFields,
      }),
    ),
  );
  return repair.digest === expectedDigest;
}

export async function verifyPromotionReceipt(value: unknown): Promise<boolean> {
  return (await verifyReceipt(value)) && (value as VerifiedReceipt).comparison.decision === "promote";
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: { accept: "application/json", ...init?.headers },
  });
  if (!response.ok) throw new Error(`patchcourt_http_${response.status}`);
  return response.json();
}

export async function fetchRunReceipt(runId: string): Promise<VerifiedReceipt> {
  const value = await requestJson(`/api/runs/${encodeURIComponent(runId)}/receipt`);
  if (!(await verifyReceipt(value)) || (value as VerifiedReceipt).runId !== runId) {
    throw new Error("receipt_contract_invalid");
  }
  return value as VerifiedReceipt;
}

function sanitizeRunText(value: unknown, fallback: string, maximum = 240): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  return value
    .replace(/AIza[A-Za-z0-9_-]{20,}/gu, "[redacted]")
    .replace(/\b(?:api[_ -]?key|token|secret)\s*[:=]\s*\S+/giu, "credential=[redacted]")
    .replace(/https?:\/\/[^\s]+/giu, "[endpoint]")
    .slice(0, maximum);
}

function executionFromUnknown(value: unknown): InvalidRunSummary["execution"] {
  if (!isRecord(value)) return null;
  if (value.mode !== "offline-demo" && value.mode !== "live-gemini") return null;
  if (
    typeof value.criticProvider !== "string" ||
    typeof value.patchProvider !== "string" ||
    typeof value.judgeProvider !== "string" ||
    (value.model !== null && typeof value.model !== "string")
  ) {
    return null;
  }
  return {
    mode: value.mode,
    criticProvider: sanitizeRunText(value.criticProvider, "unknown-provider", 100),
    patchProvider: sanitizeRunText(value.patchProvider, "unknown-provider", 100),
    judgeProvider: sanitizeRunText(value.judgeProvider, "unknown-provider", 100),
    model: value.model === null ? null : sanitizeRunText(value.model, "unknown-model", 100),
  };
}

export async function fetchInvalidRunSummary(
  runId: string,
  readyReceiptId: string | null,
): Promise<InvalidRunSummary> {
  const value = await requestJson(`/api/runs/${encodeURIComponent(runId)}`);
  if (!isRecord(value) || value.id !== runId || value.status !== "invalid") {
    throw new Error("invalid_run_summary_contract_invalid");
  }
  const failure = isRecord(value.failure)
    ? {
        code: sanitizeRunText(value.failure.code, "unknown_failure", 80),
        stage: sanitizeRunText(value.failure.stage, "unknown_stage", 80),
        message: sanitizeRunText(value.failure.message, "실행 제공자 오류로 평가가 완료되지 않았습니다."),
      }
    : null;
  const internalReceiptId = isRecord(value.receipt) && typeof value.receipt.receiptId === "string"
    ? sanitizeRunText(value.receipt.receiptId, "", 160)
    : readyReceiptId;
  return {
    runId,
    status: "invalid",
    receiptId: internalReceiptId,
    failure,
    execution: executionFromUnknown(value.execution),
  };
}

export async function loadPreferredReceipt(): Promise<{
  receipt: VerifiedReceipt;
  source: "recorded" | "public-recorded";
}> {
  if (!(await verifyPromotionReceipt(recordedReceipt))) {
    throw new Error("embedded_receipt_contract_invalid");
  }
  return {
    receipt: recordedReceipt,
    source: PUBLIC_REPLAY_ONLY ? "public-recorded" : "recorded",
  };
}

export async function createLiveRun(): Promise<LiveRunSummary> {
  if (PUBLIC_REPLAY_ONLY) throw new Error("public_replay_only");
  const payload = await requestJson("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      targetUrl: PATCHCOURT_TARGET_URL,
      userTask: CANONICAL_USER_TASK,
      taskContractVersion: "pc01-v1",
      demoSlug: "championship",
    }),
  });
  if (!isRecord(payload) || typeof payload.id !== "string" || typeof payload.status !== "string") {
    throw new Error("live_run_contract_invalid");
  }
  return payload as unknown as LiveRunSummary;
}

interface RunSubscriptionHandlers {
  onEvent: (event: LiveRunEvent) => void;
  onReceiptReady: (payload: { runId: string; receiptId: string | null; status: string }) => void;
  onConnectionError: () => void;
}

export function subscribeToRun(runId: string, handlers: RunSubscriptionHandlers) {
  const source = new EventSource(apiUrl(`/api/runs/${encodeURIComponent(runId)}/events`));
  let finished = false;
  let manuallyClosed = false;

  const handleRunEvent = (event: Event) => {
    try {
      handlers.onEvent(JSON.parse((event as MessageEvent<string>).data) as LiveRunEvent);
    } catch {
      handlers.onEvent({ type: "invalid_event", message: "실시간 이벤트를 해석하지 못했습니다." });
    }
  };
  for (const type of SSE_EVENT_TYPES) source.addEventListener(type, handleRunEvent);

  source.addEventListener("receipt_ready", (event) => {
    try {
      const value = JSON.parse((event as MessageEvent<string>).data) as unknown;
      if (
        !isRecord(value) ||
        value.runId !== runId ||
        (value.receiptId !== null && typeof value.receiptId !== "string") ||
        typeof value.status !== "string" ||
        !TERMINAL_EVENT_STATUSES.has(value.status)
      ) {
        throw new TypeError("receipt_ready contract mismatch");
      }
      finished = true;
      source.close();
      handlers.onReceiptReady({
        runId: value.runId,
        receiptId: value.receiptId,
        status: value.status,
      });
    } catch {
      finished = true;
      source.close();
      handlers.onEvent({
        type: "invalid_event",
        message: "종료 이벤트가 현재 run 계약과 일치하지 않습니다.",
      });
      handlers.onConnectionError();
    }
  });

  source.onerror = () => {
    if (!finished && !manuallyClosed) handlers.onConnectionError();
  };

  return () => {
    manuallyClosed = true;
    source.close();
  };
}

export function resolveArtifactUri(uri: string): string | null {
  const artifactMatch = /^artifact:\/\/([a-z0-9][a-z0-9._-]{2,127})$/u.exec(uri);
  if (artifactMatch) {
    return apiUrl(`/api/artifacts/${encodeURIComponent(artifactMatch[1])}`);
  }
  const recordedMatch = /^docs\/evidence\/(?:latest|rejection)\/([a-z0-9][a-z0-9._-]{2,200})$/u.exec(uri);
  if (recordedMatch) {
    return staticAssetUrl(`evidence/${encodeURIComponent(recordedMatch[1])}`);
  }
  return null;
}

export function downloadReceipt(receipt: VerifiedReceipt) {
  const blob = new Blob([JSON.stringify(receipt, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${receipt.receiptId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
