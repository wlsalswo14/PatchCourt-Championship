import { createHash } from "node:crypto";

import type { JsonValue, ReceiptEntry, RunEvent, RunEventType, RunStatus } from "./types.js";

const SENSITIVE_KEY = /(?:api[-_]?key|authorization|cookie|password|secret|token|credential|private[-_]?payload)/i;
const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_-]{20,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{12,}/g,
  /([?&](?:key|token|secret|signature|auth)=)[^&#\s]+/gi,
  /(?:[A-Za-z]:\\|\/(?:Users|home)\/)[^\s"']+/g,
] as const;

function canonicalize(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON rejects non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) result[key] = canonicalize(source[key]);
    }
    return result;
  }
  throw new TypeError(`canonical JSON cannot encode ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function contentHash(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function redactText(value: string): string {
  let result = value;
  for (const pattern of SECRET_PATTERNS) result = result.replace(pattern, "[REDACTED]");
  return result;
}

export function sanitizeForPersistence(value: unknown): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return canonicalize(value);
  }
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeForPersistence(item));
  if (typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeForPersistence(child);
    }
    return result;
  }
  return String(value);
}

export function appendReceipt(
  ledger: readonly ReceiptEntry[],
  kind: string,
  payload: unknown,
  issuedAt: string,
): ReceiptEntry {
  const sequence = ledger.length + 1;
  const previousHash = ledger.at(-1)?.hash ?? null;
  const payloadHash = contentHash(sanitizeForPersistence(payload));
  const body = { sequence, kind, issuedAt, payloadHash, previousHash };
  return { ...body, hash: contentHash(body) };
}

export function appendEvent(
  events: readonly RunEvent[],
  id: string,
  type: RunEventType,
  status: RunStatus,
  message: string,
  data: Record<string, JsonValue>,
  at: string,
): RunEvent {
  const sequence = events.length + 1;
  const previousHash = events.at(-1)?.hash ?? null;
  const cleanData = sanitizeForPersistence(data) as Record<string, JsonValue>;
  const payloadHash = contentHash({ type, status, message: redactText(message), data: cleanData });
  const body = { id, sequence, type, status, at, message: redactText(message), data: cleanData, payloadHash, previousHash };
  return { ...body, hash: contentHash(body) };
}

export function verifyReceiptChain(ledger: readonly ReceiptEntry[]): boolean {
  let previousHash: string | null = null;
  for (let index = 0; index < ledger.length; index += 1) {
    const entry = ledger[index];
    if (!entry || entry.sequence !== index + 1 || entry.previousHash !== previousHash) return false;
    const body = {
      sequence: entry.sequence,
      kind: entry.kind,
      issuedAt: entry.issuedAt,
      payloadHash: entry.payloadHash,
      previousHash: entry.previousHash,
    };
    if (entry.hash !== contentHash(body)) return false;
    previousHash = entry.hash;
  }
  return true;
}
