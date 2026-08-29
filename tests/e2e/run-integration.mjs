import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE_ROOT = resolve(REPO, "docs", "evidence");
const EVIDENCE_DIR = resolve(
  process.env.PATCHCOURT_INTEGRATION_EVIDENCE_DIR ?? join(EVIDENCE_ROOT, "integration")
);
const relativeEvidence = relative(EVIDENCE_ROOT, EVIDENCE_DIR);
if (isAbsolute(relativeEvidence) || relativeEvidence.startsWith("..")) {
  throw new Error("integration evidence directory escaped docs/evidence");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function reservePort(excluded = new Set()) {
  for (;;) {
    const port = await new Promise((resolvePort, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        assert(address && typeof address === "object", "could not reserve loopback port");
        server.close((error) => (error ? reject(error) : resolvePort(address.port)));
      });
    });
    if (!excluded.has(port)) return port;
  }
}

function safeEnvironment(extra) {
  const inheritedNames = [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "LOCALAPPDATA",
    "APPDATA",
    "USERPROFILE",
    "PLAYWRIGHT_BROWSERS_PATH",
  ];
  const inherited = Object.fromEntries(
    inheritedNames
      .filter((name) => typeof process.env[name] === "string")
      .map((name) => [name, process.env[name]])
  );
  return { ...inherited, ...extra };
}

function startOwned(name, script, args, cwd, env) {
  const startedAt = new Date().toISOString();
  const child = spawn(process.execPath, [script, ...args], {
    cwd,
    env: safeEnvironment(env),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  const record = (stream, chunk) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/u).filter(Boolean)) {
      logs.push(`${stream}: ${line}`);
      if (logs.length > 200) logs.shift();
    }
  };
  child.stdout.on("data", (chunk) => record("stdout", chunk));
  child.stderr.on("data", (chunk) => record("stderr", chunk));
  return { name, child, startedAt, logs };
}

async function stopOwned(owned) {
  if (!owned || owned.child.exitCode !== null) return;
  owned.child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolveExit) => owned.child.once("exit", () => resolveExit(true))),
    new Promise((resolveExit) => setTimeout(() => resolveExit(false), 5_000)),
  ]);
  if (!exited && owned.child.exitCode === null) owned.child.kill("SIGKILL");
}

async function waitJson(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (response.ok) return response.json();
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw lastError ?? new Error(`timed out waiting for ${url}`);
}

async function waitWeb(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const text = await response.text();
      const isPatchCourtEntry =
        text.includes('<div id="root"></div>') && text.includes('/src/main.tsx');
      if (response.ok && isPatchCourtEntry) return { status: response.status };
      lastError = new Error(`${url} was not the PatchCourt Vite app`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw lastError ?? new Error(`timed out waiting for ${url}`);
}

async function waitAsset(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const contentType = response.headers.get("content-type") ?? "";
      if (response.ok && contentType.startsWith("image/png")) return { status: response.status };
      lastError = new Error(`${url} returned ${response.status} (${contentType || "no content type"})`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw lastError ?? new Error(`timed out waiting for ${url}`);
}

async function readOptionalJson(url, timeoutMs = 2_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return { reachable: true, status: response.status };
    return { reachable: true, status: response.status, body: await response.json() };
  } catch (error) {
    return { reachable: false, error: error instanceof Error ? error.name : "unknown" };
  } finally {
    clearTimeout(timer);
  }
}

async function runPlaywright(env) {
  const cli = resolve(REPO, "tests", "e2e", "node_modules", "@playwright", "test", "cli.js");
  const child = spawn(process.execPath, [cli, "test", "--config", "playwright.integration.config.mjs"], {
    cwd: resolve(REPO, "tests", "e2e"),
    env: safeEnvironment(env),
    windowsHide: true,
    stdio: "inherit",
  });
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit({ code: code ?? 1, signal }));
  });
}

await mkdir(EVIDENCE_DIR, { recursive: true });
const usedPorts = new Set();
const fixturePort = await reservePort(usedPorts);
usedPorts.add(fixturePort);
const apiPort = await reservePort(usedPorts);
usedPorts.add(apiPort);
const webPort = await reservePort(usedPorts);
usedPorts.add(webPort);
const publicWebPort = await reservePort(usedPorts);
const fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;
const publicWebOrigin = `http://127.0.0.1:${publicWebPort}`;
const stamp = new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14);
const runtimeRoot = resolve(EVIDENCE_DIR, `api-runtime-${stamp}`);
const serverSourceMtime = (await stat(resolve(REPO, "demo", "brand-match", "server.mjs"))).mtime.toISOString();
const staleDefault = await readOptionalJson("http://127.0.0.1:4173/__patchcourt/manifest.json");

