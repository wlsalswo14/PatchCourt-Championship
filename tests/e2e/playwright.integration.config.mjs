import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "patchcourt-ui.integration.mjs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  outputDir: ".artifacts/integration-results",
  reporter: [["line"]],
  use: {
    baseURL: process.env.PATCHCOURT_WEB_URL ?? "http://127.0.0.1:4175",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
});
