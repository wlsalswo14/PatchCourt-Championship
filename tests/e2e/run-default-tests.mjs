import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const E2E_ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(E2E_ROOT, "../..");
const TEST_RESULTS_ROOT = resolve(E2E_ROOT, ".artifacts", "test-results");

const authoritativeRoots = [
  resolve(REPO_ROOT, "docs", "evidence", "latest"),
  resolve(REPO_ROOT, "docs", "evidence", "rejection"),
];

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function authoritativeTreeSha256() {
  const hash = createHash("sha256");
  for (const root of authoritativeRoots) {
    const rootLabel = relative(REPO_ROOT, root).replaceAll("\\", "/");
    const files = (await filesUnder(root)).sort((left, right) => left.localeCompare(right, "en"));
    for (const path of files) {
      const bytes = await readFile(path);
      const fileLabel = `${rootLabel}/${relative(root, path).replaceAll("\\", "/")}`;
      hash.update(fileLabel, "utf8");
      hash.update("\0", "utf8");
      hash.update(String(bytes.length), "utf8");
      hash.update("\0", "utf8");
      hash.update(bytes);
    }
  }
  return hash.digest("hex");
}

function runPlaywright(extraArgs) {
  const cli = resolve(E2E_ROOT, "node_modules", "@playwright", "test", "cli.js");
  const env = { ...process.env };
  delete env.PATCHCOURT_AUTHORITATIVE_EVIDENCE_UPDATE;
  delete env.PATCHCOURT_EVIDENCE_DIR;
  delete env.PATCHCOURT_REJECTION_EVIDENCE_DIR;
  const child = spawn(
    process.execPath,
    [cli, "test", "--config", "playwright.config.mjs", ...extraArgs],
    { cwd: E2E_ROOT, env, stdio: "inherit", windowsHide: true }
  );
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit({ code: code ?? 1, signal }));
  });
}

function runPathContract() {
  const env = { ...process.env };
  delete env.PATCHCOURT_AUTHORITATIVE_EVIDENCE_UPDATE;
  delete env.PATCHCOURT_EVIDENCE_DIR;
  delete env.PATCHCOURT_REJECTION_EVIDENCE_DIR;
  const child = spawn(
    process.execPath,
    ["--test", "evidence-paths.contract.test.mjs"],
    { cwd: E2E_ROOT, env, stdio: "inherit", windowsHide: true }
  );
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit({ code: code ?? 1, signal }));
  });
}

const beforeSha256 = await authoritativeTreeSha256();
const pathContractResult = await runPathContract();
const result = await runPlaywright(process.argv.slice(2));
const afterSha256 = await authoritativeTreeSha256();
const unchanged = beforeSha256 === afterSha256;
const proof = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  command: "default Playwright E2E",
  authoritativeRoots: authoritativeRoots.map((path) => relative(REPO_ROOT, path).replaceAll("\\", "/")),
  algorithm: "sha256(path + NUL + byteLength + NUL + bytes)-v1",
  beforeSha256,
  afterSha256,
  unchanged,
  pathContractExit: pathContractResult,
  playwrightExit: result,
  defaultEvidenceRoot: relative(REPO_ROOT, resolve(TEST_RESULTS_ROOT, "evidence")).replaceAll("\\", "/"),
};
await mkdir(TEST_RESULTS_ROOT, { recursive: true });
await writeFile(
  resolve(TEST_RESULTS_ROOT, "authoritative-immutability.json"),
  `${JSON.stringify(proof, null, 2)}\n`,
  "utf8"
);
process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);

if (!unchanged) throw new Error("default E2E mutated authoritative evidence");
if (pathContractResult.code !== 0) process.exit(pathContractResult.code);
if (result.code !== 0) process.exit(result.code);
