import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const captureFinal = process.argv.includes("--capture-final");
const playwrightCli = createRequire(import.meta.url).resolve("@playwright/test/cli");
const env = { ...process.env };
delete env.PATCHCOURT_CAPTURE_FINAL;
if (captureFinal) env.PATCHCOURT_CAPTURE_FINAL = "1";
env.VITE_API_BASE_URL = "";
env.VITE_PATCHCOURT_TARGET_URL = "http://127.0.0.1:4273";
env.VITE_PUBLIC_REPLAY_ONLY = "false";

const child = spawn(
  process.execPath,
  [
    playwrightCli,
    "test",
    "e2e/live-states.spec.ts",
    "--config",
    "playwright.live.config.ts",
  ],
  { cwd: WEB_ROOT, env, stdio: "inherit", windowsHide: true },
);
const result = await new Promise((resolveExit, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => resolveExit({ code: code ?? 1, signal }));
});
if (result.code !== 0) process.exit(result.code);
