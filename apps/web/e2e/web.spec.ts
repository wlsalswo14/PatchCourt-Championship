import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const finalRoot = process.env.PATCHCOURT_CAPTURE_FINAL === "1"
  ? resolve(import.meta.dirname, "../../../design/final")
  : resolve(import.meta.dirname, "../test-results/curated-captures");
mkdirSync(finalRoot, { recursive: true });

async function assertCleanRuntime(page: Page) {
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

async function waitForVerifiedReplay(page: Page) {
  await expect(page.locator(".receipt-id")).toHaveText(/^receipt-pc01-/u);
}

test("recorded court preserves blind identity and renders verified lineage", async ({ page }) => {
  const assertRuntime = await assertCleanRuntime(page);
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "좋아졌다는 말 대신, 증거를 남깁니다." })).toBeVisible();
  await expect(page.getByText("127.0.0.1:4173", { exact: true }).first()).toBeVisible();
  await waitForVerifiedReplay(page);
  await expect(page.getByRole("button", { name: "라이브 API 연결 시 사용" })).toBeDisabled();
  await page.screenshot({ path: resolve(finalRoot, "dashboard-desktop.png"), fullPage: true });

  const evidenceResponse = page.waitForResponse((response) =>
    response.url().endsWith("/evidence/incumbent-desktop-profile.png"),
  );
  await page.getByRole("button", { name: "증거", exact: true }).click();
  expect((await evidenceResponse).status()).toBe(200);
  await expect(page.getByRole("heading", { name: /결함은 주장으로 채택되기 전에/u })).toBeVisible();
  await page.screenshot({ path: resolve(finalRoot, "evidence-court-desktop.png"), fullPage: true });

  await page.goto("/");
  const preRevealImageRequests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "image") preRevealImageRequests.push(request.url());
  });
  await page.getByRole("button", { name: "비교", exact: true }).click();
  await expect(page.getByText("ORDER COMMITTED")).toBeVisible();
  await expect(page.locator(".variant-frame img")).toHaveCount(2);
  const preReveal = await page.locator("main").innerText();
  const imageUrls = await page.locator(".variant-frame img").evaluateAll((images) =>
    images.map((image) => (image as HTMLImageElement).getAttribute("src") ?? ""),
  );
  expect(imageUrls).toHaveLength(2);
  expect(imageUrls.join(" ")).not.toMatch(/incumbent|candidate/iu);
  expect(preRevealImageRequests.join(" ")).not.toMatch(/incumbent|candidate/iu);
  expect(preReveal).not.toMatch(/incumbent|candidate/iu);
  const commitment = await page.locator(".blind-commitment code").textContent();
  expect(commitment).not.toBeNull();
  await page.screenshot({ path: resolve(finalRoot, "blind-comparison-sealed-desktop.png"), fullPage: true });

  await page.getByRole("button", { name: "패치 정체 공개" }).click();
  await expect(page.getByText("MAPPING REVEALED")).toBeVisible();
  await expect(page.locator(".reveal-label--winner").getByText("후보 패치", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "영수증", exact: true }).click();
  await expect(page.getByText("FACTS PACKET")).toBeVisible();
  await expect(page.getByTestId("execution-provenance")).toContainText(
    "VERIFIED REPLAY · deterministic reference",
  );
  await page.screenshot({ path: resolve(finalRoot, "champion-receipt-desktop.png"), fullPage: true });
  expect(apiRequests).toEqual([]);
  assertRuntime();
});

