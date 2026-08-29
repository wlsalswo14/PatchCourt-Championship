/// <reference types="node" />

import { readFile } from "node:fs/promises";
import { createHash, webcrypto } from "node:crypto";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CANONICAL_USER_TASK,
  recordedReceipt,
  recordedRejectionReceipt,
} from "../data/recordedRun";
import {
  createLiveRun,
  fetchInvalidRunSummary,
  fetchRunReceipt,
  loadPreferredReceipt,
  resolveArtifactUri,
  subscribeToRun,
  verifyBlindOrderCommitment,
  verifyCriticProvenance,
  verifyJudgeValidationRepair,
  verifyPromotionReceipt,
  verifyReceipt,
} from "./runAdapter";
import { PATCHCOURT_TARGET_URL } from "../config";

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
  }
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("canonical receipt boundary", () => {
  it("keeps both embedded receipts byte-for-byte synced with authoritative evidence", async () => {
    const [embeddedPromotion, authoritativePromotion, embeddedRejection, authoritativeRejection] =
      await Promise.all([
        readFile(resolve(process.cwd(), "src/data/pc01-receipt.json"), "utf8"),
        readFile(resolve(process.cwd(), "../../docs/evidence/latest/receipt.json"), "utf8"),
        readFile(resolve(process.cwd(), "src/data/pc01-rejection-receipt.json"), "utf8"),
        readFile(resolve(process.cwd(), "../../docs/evidence/rejection/receipt.json"), "utf8"),
      ]);
    expect(embeddedPromotion).toBe(authoritativePromotion);
    expect(embeddedRejection).toBe(authoritativeRejection);
  });

  it("verifies promotion and clean rejection payload hashes with execution provenance", async () => {
    expect(recordedReceipt.execution).toMatchObject({ mode: "offline-demo", model: null });
    expect(recordedRejectionReceipt.execution).toMatchObject({ mode: "offline-demo", model: null });
    await expect(verifyReceipt(recordedReceipt)).resolves.toBe(true);
    await expect(verifyPromotionReceipt(recordedReceipt)).resolves.toBe(true);
    await expect(verifyReceipt(recordedRejectionReceipt)).resolves.toBe(true);
    await expect(verifyPromotionReceipt(recordedRejectionReceipt)).resolves.toBe(false);
  });

  it("rejects a shape-valid receipt after any payload tampering", async () => {
    const tampered = structuredClone(recordedReceipt);
    tampered.evaluations.candidate.score -= 1;
    tampered.comparison.scoreDelta -= 1;
    await expect(verifyReceipt(tampered)).resolves.toBe(false);
  });

  it("rejects tampered judge-repair provenance even when the outer payload hash is recomputed", async () => {
    const canonicalJson = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
          .join(",")}}`;
      }
      return JSON.stringify(value);
    };
    const tampered = structuredClone(recordedReceipt);
    tampered.blindComparison.validationRepair.digest = "f".repeat(64);
    const { integrity: _discarded, ...payload } = tampered;
    tampered.integrity.payloadSha256 = createHash("sha256")
      .update(canonicalJson(payload))
      .digest("hex");
    await expect(verifyReceipt(tampered)).resolves.toBe(false);
  });

  it("recomputes the sealed order from mapping, nonce, and task fingerprint", async () => {
    await expect(verifyBlindOrderCommitment(recordedReceipt)).resolves.toBe(true);
    const remapped = structuredClone(recordedReceipt);
    remapped.blindComparison.mappingReveal.nonce = `${remapped.blindComparison.mappingReveal.nonce}x`;
    await expect(verifyBlindOrderCommitment(remapped)).resolves.toBe(false);
  });

  it("recomputes critic proposal selection and proof digests", async () => {
    await expect(verifyCriticProvenance(recordedReceipt)).resolves.toBe(true);
    const tampered = structuredClone(recordedReceipt);
    tampered.criticProvenance.entries[0].acceptedCount += 1;
    await expect(verifyCriticProvenance(tampered)).resolves.toBe(false);
  });

  it("uses the canonical entries key and code-unit order for critic proofs", async () => {
    const canonicalJson = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
          .join(",")}}`;
      }
      return JSON.stringify(value);
    };
    const digest = (value: unknown) =>
      createHash("sha256").update(canonicalJson(value)).digest("hex");
    const entries = [
      { criticId: "gemini-a", proposedCount: 2, acceptedCount: 1, rejectedCount: 1 },
      { criticId: "metric-b", proposedCount: 1, acceptedCount: 1, rejectedCount: 0 },
    ];
    const acceptedCriticIdsDigest = digest(["gemini-a", "metric-b"]);
    const receipt = structuredClone(recordedReceipt);
    receipt.criticProvenance = {
      entries,
      acceptedCriticIdsDigest,
      digest: digest({ entries, acceptedCriticIdsDigest }),
    };
    await expect(verifyCriticProvenance(receipt)).resolves.toBe(true);

    receipt.criticProvenance.entries.reverse();
    await expect(verifyCriticProvenance(receipt)).resolves.toBe(false);
  });

  it("recomputes bounded judge validation repair metadata and invocation counts", async () => {
    const canonicalJson = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
          .join(",")}}`;
      }
      return JSON.stringify(value);
    };
    const digest = (value: unknown) =>
      createHash("sha256").update(canonicalJson(value)).digest("hex");
    const receipt = structuredClone(recordedReceipt);
    const direct = {
      mode: "none" as const,
      rejectedResponseSha256: null,
      invalidFields: [] as string[],
    };
    receipt.blindComparison.status = "valid";
    receipt.blindComparison.invocationCount = 1;
    receipt.blindComparison.validationRepair = { ...direct, digest: digest(direct) };
    await expect(verifyJudgeValidationRepair(receipt)).resolves.toBe(true);

    const repaired = {
      mode: "format-completion" as const,
      rejectedResponseSha256: "a".repeat(64),
      invalidFields: ["winnerLabel"],
    };
    receipt.blindComparison.invocationCount = 2;
    receipt.blindComparison.validationRepair = { ...repaired, digest: digest(repaired) };
    await expect(verifyJudgeValidationRepair(receipt)).resolves.toBe(true);

    receipt.blindComparison.validationRepair.digest = "b".repeat(64);
    await expect(verifyJudgeValidationRepair(receipt)).resolves.toBe(false);
    receipt.blindComparison.validationRepair = { ...repaired, digest: digest(repaired) };
    receipt.blindComparison.invocationCount = 1;
    await expect(verifyJudgeValidationRepair(receipt)).resolves.toBe(false);
    receipt.blindComparison.invocationCount = 2;
    receipt.blindComparison.validationRepair.invalidFields = ["winnerLabel", "WinnerLabel"];
    await expect(verifyJudgeValidationRepair(receipt)).resolves.toBe(false);
  });

  it("accepts a hashed rejection from the terminal receipt endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => recordedRejectionReceipt,
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchRunReceipt(recordedRejectionReceipt.runId)).resolves.toEqual(
      recordedRejectionReceipt,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/runs/${recordedRejectionReceipt.runId}/receipt`,
      expect.objectContaining({ headers: expect.objectContaining({ accept: "application/json" }) }),
    );
  });

  it("verifies the CI-embedded promotion without a cold-start API probe", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadPreferredReceipt()).resolves.toEqual({
      receipt: recordedReceipt,
      source: "recorded",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits the frozen PC01 contract to same-origin /api", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "pc01-live-opaque", status: "created" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await createLiveRun();
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runs");
    expect(JSON.parse(String(request.body))).toEqual({
      targetUrl: PATCHCOURT_TARGET_URL,
      userTask: CANONICAL_USER_TASK,
      taskContractVersion: "pc01-v1",
      demoSlug: "championship",
    });
  });

  it("reduces an invalid CourtRun to a sanitized non-verdict summary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "pc01-invalid-opaque",
        status: "invalid",
        failure: {
          code: "infrastructure_error",
          stage: "criticizing",
          message: "token=super-secret https://provider.example/internal failed",
        },
        execution: {
          mode: "live-gemini",
          criticProvider: "gemini",
          patchProvider: "gemini",
          judgeProvider: "not-called",
          model: "gemini-3.6-flash",
        },
        receipt: { receiptId: "receipt-internal-invalid" },
      }),
    }));
    await expect(fetchInvalidRunSummary("pc01-invalid-opaque", null)).resolves.toEqual({
      runId: "pc01-invalid-opaque",
      status: "invalid",
      receiptId: "receipt-internal-invalid",
      failure: {
        code: "infrastructure_error",
        stage: "criticizing",
        message: "credential=[redacted] [endpoint] failed",
      },
      execution: {
        mode: "live-gemini",
        criticProvider: "gemini",
        patchProvider: "gemini",
        judgeProvider: "not-called",
        model: "gemini-3.6-flash",
      },
    });
  });

  it("resolves recorded evidence under the configured Vite base", () => {
    const resolved = resolveArtifactUri("docs/evidence/latest/incumbent-desktop-profile.png");
    expect(resolved).toMatch(/evidence\/incumbent-desktop-profile\.png$/u);
    expect(resolved).toBe(`${import.meta.env.BASE_URL}evidence/incumbent-desktop-profile.png`);
    expect(resolveArtifactUri("artifact://opaque-123")).toBe("/api/artifacts/opaque-123");
    expect(resolveArtifactUri("artifact://../../outside")).toBeNull();
    expect(resolveArtifactUri("docs/evidence/latest/../outside.png")).toBeNull();
  });
});

