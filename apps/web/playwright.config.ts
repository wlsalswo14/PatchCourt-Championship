import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4195",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "npm run preview -- --host 127.0.0.1 --port 4195",
      url: "http://127.0.0.1:4195",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "node scripts/serve-nested.mjs",
      url: "http://127.0.0.1:4196/PatchCourt-Championship/",
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
