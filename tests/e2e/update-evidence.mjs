import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const E2E_ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(E2E_ROOT, "../..");
const promotionDir = resolve(REPO_ROOT, "docs", "evidence", "latest");
const rejectionDir = resolve(REPO_ROOT, "docs", "evidence", "rejection");
const cli = resolve(E2E_ROOT, "node_modules", "@playwright", "test", "cli.js");
const verifier = resolve(REPO_ROOT, "benchmark", "verify-receipt.mjs");
const env = {
  ...process.env,
  PATCHCOURT_AUTHORITATIVE_EVIDENCE_UPDATE: "1",
  PATCHCOURT_EVIDENCE_DIR: promotionDir,
  PATCHCOURT_REJECTION_EVIDENCE_DIR: rejectionDir,
};

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: E2E_ROOT,
    env,
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit({ code: code ?? 1, signal }));
  });
}

const generation = await run(process.execPath, [
  cli,
  "test",
  "--config",
  "playwright.config.mjs",
  "brand-match.spec.mjs",
  "rejection-run.spec.mjs",
  "zz-receipt-schema.spec.mjs",
]);
if (generation.code !== 0) process.exit(generation.code);

for (const receiptPath of [
  resolve(promotionDir, "receipt.json"),
  resolve(rejectionDir, "receipt.json"),
]) {
  const verification = await run(process.execPath, [verifier, receiptPath], { env: process.env });
  if (verification.code !== 0) process.exit(verification.code);
}

const promotion = JSON.parse(await readFile(resolve(promotionDir, "receipt.json"), "utf8"));
const rejection = JSON.parse(await readFile(resolve(rejectionDir, "receipt.json"), "utf8"));
process.stdout.write(`${JSON.stringify({
  updated: true,
  command: "evidence:update",
  independentVerification: { promotion: "passed", rejection: "passed" },
  promotion: { runId: promotion.runId, payloadSha256: promotion.integrity.payloadSha256 },
  rejection: { runId: rejection.runId, payloadSha256: rejection.integrity.payloadSha256 },
}, null, 2)}\n`);