class MockEventSource {
  static latest: MockEventSource | null = null;
  readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();
  onerror: (() => void) | null = null;
  closed = false;
  readonly url: string;

  constructor(url: string | URL) {
    this.url = String(url);
    MockEventSource.latest = this;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.set(type, listener as (event: MessageEvent<string>) => void);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    this.listeners.get(type)?.(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

describe("named SSE adapter", () => {
  it("subscribes to every named event, closes normally, and delegates receipt fetch by ID", () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const onEvent = vi.fn();
    const onReceiptReady = vi.fn();
    const onConnectionError = vi.fn();
    subscribeToRun("pc01-live-opaque", { onEvent, onReceiptReady, onConnectionError });
    const source = MockEventSource.latest;
    expect(source?.url).toBe("/api/runs/pc01-live-opaque/events");
    expect([...source!.listeners.keys()]).toEqual([
      "run_created",
      "stage_started",
      "stage_completed",
      "evidence_collected",
      "findings_compiled",
      "patch_applied",
      "gates_evaluated",
      "comparison_completed",
      "run_terminal",
      "receipt_ready",
    ]);

    source?.emit("stage_started", {
      type: "stage_started",
      status: "criticizing",
      at: "2026-08-29T15:00:00.000Z",
      message: "grounded critic started",
    });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ status: "criticizing" }));

    source?.emit("receipt_ready", {
      runId: "pc01-live-opaque",
      receiptId: recordedReceipt.receiptId,
      status: "promoted",
    });
    source?.onerror?.();
    expect(source?.closed).toBe(true);
    expect(onReceiptReady).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "pc01-live-opaque", status: "promoted" }),
    );
    expect(onConnectionError).not.toHaveBeenCalled();
  });

  it("does not convert a mismatched terminal event into an authoritative invalid run", () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const onEvent = vi.fn();
    const onReceiptReady = vi.fn();
    const onConnectionError = vi.fn();
    subscribeToRun("pc01-live-current", { onEvent, onReceiptReady, onConnectionError });
    const source = MockEventSource.latest;

    source?.emit("receipt_ready", {
      runId: "pc01-live-different",
      receiptId: "receipt-internal-invalid",
      status: "invalid",
    });

    expect(source?.closed).toBe(true);
    expect(onReceiptReady).not.toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "invalid_event", message: expect.stringContaining("현재 run") }),
    );
    expect(onConnectionError).toHaveBeenCalledOnce();
  });
});
