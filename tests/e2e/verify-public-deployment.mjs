import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const outputRoot = resolve(import.meta.dirname, "test-results/deployment");
const reportPath = resolve(outputRoot, "verification.json");
const startedAt = new Date().toISOString();
await mkdir(outputRoot, { recursive: true });

async function removeIfPresent(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function writeReport(report) {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const profiles = [
  {
    name: "desktop",
    viewport: { width: 1440, height: 960 },
    captureName: "public-desktop.png",
    curatedCapture: "design/final/dashboard-desktop.png",
  },
  {
    name: "mobile",
    viewport: { width: 390, height: 844 },
    captureName: "public-mobile.png",
    curatedCapture: "design/final/dashboard-mobile.png",
  },
];

await writeReport({
  schemaVersion: 2,
  status: "running",
  startedAt,
  url: null,
  profiles: [],
});

await Promise.all(
  [
    ...profiles.map((profile) => profile.captureName),
    ...profiles.map((profile) => `failure-${profile.name}.png`),
    "failure-startup.png",
  ].map((name) => removeIfPresent(resolve(outputRoot, name))),
);

const results = [];
const configuredUrl = process.env.PATCHCOURT_PUBLIC_URL;
let publicUrl = null;
let browser = null;
let activePage = null;
let activeProfile = "startup";

try {
  assert(configuredUrl, "PATCHCOURT_PUBLIC_URL is required");
  publicUrl = new URL(configuredUrl);
  assert.equal(publicUrl.protocol, "https:", "public deployment must use HTTPS");
  assert.equal(publicUrl.username, "", "public deployment URL must not contain credentials");
  assert.equal(publicUrl.password, "", "public deployment URL must not contain credentials");
  assert.equal(publicUrl.search, "", "public deployment URL must not contain a query string");
  assert.equal(publicUrl.hash, "", "public deployment URL must not contain a fragment");
  await writeReport({
    schemaVersion: 2,
    status: "running",
    startedAt,
    url: publicUrl.href,
    profiles: [],
  });
  browser = await chromium.launch({ headless: true });

  for (const profile of profiles) {
    activeProfile = profile.name;
    const context = await browser.newContext({ viewport: profile.viewport });
    const page = await context.newPage();
    activePage = page;
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    const badResponses = [];
    const apiRequests = [];
    const externalRequests = [];
    let requestCount = 0;

    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => {
      requestCount += 1;
      const url = new URL(request.url());
      if (url.origin !== publicUrl.origin) externalRequests.push(request.url());
      let decodedPathname;
      try {
        decodedPathname = decodeURIComponent(url.pathname);
      } catch {
        apiRequests.push(request.url());
        return;
      }
      if (/(?:^|\/)api(?:\/|$)/u.test(decodedPathname)) {
        apiRequests.push(request.url());
      }
    });
    page.on("requestfailed", (request) => {
      failedRequests.push(`${request.failure()?.errorText ?? "failed"} ${request.url()}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
    });

    const response = await page.goto(publicUrl.href, { waitUntil: "networkidle" });
    assert(response, `${profile.name}: navigation produced no response`);
    assert.equal(response.status(), 200, `${profile.name}: document must return 200`);
    assert.equal(response.request().redirectedFrom(), null, `${profile.name}: navigation redirected`);
    assert.equal(response.url(), publicUrl.href, `${profile.name}: response URL redirected`);
    assert.equal(page.url(), publicUrl.href, `${profile.name}: final page URL redirected`);
    assert.match(await page.title(), /PatchCourt/iu, `${profile.name}: title mismatch`);
    await page.getByRole("heading", { name: "좋아졌다는 말 대신, 증거를 남깁니다." }).waitFor();
    await page.locator(".receipt-id").waitFor({ state: "attached" });
    assert.match(
      (await page.locator(".receipt-id").textContent()) ?? "",
      /^receipt-pc01-/u,
      `${profile.name}: verified receipt did not load`,
    );
    assert(
      await page.getByRole("button", { name: "라이브 API 연결 시 사용" }).isDisabled(),
      `${profile.name}: public live CTA must remain disabled`,
    );

    const initialOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    assert(initialOverflow <= 0, `${profile.name}: initial horizontal overflow ${initialOverflow}px`);
    const capturePath = resolve(outputRoot, profile.captureName);
    await page.screenshot({ path: capturePath, fullPage: true });
    const curatedCapturePath = resolve(import.meta.dirname, "../..", profile.curatedCapture);
    const [captureBytes, curatedCaptureBytes] = await Promise.all([
      readFile(capturePath),
      readFile(curatedCapturePath),
    ]);
    const captureSha256 = sha256(captureBytes);
    const curatedCaptureSha256 = sha256(curatedCaptureBytes);
    assert.equal(
      captureSha256,
      curatedCaptureSha256,
      `${profile.name}: deployed screenshot drifted from curated proof`,
    );

    await page.getByRole("button", { name: "증거", exact: true }).click();
    const evidenceImage = page.locator(".evidence-frame img").first();
    await evidenceImage.waitFor();
    await evidenceImage.evaluate((image) => image.decode());
    const evidenceImageReady = await evidenceImage.evaluate(
      (image) => image.complete && image.naturalWidth > 0,
    );
    assert(evidenceImageReady, `${profile.name}: evidence image did not decode`);

    await page.getByRole("button", { name: "비교", exact: true }).click();
    await page.getByText("ORDER COMMITTED", { exact: true }).waitFor();
    const sealedSources = await page.locator(".variant-frame img").evaluateAll((images) =>
      images.map((image) => image.getAttribute("src") ?? ""),
    );
    assert.equal(sealedSources.length, 2, `${profile.name}: expected two blind arms`);
    assert.doesNotMatch(
      sealedSources.join(" "),
      /incumbent|candidate/iu,
      `${profile.name}: blind arm identity leaked before reveal`,
    );
    await page.getByRole("button", { name: "패치 정체 공개" }).click();
    await page.getByText("MAPPING REVEALED", { exact: true }).waitFor();

    await page.getByRole("button", { name: "영수증", exact: true }).click();
    await page.getByText("FACTS PACKET", { exact: true }).waitFor();
    assert.match(
      (await page.getByTestId("execution-provenance").textContent()) ?? "",
      /VERIFIED REPLAY/u,
      `${profile.name}: public provenance is not replay-only`,
    );

    await page.getByRole("button", { name: "재판", exact: true }).click();
    await page.getByRole("button", { name: /검증된 기각 계보 보기/u }).click();
    await page.getByText("REJECTED / INCUMBENT RETAINED", { exact: true }).waitFor();
    assert.match(
      (await page.getByText("INVOCATION COUNT", { exact: true }).locator("..").textContent()) ?? "",
      /0/u,
      `${profile.name}: rejection must short-circuit the judge`,
    );

    const terminalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    assert(terminalOverflow <= 0, `${profile.name}: terminal horizontal overflow ${terminalOverflow}px`);
    assert.deepEqual(consoleErrors, [], `${profile.name}: console errors`);
    assert.deepEqual(pageErrors, [], `${profile.name}: page errors`);
    assert.deepEqual(failedRequests, [], `${profile.name}: failed requests`);
    assert.deepEqual(badResponses, [], `${profile.name}: HTTP error responses`);
    assert.deepEqual(apiRequests, [], `${profile.name}: public build made API requests`);
    assert.deepEqual(externalRequests, [], `${profile.name}: public build made cross-origin requests`);

    results.push({
      name: profile.name,
      viewport: profile.viewport,
      documentStatus: response.status(),
      finalUrl: page.url(),
      redirectCount: 0,
      requestCount,
      externalRequestCount: externalRequests.length,
      initialOverflow,
      terminalOverflow,
      apiRequestCount: apiRequests.length,
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
      failedRequestCount: failedRequests.length,
      badResponseCount: badResponses.length,
      capture: profile.captureName,
      captureSha256,
      curatedCapture: profile.curatedCapture,
      curatedCaptureSha256,
      captureMatchesCurated: captureSha256 === curatedCaptureSha256,
      promotionVerified: true,
      rejectionVerified: true,
    });
    await context.close();
    activePage = null;
  }

  await browser.close();
  browser = null;
} catch (error) {
  const failureCapture = `failure-${activeProfile}.png`;
  let failureScreenshot = null;
  if (activePage && !activePage.isClosed()) {
    try {
      await activePage.screenshot({ path: resolve(outputRoot, failureCapture), fullPage: true });
      failureScreenshot = failureCapture;
    } catch {
      failureScreenshot = null;
    }
  }
  const failureReport = {
    schemaVersion: 2,
    status: "failed",
    startedAt,
    checkedAt: new Date().toISOString(),
    url: publicUrl?.href ?? null,
    activeProfile,
    error: {
      name: error?.name ?? "Error",
      message: error?.message ?? String(error),
    },
    failureScreenshot,
    completedProfiles: results,
  };
  await writeReport(failureReport);
  console.error(JSON.stringify(failureReport, null, 2));
  throw error;
} finally {
  if (browser) await browser.close().catch(() => undefined);
}

const report = {
  schemaVersion: 2,
  status: "passed",
  startedAt,
  checkedAt: new Date().toISOString(),
  url: publicUrl.href,
  allowedNetworkOrigin: publicUrl.origin,
  profiles: results,
};
await writeReport(report);
console.log(JSON.stringify(report, null, 2));
