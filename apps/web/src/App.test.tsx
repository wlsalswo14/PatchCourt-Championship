/// <reference types="node" />

import { webcrypto } from "node:crypto";
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { recordedReceipt, recordedRejectionReceipt } from "./data/recordedRun";

class AppEventSource {
  static latest: AppEventSource | null = null;
  listeners = new Map<string, (event: MessageEvent<string>) => void>();
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string | URL) {
    AppEventSource.latest = this;
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

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
  }
});

beforeEach(() => {
  vi.stubGlobal("EventSource", AppEventSource);
  AppEventSource.latest = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("App workflow", () => {
  it("verifies the embedded startup receipt without a request under StrictMode", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    expect(
      await screen.findByText("네트워크 요청 없이 저장된 해시 검증 PC01 리플레이를 준비했습니다."),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("검증된 리플레이")).toBeInTheDocument();
    expect(screen.queryByText("실시간 재판")).not.toBeInTheDocument();
    expect(screen.getByText(recordedReceipt.receiptId)).toBeInTheDocument();
  });

  it("falls back to the already-verified replay when the live POST fails", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/runs") return Promise.reject(new TypeError("api offline"));
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await screen.findByText("네트워크 요청 없이 저장된 해시 검증 PC01 리플레이를 준비했습니다.");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "증거 재판 시작" }));

    expect(
      await screen.findByText(/검증된 60초 재판을 압축 재생 중입니다/u),
    ).toBeInTheDocument();
    expect(screen.getByText("검증된 리플레이")).toBeInTheDocument();
    expect(screen.queryByText("실시간 재판")).not.toBeInTheDocument();
    expect(screen.getByText(recordedReceipt.receiptId)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("progresses the compressed 60-second replay through evidence, comparison, and receipt", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await screen.findByText("네트워크 요청 없이 저장된 해시 검증 PC01 리플레이를 준비했습니다.");
    expect(fetchMock).not.toHaveBeenCalled();

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "60초 데모 시나리오 압축 재생" }));
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");

    act(() => vi.advanceTimersByTime(1_800));
    expect(screen.getByRole("heading", { name: /결함은 주장으로 채택되기 전에/u })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1_800));
    expect(screen.getByRole("heading", { name: /같은 여정에서 더 나은 쪽/u })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(900));
    const championHeading = screen.getByRole("heading", { name: "CHAMPION" });
    expect(championHeading).toBeInTheDocument();
    expect(document.activeElement).toBe(championHeading);
    expect(screen.getByText("13 / 13 통과")).toBeInTheDocument();
  });

  it("keeps live data sealed, receives named SSE, fetches a rejection receipt, and retains incumbent", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/runs" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ id: recordedRejectionReceipt.runId, status: "created" }),
        };
      }
      if (url === `/api/runs/${recordedRejectionReceipt.runId}/receipt`) {
        return { ok: true, json: async () => recordedRejectionReceipt };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await screen.findByText("네트워크 요청 없이 저장된 해시 검증 PC01 리플레이를 준비했습니다.");

    fireEvent.click(screen.getByRole("button", { name: "증거 재판 시작" }));
    await waitFor(() => expect(AppEventSource.latest).not.toBeNull());
    expect(screen.getByText(/RUN ….* · RECEIPT PENDING/u)).toBeInTheDocument();
    expect(screen.queryByText(recordedReceipt.receiptId)).not.toBeInTheDocument();

    act(() => {
      AppEventSource.latest?.emit("stage_started", {
        type: "stage_started",
        status: "blind_comparison",
        at: "2026-08-29T15:41:50.000Z",
        message: "deterministic gates are running",
      });
    });
    expect(screen.getByRole("heading", { name: "실시간 재판 기록" })).toBeInTheDocument();
    expect(screen.queryByText("13 / 13 PASS")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "비교" }));
    expect(screen.getByRole("heading", { name: "실시간 비교를 준비하고 있습니다." })).toBeInTheDocument();
    expect(document.querySelectorAll(".variant-frame img")).toHaveLength(0);

    act(() => {
      AppEventSource.latest?.emit("receipt_ready", {
        runId: recordedRejectionReceipt.runId,
        receiptId: recordedRejectionReceipt.receiptId,
        status: "rejected",
      });
    });
    expect(
      await screen.findByRole("heading", { name: /패치 심의 결과: 기각/u }),
    ).toBeInTheDocument();
    expect(screen.getByText("REJECTED / INCUMBENT RETAINED")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/runs/${recordedRejectionReceipt.runId}/receipt`,
      expect.objectContaining({ headers: expect.objectContaining({ accept: "application/json" }) }),
    );
  });

  it("renders terminal invalid as a non-verdict without borrowing recorded outcomes", async () => {
    const invalidRunId = "pc01-invalid-opaque";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/runs" && init?.method === "POST") {
        return { ok: true, json: async () => ({ id: invalidRunId, status: "created" }) };
      }
      if (url === `/api/runs/${invalidRunId}`) {
        return {
          ok: true,
          json: async () => ({
            id: invalidRunId,
            status: "invalid",
            failure: {
              code: "infrastructure_error",
              stage: "criticizing",
              message: "provider quota exhausted",
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
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "증거 재판 시작" }));
    await waitFor(() => expect(AppEventSource.latest).not.toBeNull());
    expect(screen.getByText("실시간 재판")).toBeInTheDocument();
    expect(screen.queryByText(/저장된 PC01 영수증의 무결성을 검증하지 못해/u)).not.toBeInTheDocument();

    act(() => {
      AppEventSource.latest?.emit("receipt_ready", {
        runId: invalidRunId,
        receiptId: "receipt-internal-invalid",
        status: "invalid",
      });
    });
    const invalidHeading = await screen.findByRole("heading", {
      name: "판결불가 및 실행 무효 리포트",
    });
    expect(invalidHeading).toBeInTheDocument();
    expect(document.activeElement).toBe(invalidHeading);
    expect(screen.getByText("변경 없음 · 승격/기각 미발생")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "CHAMPION" })).not.toBeInTheDocument();
    expect(screen.queryByText("REJECTED / INCUMBENT RETAINED")).not.toBeInTheDocument();
    expect(screen.queryByText("13 / 13 PASS")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/receipt"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "비교" }));
    expect(screen.getByRole("heading", { name: "판결불가 및 실행 무효 리포트" })).toBeInTheDocument();
    expect(document.querySelectorAll(".variant-frame img")).toHaveLength(0);
  });
});