let fixture;
let api;
let web;
let publicWeb;
let exit = { code: 1, signal: null };
let manifest;
let health;
let capabilities;
try {
  fixture = startOwned(
    "fixture",
    resolve(REPO, "demo", "brand-match", "server.mjs"),
    [],
    REPO,
    { PATCHCOURT_DEMO_PORT: String(fixturePort) }
  );
  manifest = await waitJson(`${fixtureOrigin}/__patchcourt/manifest.json`);
  health = await waitJson(`${fixtureOrigin}/health`);
  assert(manifest.facts?.digest, "fresh fixture manifest omitted facts digest");
  assert(new Date(fixture.startedAt) > new Date(serverSourceMtime), "fixture process predates its source file");

  api = startOwned(
    "api",
    resolve(REPO, "apps", "api", "dist", "src", "index.js"),
    [],
    REPO,
    {
      PATCHCOURT_API_HOST: "127.0.0.1",
      PATCHCOURT_API_PORT: String(apiPort),
      PATCHCOURT_RUNTIME_ROOT: runtimeRoot,
      PATCHCOURT_EXECUTION_MODE: "offline-demo",
      PATCHCOURT_OWNED_ORIGINS: fixtureOrigin,
      PATCHCOURT_WEB_ORIGINS: `${webOrigin},${publicWebOrigin}`,
    }
  );
  await waitJson(`${apiOrigin}/api/health`);
  capabilities = await waitJson(`${apiOrigin}/api/capabilities`);

  web = startOwned(
    "web",
    resolve(REPO, "node_modules", "vite", "bin", "vite.js"),
    ["--host", "127.0.0.1", "--port", String(webPort), "--strictPort"],
    resolve(REPO, "apps", "web"),
    {
      VITE_API_BASE_URL: apiOrigin,
      VITE_PATCHCOURT_TARGET_URL: fixtureOrigin,
    }
  );
  await waitWeb(webOrigin);
  await waitAsset(`${webOrigin}/evidence/arm-a-profile.png`);
  await waitAsset(`${webOrigin}/evidence/arm-b-profile.png`);

  publicWeb = startOwned(
    "public-web",
    resolve(REPO, "node_modules", "vite", "bin", "vite.js"),
    ["--host", "127.0.0.1", "--port", String(publicWebPort), "--strictPort"],
    resolve(REPO, "apps", "web"),
    {
      VITE_API_BASE_URL: apiOrigin,
      VITE_PATCHCOURT_TARGET_URL: fixtureOrigin,
      VITE_PUBLIC_REPLAY_ONLY: "true",
    }
  );
  await waitWeb(publicWebOrigin);
  await waitAsset(`${publicWebOrigin}/evidence/arm-a-profile.png`);
  await waitAsset(`${publicWebOrigin}/evidence/arm-b-profile.png`);

  const preflight = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    sourceMtime: serverSourceMtime,
    fresh: {
      fixture: { pid: fixture.child.pid, startedAt: fixture.startedAt, origin: fixtureOrigin },
      api: { pid: api.child.pid, startedAt: api.startedAt, origin: apiOrigin },
      web: { pid: web.child.pid, startedAt: web.startedAt, origin: webOrigin },
      publicWeb: { pid: publicWeb.child.pid, startedAt: publicWeb.startedAt, origin: publicWebOrigin },
      runtimeRoot: relative(REPO, runtimeRoot).replaceAll("\\", "/"),
    },
    manifest: {
      taskFingerprint: manifest.taskFingerprint,
      sourceSnapshotDigest: manifest.sourceSnapshotDigest,
      candidateSnapshotDigest: manifest.candidateSnapshotDigest,
      patchDigest: manifest.patchDigest,
      factsSha256: manifest.facts.digest,
    },
    fixtureHealth: health,
    apiCapabilities: capabilities,
    staleDefault4173: {
      inspectedReadOnly: true,
      reused: false,
      ...staleDefault,
    },
  };
  await writeFile(join(EVIDENCE_DIR, "servers.json"), `${JSON.stringify(preflight, null, 2)}\n`, "utf8");

  exit = await runPlaywright({
    PATCHCOURT_WEB_URL: webOrigin,
    PATCHCOURT_API_URL: apiOrigin,
    PATCHCOURT_FIXTURE_URL: fixtureOrigin,
    PATCHCOURT_PUBLIC_WEB_URL: publicWebOrigin,
    PATCHCOURT_INTEGRATION_EVIDENCE_DIR: EVIDENCE_DIR,
  });
} finally {
  await stopOwned(publicWeb);
  await stopOwned(web);
  await stopOwned(api);
  await stopOwned(fixture);
  const completed = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    sourceMtime: serverSourceMtime,
    fresh: {
      fixture: fixture ? { pid: fixture.child.pid, startedAt: fixture.startedAt, origin: fixtureOrigin } : null,
      api: api ? { pid: api.child.pid, startedAt: api.startedAt, origin: apiOrigin } : null,
      web: web ? { pid: web.child.pid, startedAt: web.startedAt, origin: webOrigin } : null,
      publicWeb: publicWeb ? { pid: publicWeb.child.pid, startedAt: publicWeb.startedAt, origin: publicWebOrigin } : null,
      stoppedAt: new Date().toISOString(),
      runtimeRoot: relative(REPO, runtimeRoot).replaceAll("\\", "/"),
    },
    manifest: manifest
      ? {
          taskFingerprint: manifest.taskFingerprint,
          sourceSnapshotDigest: manifest.sourceSnapshotDigest,
          candidateSnapshotDigest: manifest.candidateSnapshotDigest,
          patchDigest: manifest.patchDigest,
          factsSha256: manifest.facts.digest,
        }
      : null,
    fixtureHealth: health ?? null,
    apiCapabilities: capabilities ?? null,
    staleDefault4173: { inspectedReadOnly: true, reused: false, ...staleDefault },
    testExit: exit,
    serverLogs: {
      fixture: fixture?.logs ?? [],
      api: api?.logs ?? [],
      web: web?.logs ?? [],
      publicWeb: publicWeb?.logs ?? [],
    },
  };
  await writeFile(join(EVIDENCE_DIR, "servers.json"), `${JSON.stringify(completed, null, 2)}\n`, "utf8");
}

if (exit.code !== 0) process.exit(exit.code);
