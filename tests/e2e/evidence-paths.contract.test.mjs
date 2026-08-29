import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const E2E_ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(E2E_ROOT, "../..");
const TEST_RESULTS_ROOT = join(E2E_ROOT, ".artifacts", "test-results");
const moduleUrl = pathToFileURL(resolve(E2E_ROOT, "evidence-paths.mjs")).href;
const probeSource = `
  const paths = await import(${JSON.stringify(moduleUrl)});
  process.stdout.write(JSON.stringify({
    promotion: paths.PROMOTION_EVIDENCE_DIR,
    rejection: paths.REJECTION_EVIDENCE_DIR
  }));
`;

function probe(overrides = {}) {
  const env = { ...process.env };
  delete env.PATCHCOURT_AUTHORITATIVE_EVIDENCE_UPDATE;
  delete env.PATCHCOURT_EVIDENCE_DIR;
  delete env.PATCHCOURT_REJECTION_EVIDENCE_DIR;
  Object.assign(env, overrides);

  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", probeSource],
    { cwd: E2E_ROOT, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit({ code: code ?? 1, signal, stdout, stderr }));
  });
}

test("defaults and explicit temporary destinations stay under test-results", async () => {
  const defaults = await probe();
  assert.equal(defaults.code, 0, defaults.stderr);
  const defaultPaths = JSON.parse(defaults.stdout);
  assert.ok(defaultPaths.promotion.startsWith(TEST_RESULTS_ROOT));
  assert.ok(defaultPaths.rejection.startsWith(TEST_RESULTS_ROOT));

  const temporary = resolve(TEST_RESULTS_ROOT, "contract", "promotion");
  const configured = await probe({ PATCHCOURT_EVIDENCE_DIR: temporary });
  assert.equal(configured.code, 0, configured.stderr);
  assert.equal(JSON.parse(configured.stdout).promotion, temporary);
});

test("an arbitrary configured destination is rejected", async () => {
  const result = await probe({
    PATCHCOURT_EVIDENCE_DIR: resolve(E2E_ROOT, ".artifacts-outside-test-results"),
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /must target .*test-results/);
});

test("authoritative evidence requires the exact directory and update capability", async () => {
  const latest = resolve(REPO_ROOT, "docs", "evidence", "latest");
  const rejection = resolve(REPO_ROOT, "docs", "evidence", "rejection");

  const missingCapability = await probe({ PATCHCOURT_EVIDENCE_DIR: latest });
  assert.notEqual(missingCapability.code, 0);
  assert.match(missingCapability.stderr, /without the evidence:update command/);

  const wrongDirectory = await probe({
    PATCHCOURT_AUTHORITATIVE_EVIDENCE_UPDATE: "1",
    PATCHCOURT_EVIDENCE_DIR: rejection,
  });
  assert.notEqual(wrongDirectory.code, 0);
  assert.match(wrongDirectory.stderr, /may only target docs\/evidence\/latest/);

  const authorized = await probe({
    PATCHCOURT_AUTHORITATIVE_EVIDENCE_UPDATE: "1",
    PATCHCOURT_EVIDENCE_DIR: latest,
    PATCHCOURT_REJECTION_EVIDENCE_DIR: rejection,
  });
  assert.equal(authorized.code, 0, authorized.stderr);
});
