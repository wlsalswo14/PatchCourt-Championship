import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4197",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4197",
    env: {
      VITE_API_BASE_URL: "",
      VITE_PATCHCOURT_TARGET_URL: "http://127.0.0.1:4273",
      VITE_PUBLIC_REPLAY_ONLY: "false",
    },
    url: "http://127.0.0.1:4197",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