test("Flash rejection state retains incumbent and meets corrected text contrast", async ({ page }) => {
  const assertRuntime = await assertCleanRuntime(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await waitForVerifiedReplay(page);
  await page.getByRole("button", { name: /검증된 기각 계보 보기/u }).click();
  const heading = page.getByRole("heading", { name: /패치 심의 결과: 기각/u });
  await expect(heading).toBeFocused();
  await expect(page.getByText("REJECTED / INCUMBENT RETAINED")).toBeVisible();
  await expect(
    page.locator(".failed-gate-list code").getByText("responsive_primary_action", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("INVOCATION COUNT").locator("..")).toContainText("0");
  await expect(page.getByText("INVALID REASON").locator("..")).toContainText(
    "not_called:critical_gate_failed:responsive_primary_action",
  );
  const contrast = await page.locator(".rejection-badge").evaluate((element) => {
    const parse = (value: string) => value.match(/[\d.]+/gu)!.slice(0, 3).map(Number);
    const luminance = ([red, green, blue]: number[]) => {
      const values = [red, green, blue].map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
    };
    const style = getComputedStyle(element);
    const foreground = luminance(parse(style.color));
    const background = luminance(parse(style.backgroundColor));
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(documentHeight).toBeLessThan(2_000);
  await page.setViewportSize({ width: 1440, height: documentHeight + 2 });
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  const layout = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    const skip = rect(".skip-link");
    const header = rect(".app-header");
    const workspace = rect(".workspace-bar");
    const rail = rect(".run-rail-shell");
    return {
      scrollY,
      skipBottom: skip.bottom,
      headerTop: header.top,
      headerBottom: header.bottom,
      workspaceTop: workspace.top,
      workspaceBottom: workspace.bottom,
      railTop: rail.top,
      viewportHeight: innerHeight,
      documentHeight: document.documentElement.scrollHeight,
    };
  });
  expect(layout.scrollY).toBe(0);
  expect(layout.skipBottom).toBeLessThanOrEqual(0);
  expect(layout.headerTop).toBe(0);
  expect(layout.workspaceTop).toBeGreaterThanOrEqual(layout.headerBottom - 1);
  expect(layout.railTop).toBeGreaterThanOrEqual(layout.workspaceBottom - 1);
  expect(layout.documentHeight).toBeLessThanOrEqual(layout.viewportHeight);
  await page.screenshot({ path: resolve(finalRoot, "rejection-receipt-desktop.png") });
  assertRuntime();
});

test("390px mobile keeps navigation legible, rail scrollable, and page overflow-free", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await waitForVerifiedReplay(page);
  const metrics = await page.evaluate(() => {
    const navLabels = [...document.querySelectorAll<HTMLElement>(".nav-button span")].map((label) => ({
      text: label.textContent,
      whiteSpace: getComputedStyle(label).whiteSpace,
      height: label.getBoundingClientRect().height,
    }));
    const rail = document.querySelector<HTMLElement>(".run-rail")!;
    return {
      overflow: document.documentElement.scrollWidth - innerWidth,
      navLabels,
      railClientWidth: rail.clientWidth,
      railScrollWidth: rail.scrollWidth,
    };
  });
  expect(metrics.overflow).toBeLessThanOrEqual(0);
  expect(metrics.navLabels.map((label) => label.text)).toEqual(["재판", "증거", "비교", "영수증"]);
  expect(metrics.navLabels.every((label) => label.whiteSpace === "nowrap" && label.height < 24)).toBe(true);
  expect(metrics.railScrollWidth).toBeGreaterThan(metrics.railClientWidth);
  await expect(page.getByRole("progressbar", { name: "재판 진행 단계" })).toHaveAttribute(
    "aria-valuetext",
    /1 \/ 6 단계/u,
  );
  await page.screenshot({ path: resolve(finalRoot, "dashboard-mobile.png"), fullPage: true });

  await page.getByRole("button", { name: "증거", exact: true }).click();
  const evidencePin = await page.getByRole("button", { name: /^E-01:/u }).boundingBox();
  expect(evidencePin?.width).toBeGreaterThanOrEqual(44);
  expect(evidencePin?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "비교", exact: true }).click();
  await expect(page.getByTestId("judge-validation-summary")).toContainText(/VALIDATION|SHORT CIRCUIT/u);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: resolve(finalRoot, "blind-comparison-mobile.png"), fullPage: true });
});

test("relative Vite base serves JS and evidence at a nested project path", async ({ page }) => {
  const failures: string[] = [];
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (response.status() >= 400 && !pathname.startsWith("/api/")) {
      failures.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto("http://127.0.0.1:4196/PatchCourt-Championship/");
  await expect(page.getByRole("heading", { name: "좋아졌다는 말 대신, 증거를 남깁니다." })).toBeVisible();
  await waitForVerifiedReplay(page);
  const evidenceResponse = page.waitForResponse((response) =>
    response.url().includes("/PatchCourt-Championship/evidence/incumbent-desktop-profile.png"),
  );
  await page.getByRole("button", { name: "증거", exact: true }).click();
  expect((await evidenceResponse).status()).toBe(200);
  expect(failures).toEqual([]);
});
