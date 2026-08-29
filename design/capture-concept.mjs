import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const outputDir = resolve(root, "design/reference");
const conceptUrl = pathToFileURL(resolve(root, "design/concept.html")).href;
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const errors = [];

async function capture(viewport, name, tab = "trial") {
  const context = await browser.newContext({
    viewport,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${name}: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
  await page.goto(conceptUrl, { waitUntil: "load" });
  if (tab !== "trial") {
    await page.evaluate((target) => globalThis.switchTab(target), tab);
  }
  await page.screenshot({
    path: resolve(outputDir, `${name}.png`),
    fullPage: false,
  });
  await context.close();
}

await capture({ width: 1440, height: 960 }, "concept-dashboard-desktop");
await capture({ width: 1440, height: 960 }, "concept-court-desktop", "evidence");
await capture({ width: 1440, height: 960 }, "concept-comparison-desktop", "comparison");
await capture({ width: 1440, height: 960 }, "concept-receipt-desktop", "receipt");
await capture({ width: 390, height: 844 }, "concept-dashboard-mobile");
await capture({ width: 390, height: 844 }, "concept-court-mobile", "evidence");

await browser.close();
if (errors.length > 0) {
  throw new Error(`Concept browser errors:\n${errors.join("\n")}`);
}
console.log(JSON.stringify({ screenshots: 6, errors: 0 }));
