import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { VerifiedReceipt } from "../src/types";

const finalRoot = process.env.PATCHCOURT_CAPTURE_FINAL === "1"
  ? resolve(import.meta.dirname, "../../../design/final")
  : resolve(import.meta.dirname, "../test-results/curated-captures");
mkdirSync(finalRoot, { recursive: true });
const ownedTarget = "http://127.0.0.1:4273";
const recordedReceipt = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../src/data/pc01-receipt.json"), "utf8"),
) as VerifiedReceipt;

function receiptReady(runId: string, receiptId: string | null, status: string) {
  return [
    "event: stage_started",
    `data: ${JSON.stringify({
      type: "stage_started",
      status: "deterministic_gates",
      at: "2026-08-29T17:10:00.000Z",
      message: "deterministic gates completed",
    })}`,
    "",
    "event: receipt_ready",
    `data: ${JSON.stringify({ runId, receiptId, status })}`,
    "",
    "",
  ].join("\n");
}

async function fulfillSse(route: Route, body: string) {
  await route.fulfill({
    status: 200,
    headers: {
      "cache-control": "no-cache",
      connection: "close",
      "content-type": "text/event-stream; charset=utf-8",
    },
    body,
  });
}

function captureRuntime(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return () => {
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  };
}

async function expectStartupNetworkClean(page: Page, apiRequests: string[]) {
  await page.goto("/");
  await expect(page.locator(".receipt-id")).toHaveText(/^receipt-pc01-/u);
  await expect(page.getByText(/네트워크 요청 없이 저장된 해시 검증 PC01 리플레이/u)).toBeVisible();
  expect(apiRequests).toEqual([]);
}

test("live API promotion labels an offline-demo receipt as a live reference", async ({ page }) => {
  const assertRuntime = captureRuntime(page);
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/")) apiRequests.push(`${request.method()} ${pathname}`);
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/runs" && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual(
        expect.objectContaining({ targetUrl: ownedTarget, demoSlug: "championship" }),
      );
      await route.fulfill({ json: { id: recordedReceipt.runId, status: "created" } });
      return;
    }
    if (pathname === `/api/runs/${recordedReceipt.runId}/events`) {
      await fulfillSse(
        route,
        receiptReady(recordedReceipt.runId, recordedReceipt.receiptId, "promoted"),
      );
      return;
    }
    if (pathname === `/api/runs/${recordedReceipt.runId}/receipt`) {
      await route.fulfill({ json: recordedReceipt });
      return;
    }
    await route.abort("failed");
  });

  await page.setViewportSize({ width: 1440, height: 960 });
  await expectStartupNetworkClean(page, apiRequests);
  await page.getByRole("button", { name: "증거 재판 시작" }).click();
  const heading = page.getByRole("heading", { name: "CHAMPION" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByTestId("execution-provenance")).toContainText(
    "LIVE API · OFFLINE-DEMO REFERENCE",
  );
  await expect(page.getByTestId("execution-provenance")).not.toContainText("VERIFIED REPLAY");
  expect(apiRequests).toEqual([
    "POST /api/runs",
    `GET /api/runs/${recordedReceipt.runId}/events`,
    `GET /api/runs/${recordedReceipt.runId}/receipt`,
  ]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(finalRoot, "live-offline-receipt-desktop.png"), fullPage: true });
  assertRuntime();
});

test("terminal invalid stays a non-verdict and never borrows recorded outcomes", async ({ page }) => {
  const assertRuntime = captureRuntime(page);
  const runId = "pc01-invalid-ui-proof";
  const receiptId = "receipt-internal-invalid-ui-proof";
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/")) apiRequests.push(`${request.method()} ${pathname}`);
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/runs" && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual(
        expect.objectContaining({ targetUrl: ownedTarget, demoSlug: "championship" }),
      );
      await route.fulfill({ json: { id: runId, status: "created" } });
      return;
    }
    if (pathname === `/api/runs/${runId}/events`) {
      await fulfillSse(route, receiptReady(runId, receiptId, "invalid"));
      return;
    }
    if (pathname === `/api/runs/${runId}`) {
      await route.fulfill({
        json: {
          id: runId,
          status: "invalid",
          failure: {
            code: "provider_unavailable",
            stage: "criticizing",
            message: "provider quota unavailable for this owned test run",
          },
          execution: {
            mode: "live-gemini",
            criticProvider: "gemini",
            patchProvider: "not-called",
            judgeProvider: "not-called",
            model: "gemini-3.6-flash",
          },
          receipt: { receiptId },
        },
      });
      return;
    }
    await route.abort("failed");
  });

  await page.setViewportSize({ width: 1440, height: 960 });
  await expectStartupNetworkClean(page, apiRequests);
  await page.getByRole("button", { name: "증거 재판 시작" }).click();
  const heading = page.getByRole("heading", { name: "판결불가 및 실행 무효 리포트" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByText("변경 없음 · 승격/기각 미발생")).toBeVisible();
  await expect(page.getByText("LIVE GEMINI · gemini-3.6-flash")).toBeVisible();
  await expect(page.getByRole("heading", { name: "CHAMPION" })).toHaveCount(0);
  await expect(page.getByText("REJECTED / INCUMBENT RETAINED")).toHaveCount(0);
  await expect(page.getByText("13 / 13 PASS")).toHaveCount(0);
  expect(apiRequests).toEqual([
    "POST /api/runs",
    `GET /api/runs/${runId}/events`,
    `GET /api/runs/${runId}`,
  ]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(finalRoot, "invalid-run-desktop.png"), fullPage: true });
  assertRuntime();
});
