import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.mjs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  outputDir: ".artifacts/test-results",
  reporter: [["line"]],
  use: {
    baseURL: "http://127.0.0.1:42873",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off"
  },
  webServer: {
    command: "node demo/brand-match/server.mjs",
    url: "http://127.0.0.1:42873/health",
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    env: { PATCHCOURT_DEMO_PORT: "42873" },
    reuseExistingServer: false,
    timeout: 15_000
  }
});
