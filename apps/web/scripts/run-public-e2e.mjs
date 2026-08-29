import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
const captureFinal = process.argv.includes("--capture-final");

if (!npmCli) {
  throw new Error("npm_execpath is required so the public E2E runner can build reproducibly");
}

function run(args, env = process.env) {
  const child = spawn(process.execPath, args, {
    cwd: WEB_ROOT,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit({ code: code ?? 1, signal }));
  });
}

const build = await run([npmCli, "run", "build"], {
  ...process.env,
  VITE_API_BASE_URL: "",
  VITE_PATCHCOURT_TARGET_URL: "http://127.0.0.1:4173",
  VITE_PUBLIC_REPLAY_ONLY: "true",
});
if (build.code !== 0) process.exit(build.code);

const playwrightCli = createRequire(import.meta.url).resolve("@playwright/test/cli");
const browserEnv = { ...process.env };
delete browserEnv.PATCHCOURT_CAPTURE_FINAL;
if (captureFinal) browserEnv.PATCHCOURT_CAPTURE_FINAL = "1";
browserEnv.PATCHCOURT_NESTED_PORT = "4196";
browserEnv.VITE_API_BASE_URL = "";
browserEnv.VITE_PATCHCOURT_TARGET_URL = "http://127.0.0.1:4173";
browserEnv.VITE_PUBLIC_REPLAY_ONLY = "true";
const browser = await run([
  playwrightCli,
  "test",
  "e2e/web.spec.ts",
  "--config",
  "playwright.config.ts",
], browserEnv);
if (browser.code !== 0) process.exit(browser.code);
