import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE_DIR = resolve(
  process.env.PATCHCOURT_INTEGRATION_EVIDENCE_DIR ?? join(REPO, "docs", "evidence", "integration")
);
const WEB_URL = (process.env.PATCHCOURT_WEB_URL ?? "http://127.0.0.1:4175").replace(/\/$/u, "");
const PUBLIC_WEB_URL = process.env.PATCHCOURT_PUBLIC_WEB_URL?.replace(/\/$/u, "") ?? null;
const API_URL = (process.env.PATCHCOURT_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/u, "");
const FIXTURE_URL = (process.env.PATCHCOURT_FIXTURE_URL ?? "http://127.0.0.1:4173").replace(/\/$/u, "");
const MOJIBAKE_MARKERS = ["\uFFFD", "寃", "利앸", "媛", "?ㅼ떆", "?쒖"];
const EVIDENCE_ROOT = resolve(REPO, "docs", "evidence");
const evidenceRelative = relative(EVIDENCE_ROOT, EVIDENCE_DIR);
if (isAbsolute(evidenceRelative) || evidenceRelative.startsWith("..")) {
  throw new Error("integration evidence directory escaped docs/evidence");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function shortHash(value, head = 10, tail = 8) {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function sanitizeTelemetryUrl(value) {
  const parsed = new URL(value);
  if (parsed.pathname.startsWith("/@fs/")) return "artifact://local-vite-module";
  return value;
}

function telemetry(page) {
  const consoleEntries = [];
  const requests = [];
  const failedRequests = [];
  page.on("console", (message) => {
    consoleEntries.push({ type: message.type(), text: message.text() });
  });
  page.on("request", (request) => {
    requests.push({
      method: request.method(),
      resourceType: request.resourceType(),
      url: sanitizeTelemetryUrl(request.url()),
    });
  });
  page.on("requestfailed", (request) => {
    failedRequests.push({
      url: sanitizeTelemetryUrl(request.url()),
      errorText: request.failure()?.errorText ?? "unknown",
    });
  });
  return { consoleEntries, requests, failedRequests };
}

function assertCleanTelemetry(entries, allowedOrigins = [WEB_URL, API_URL]) {
  const consoleErrors = entries.consoleEntries.filter(({ type }) => type === "error");
  expect(consoleErrors, JSON.stringify(consoleErrors, null, 2)).toEqual([]);
  expect(entries.failedRequests, JSON.stringify(entries.failedRequests, null, 2)).toEqual([]);
  const external = entries.requests.filter(({ url }) => {
    if (url === "artifact://local-vite-module") return false;
    const parsed = new URL(url);
    const allowed = new Set([
      ...allowedOrigins,
      ...allowedOrigins.filter((origin) => origin.startsWith("http")).map((origin) => origin.replace(/^http/u, "ws")),
    ]);
    return !allowed.has(parsed.origin);
  });
  expect(external, JSON.stringify(external, null, 2)).toEqual([]);
}

async function assertReadableResponsivePage(page) {
  const bodyText = await page.locator("body").innerText();
  for (const marker of MOJIBAKE_MARKERS) expect(bodyText).not.toContain(marker);
  const layout = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(Math.max(layout.scrollWidth, layout.bodyScrollWidth) - layout.viewportWidth).toBeLessThanOrEqual(0);
  return { bodyText, layout };
}

async function receiptValidator() {
  const artifactSchema = JSON.parse(
    await readFile(join(REPO, "benchmark", "schemas", "artifact.schema.json"), "utf8")
  );
  const receiptSchema = JSON.parse(
    await readFile(join(REPO, "benchmark", "schemas", "run-receipt.schema.json"), "utf8")
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(artifactSchema);
  return ajv.compile(receiptSchema);
}

async function writeTelemetry(name, entries, accessibility) {
  const serializedEntries = JSON.stringify(entries, null, 2);
  expect(serializedEntries).not.toMatch(/(?:^|["\s])[A-Za-z]:[\\/]/u);
  expect(serializedEntries).not.toContain("/@fs/");
  await writeFile(
    join(EVIDENCE_DIR, `${name}-console-network.json`),
    `${serializedEntries}\n`,
    "utf8"
  );
  await writeFile(join(EVIDENCE_DIR, `${name}-accessibility.txt`), `${accessibility}\n`, "utf8");
}

async function captureFullPage(page, fileName) {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  await expect(page.locator(".skip-link")).not.toBeInViewport();
  await page.screenshot({ path: join(EVIDENCE_DIR, fileName), fullPage: true });
}

test("actual PatchCourt UI proves replay truth, live receipt integrity, and responsive accessibility", async ({ browser, request }) => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  expect(PUBLIC_WEB_URL, "owned integration runner must provide the public replay-only build").not.toBeNull();
  const recordedReceipt = JSON.parse(
    await readFile(join(REPO, "docs", "evidence", "latest", "receipt.json"), "utf8")
  );
  const manifestBefore = await (await request.get(`${FIXTURE_URL}/__patchcourt/manifest.json`)).json();
  expect(manifestBefore.facts.digest).toBe(recordedReceipt.source.factsSha256);
  expect(manifestBefore.taskFingerprint).toBe(recordedReceipt.taskFingerprint);

  const visualResults = [];

  const publicContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const publicPage = await publicContext.newPage();
  const publicTelemetry = telemetry(publicPage);
  await publicPage.goto(PUBLIC_WEB_URL, { waitUntil: "domcontentloaded" });
  await expect(publicPage.getByRole("heading", { name: "좋아졌다는 말 대신, 증거를 남깁니다." })).toBeVisible();
  const disabledLive = publicPage.getByRole("button", { name: "라이브 API 연결 시 사용" });
  await expect(disabledLive).toBeDisabled();
  const publicReplay = publicPage.getByRole("button", { name: "60초 데모 시나리오 압축 재생" });
  await expect(publicReplay).toBeEnabled();
  await expect(publicReplay).toHaveClass(/button--primary/u);
  const apiRequests = publicTelemetry.requests.filter(({ url }) => new URL(url).pathname.startsWith("/api"));
  expect(apiRequests, JSON.stringify(apiRequests, null, 2)).toEqual([]);
  await captureFullPage(publicPage, "ui-public-replay-only.png");
  const publicAccessibility = await publicPage.locator("body").ariaSnapshot();
  await writeTelemetry("ui-public", publicTelemetry, publicAccessibility);
  assertCleanTelemetry(publicTelemetry, [PUBLIC_WEB_URL]);
  await publicContext.close();

  for (const viewport of [
    { name: "desktop", width: 1280, height: 720 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const entries = telemetry(page);
    await page.goto(WEB_URL, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "좋아졌다는 말 대신, 증거를 남깁니다." })).toBeVisible();
    const initial = await assertReadableResponsivePage(page);
    await captureFullPage(page, `ui-${viewport.name}-trial.png`);

    await page.getByRole("button", { name: "비교" }).click();
    await expect(page.getByRole("heading", { name: "같은 여정에서 더 나은 쪽을 먼저 고릅니다." })).toBeVisible();
    const comparison = page.locator(".comparison-view");
    const sealedDom = (await comparison.evaluate((node) => node.outerHTML)).toLowerCase();
    expect(sealedDom).not.toContain("incumbent");
    expect(sealedDom).not.toContain("candidate");
    const sealedSources = await comparison.locator("img").evaluateAll((images) =>
      images.map((image) => image.getAttribute("src") ?? "")
    );
    expect(sealedSources).toEqual(expect.arrayContaining([expect.stringContaining("arm-a"), expect.stringContaining("arm-b")]));
    expect(sealedSources.every((value) => !/incumbent|candidate/iu.test(value))).toBe(true);
    const commitment = page.locator(".blind-commitment code");
    await expect(commitment).toHaveText(shortHash(recordedReceipt.blindComparison.orderCommitmentSha256));
    await captureFullPage(page, `ui-${viewport.name}-comparison-sealed.png`);

    await page.getByRole("button", { name: "패치 정체 공개" }).click();
    await expect(page.getByText("후보 패치", { exact: true })).toBeVisible();
    await captureFullPage(page, `ui-${viewport.name}-comparison-revealed.png`);

    await page.getByRole("button", { name: "영수증" }).click();
    await expect(page.getByRole("heading", { name: "CHAMPION" })).toBeVisible();
    const factsRow = page.locator(".receipt-lineage > div").filter({ hasText: "FACTS PACKET" });
    await expect(factsRow.locator("code")).toHaveAttribute("title", recordedReceipt.source.factsSha256);
    await assertReadableResponsivePage(page);

    if (viewport.name === "mobile") {
      const primaryButtons = page.locator("button.button--primary:visible");
      for (const box of await primaryButtons.evaluateAll((buttons) =>
        buttons.map((button) => {
          const rect = button.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        })
      )) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }

    const accessibility = await page.locator("body").ariaSnapshot();
    await writeTelemetry(`ui-${viewport.name}`, entries, accessibility);
    assertCleanTelemetry(entries);
    visualResults.push({ viewport, initialLayout: initial.layout, sealedSources });
    await context.close();
  }

  const replayContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const replayPage = await replayContext.newPage();
  const replayTelemetry = telemetry(replayPage);
  await replayPage.goto(WEB_URL, { waitUntil: "domcontentloaded" });
  const replayStarted = Date.now();
  await replayPage.getByRole("button", { name: "60초 데모 시나리오 압축 재생" }).click();
  await expect(replayPage.getByRole("heading", { name: "CHAMPION" })).toBeVisible({ timeout: 10_000 });
  const replayElapsedMs = Date.now() - replayStarted;
  expect(replayElapsedMs).toBeGreaterThanOrEqual(4_000);
  expect(replayElapsedMs).toBeLessThan(8_000);
  await captureFullPage(replayPage, "ui-desktop-replay-terminal.png");
  assertCleanTelemetry(replayTelemetry);
  await replayContext.close();

  const liveContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const livePage = await liveContext.newPage();
  const liveTelemetry = telemetry(livePage);
  let resolveCreatedRun;
  const createdRunPromise = new Promise((resolveRun) => { resolveCreatedRun = resolveRun; });
  livePage.on("response", async (response) => {
    if (response.request().method() === "POST" && new URL(response.url()).pathname === "/api/runs") {
      try {
        resolveCreatedRun(await response.json());
      } catch {
        // The visible UI and terminal assertion will expose an invalid response.
      }
    }
  });
  await livePage.route("**/api/runs", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolveWait) => setTimeout(resolveWait, 800));
    await route.continue();
  });
  await livePage.goto(WEB_URL, { waitUntil: "domcontentloaded" });
  await livePage.getByRole("button", { name: "증거 재판 시작" }).click();
  await expect(livePage.getByText("실시간 재판", { exact: true })).toBeVisible();
  await expect(livePage.getByText("측정 중", { exact: true })).toBeVisible();
  await expect(livePage.getByText("영수증 대기", { exact: true })).toBeVisible();
  const pendingText = await livePage.locator("body").innerText();
  expect(pendingText).not.toContain("40 → 100");
  expect(pendingText).not.toContain("의사결정 근거 0 / 4");
  expect(pendingText).not.toContain("13 / 13 PASS");
  await captureFullPage(livePage, "ui-desktop-live-pending.png");

  const createdRun = await Promise.race([
    createdRunPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("live POST response timeout")), 15_000)),
  ]);
  await expect(livePage.getByRole("heading", { name: "CHAMPION" })).toBeVisible({ timeout: 120_000 });
  const liveExecutionProvenance = livePage.getByTestId("execution-provenance");
  await expect(liveExecutionProvenance).toContainText("LIVE API · OFFLINE-DEMO REFERENCE");
  await expect(liveExecutionProvenance).not.toContainText("VERIFIED REPLAY");
  const liveReceiptResponse = await request.get(`${API_URL}/api/runs/${encodeURIComponent(createdRun.id)}/receipt`);
  expect(liveReceiptResponse.ok()).toBe(true);
  const liveReceipt = await liveReceiptResponse.json();
  const validateReceipt = await receiptValidator();
  expect(validateReceipt(liveReceipt), JSON.stringify(validateReceipt.errors, null, 2)).toBe(true);
  const livePayload = { ...liveReceipt };
  delete livePayload.integrity;
  expect(liveReceipt.integrity.payloadSha256).toBe(sha256(canonicalJson(livePayload)));
  expect(liveReceipt.execution.mode).toBe("offline-demo");
  expect(liveReceipt.execution.model).toBeNull();
  expect(liveReceipt.source.factsSha256).toBe(manifestBefore.facts.digest);
  expect(liveReceipt.taskFingerprint).toBe(manifestBefore.taskFingerprint);
  const liveFactsRow = livePage.locator(".receipt-lineage > div").filter({ hasText: "FACTS PACKET" });
  await expect(liveFactsRow.locator("code")).toHaveAttribute("title", manifestBefore.facts.digest);
  await captureFullPage(livePage, "ui-desktop-live-receipt.png");
  await writeFile(
    join(EVIDENCE_DIR, "live-receipt.json"),
    `${JSON.stringify(liveReceipt, null, 2)}\n`,
    "utf8"
  );
  const liveAccessibility = await livePage.locator("body").ariaSnapshot();
  await writeTelemetry("ui-live", liveTelemetry, liveAccessibility);
  assertCleanTelemetry(liveTelemetry);

  const demoResponse = await request.get(`${API_URL}/api/demo-runs/championship`);
  expect(demoResponse.ok()).toBe(true);
  const demoPayload = await demoResponse.json();
  expect(demoPayload.runId).toBe(createdRun.id);
  expect(validateReceipt(demoPayload.receipt), JSON.stringify(validateReceipt.errors, null, 2)).toBe(true);
  expect(demoPayload.receipt.integrity.payloadSha256).toBe(liveReceipt.integrity.payloadSha256);

  const manifestAfter = await (await request.get(`${FIXTURE_URL}/__patchcourt/manifest.json`)).json();
  expect(manifestAfter.taskFingerprint).toBe(manifestBefore.taskFingerprint);
  expect(manifestAfter.sourceSnapshotDigest).toBe(manifestBefore.sourceSnapshotDigest);
  expect(manifestAfter.candidateSnapshotDigest).toBe(manifestBefore.candidateSnapshotDigest);
  expect(manifestAfter.patchDigest).toBe(manifestBefore.patchDigest);
  expect(manifestAfter.facts.digest).toBe(manifestBefore.facts.digest);
  await liveContext.close();

  const result = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    browser: "chromium",
    browserPluginAvailable: false,
    browserFallback: "regular Playwright",
    visualResults,
    replay: { displayedTimeline: "00:00–01:00", compressedElapsedMs: replayElapsedMs },
    live: {
      runId: liveReceipt.runId,
      receiptId: liveReceipt.receiptId,
      decision: liveReceipt.comparison.decision,
      execution: liveReceipt.execution,
      criticProvenanceDigest: liveReceipt.criticProvenance.digest,
      taskFingerprint: liveReceipt.taskFingerprint,
      factsSha256: liveReceipt.source.factsSha256,
      payloadSha256: liveReceipt.integrity.payloadSha256,
    },
    checks: {
      unicodeClean: true,
      desktopAndMobileNoOverflow: true,
      neutralPreRevealAssetUrlsAndDom: true,
      orderCommitmentDisplayed: true,
      livePendingHasNoRecordedFindingsOrScores: true,
      liveReceiptSchemaAndCanonicalHash: true,
      demoEndpointReturnsCanonicalReceipt: true,
      manifestUnchangedAcrossLiveRun: true,
      consoleAndNetworkClean: true,
      telemetryHasNoLocalAbsolutePaths: true,
      accessibilitySnapshotsCaptured: true,
      publicStaticMakesZeroApiRequestsAndDisablesLive: true,
    },
  };
  await writeFile(join(EVIDENCE_DIR, "ui-integration.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeFile(
    join(EVIDENCE_DIR, "SUMMARY.md"),
    `# PatchCourt actual UI integration evidence\n\n` +
      `- Chromium: desktop 1280×720 and mobile 390×844\n` +
      `- Live run: \`${result.live.runId}\`\n` +
      `- Canonical receipt: \`${result.live.receiptId}\`\n` +
      `- Execution: **${result.live.execution.mode}** (${result.live.execution.criticProvider}; ${result.live.execution.patchProvider}; ${result.live.execution.judgeProvider})\n` +
      `- Critic provenance: \`${result.live.criticProvenanceDigest}\`\n` +
      `- Task fingerprint: \`${result.live.taskFingerprint}\`\n` +
      `- Facts packet: \`${result.live.factsSha256}\`\n` +
      `- Payload SHA-256: \`${result.live.payloadSha256}\`\n` +
      `- 60-second scenario replay: **${result.replay.compressedElapsedMs}ms compressed**, UI timeline 00:00–01:00\n` +
      `- Public static mode: **0 /api requests**, live CTA disabled, replay CTA primary\n` +
      `- Browser runner: regular Playwright (Browser plugin unavailable)\n\n` +
      `The actual React UI and API were exercised together. Pre-reveal arms used neutral URLs and DOM, live pending views exposed no recorded scores/findings, the demo endpoint returned a schema-valid canonical receipt, and the manifest task/facts/source digests remained unchanged.\n`,
    "utf8"
  );
});
