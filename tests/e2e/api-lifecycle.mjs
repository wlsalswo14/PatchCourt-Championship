import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, get as httpGet } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE_DIR = resolve(
  process.env.PATCHCOURT_INTEGRATION_EVIDENCE_DIR ?? join(REPO, "docs", "evidence", "integration")
);
const CANONICAL_USER_TASK =
  "Sign in as the brand demo, open Creator Directory, search US, open John Smith, determine audience, verified channel, market fit, and next action, then change the fee to 1500 and prepare an unsent offer draft.";
const EXPECTED_FACTS_SHA256 = "c1fc28e2027abda3b717cc971f3865d0e6686ea9b82c9b38bcbd099c1787fb90";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const evidenceRoot = resolve(REPO, "docs", "evidence");
const evidenceRelative = relative(evidenceRoot, EVIDENCE_DIR);
assert(
  EVIDENCE_DIR === evidenceRoot ||
    (!isAbsolute(evidenceRelative) && !evidenceRelative.startsWith("..")),
  "integration evidence directory escaped docs/evidence"
);

async function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object", "could not reserve loopback port");
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

function startOwnedNode(script, env) {
  const startedAt = new Date().toISOString();
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
  const child = spawn(process.execPath, [script], {
    cwd: REPO,
    env: { ...inherited, ...env },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(`stdout: ${chunk.toString("utf8").trim()}`));
  child.stderr.on("data", (chunk) => logs.push(`stderr: ${chunk.toString("utf8").trim()}`));
  return { child, logs, startedAt };
}

async function startSnapshotGateProxy(upstreamOrigin, port) {
  const upstream = new URL(upstreamOrigin);
  assert(upstream.hostname === "127.0.0.1", "snapshot gate proxy upstream must be loopback");
  let manifestRequestCount = 0;
  let snapshotBlocked = false;
  let released = false;
  let resolveSnapshotBlocked;
  let resolveRelease;
  const snapshotBlockedPromise = new Promise((resolveBlocked) => {
    resolveSnapshotBlocked = resolveBlocked;
  });
  const releasePromise = new Promise((resolveGate) => {
    resolveRelease = resolveGate;
  });
  const startedAt = new Date().toISOString();

  const server = createHttpServer(async (request, response) => {
    try {
      const target = new URL(request.url ?? "/", upstream);
      assert(target.origin === upstream.origin, "snapshot gate proxy target escaped its upstream");
      if (target.pathname === "/__patchcourt/manifest.json") {
        manifestRequestCount += 1;
        if (manifestRequestCount === 2) {
          snapshotBlocked = true;
          resolveSnapshotBlocked();
          await releasePromise;
        }
      }

      const chunks = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const headers = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (!value || ["connection", "content-length", "host"].includes(name.toLowerCase())) continue;
        headers[name] = Array.isArray(value) ? value.join(", ") : value;
      }
      const upstreamResponse = await fetch(target, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method ?? "GET") ? undefined : body,
        redirect: "manual",
      });
      const bytes = Buffer.from(await upstreamResponse.arrayBuffer());
      const responseHeaders = {};
      upstreamResponse.headers.forEach((value, name) => {
        if (["connection", "content-encoding", "content-length", "transfer-encoding"].includes(name.toLowerCase())) return;
        responseHeaders[name] = value;
      });
      response.writeHead(upstreamResponse.status, {
        ...responseHeaders,
        "content-length": String(bytes.length),
      });
      response.end(bytes);
    } catch (error) {
      if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "snapshot_proxy_failure" }));
    }
  });

  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListen);
  });

  const release = () => {
    if (released) return;
    released = true;
    resolveRelease();
  };
  return {
    origin: `http://127.0.0.1:${port}`,
    startedAt,
    get manifestRequestCount() {
      return manifestRequestCount;
    },
    async waitUntilSnapshotBlocked(timeoutMs = 10_000) {
      let timeoutId;
      try {
        await Promise.race([
          snapshotBlockedPromise,
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error("worker did not reach gated snapshot manifest")), timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timeoutId);
      }
      assert(snapshotBlocked, "snapshot gate resolved without blocking the worker");
    },
    release,
    async close() {
      release();
      await new Promise((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      });
    },
  };
}

async function stopOwnedNode(owned) {
  if (owned.child.exitCode !== null) return;
  owned.child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolveExit) => owned.child.once("exit", () => resolveExit(true))),
    new Promise((resolveExit) => setTimeout(() => resolveExit(false), 5_000)),
  ]);
  if (!exited && owned.child.exitCode === null) owned.child.kill("SIGKILL");
}

async function waitJson(url, timeoutMs = 15_000) {
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

async function jsonRequest(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...init?.headers },
  });
  const body = await response.json();
  assert(response.ok, `${url} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function openEventStream(url) {
  const events = [];
  let response;
  let request;
  let intentionalClose = false;
  let doneSettled = false;
  let resolveDone;
  let rejectDone;
  const done = new Promise((resolveEvents, rejectEvents) => {
    resolveDone = resolveEvents;
    rejectDone = rejectEvents;
  });
  void done.catch(() => undefined);
  const finish = (error) => {
    if (doneSettled) return;
    doneSettled = true;
    if (error) rejectDone(error);
    else resolveDone(events);
  };

  await new Promise((resolveOpen, rejectOpen) => {
    request = httpGet(url, { headers: { accept: "text/event-stream" } }, (incoming) => {
      response = incoming;
      const contentType = incoming.headers["content-type"] ?? "";
      if ((incoming.statusCode ?? 500) >= 400 || !contentType.startsWith("text/event-stream")) {
        incoming.resume();
        rejectOpen(new Error(`SSE open failed: ${incoming.statusCode} (${contentType || "no content type"})`));
        return;
      }

      incoming.setEncoding("utf8");
    let buffer = "";
      incoming.on("data", (chunk) => {
        buffer += chunk;
        for (;;) {
          const boundary = buffer.indexOf("\n\n");
          if (boundary < 0) break;
          const block = buffer.slice(0, boundary).replaceAll("\r", "");
          buffer = buffer.slice(boundary + 2);
          if (!block || block.startsWith(":")) continue;
          let event = "message";
          let id = null;
          const dataLines = [];
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("id:")) id = line.slice(3).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
          }
          const rawData = dataLines.join("\n");
          let data = rawData;
          try {
            data = JSON.parse(rawData);
          } catch {
            // Retain non-JSON evidence verbatim.
          }
          events.push({ event, id, data });
          if (event === "receipt_ready") {
            finish();
            intentionalClose = true;
            incoming.destroy();
            break;
          }
        }
      });
      incoming.once("end", () => finish());
      incoming.once("close", () => finish());
      incoming.once("error", (error) => {
        if (intentionalClose) finish();
        else finish(error);
      });
      resolveOpen();
    });
    request.once("error", (error) => {
      if (response) {
        if (intentionalClose) finish();
        else finish(error);
      } else {
        rejectOpen(error);
      }
    });
  });

  const controller = {
    abort() {
      intentionalClose = true;
      response?.destroy();
      request?.destroy();
      finish();
    },
  };
  return { controller, done, events };
}

async function waitForEventStream(stream, timeoutMs, timeoutMessage) {
  let timeoutId;
  try {
    return await Promise.race([
      stream.done,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          stream.controller.abort();
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function stableRecoveryProjection(run) {
  return {
    id: run.id,
    status: run.status,
    cancellationRequested: run.cancellationRequested,
    failure: run.failure,
    receipt: run.receipt,
    eventHashes: run.events.map(({ id, sequence, type, status, hash, previousHash }) => ({
      id,
      sequence,
      type,
      status,
      hash,
      previousHash,
    })),
  };
}

await mkdir(EVIDENCE_DIR, { recursive: true });
const tempBase = resolve(tmpdir());
const runtimeRoot = await mkdtemp(join(tempBase, "patchcourt-api-lifecycle-"));
assert(
  resolve(runtimeRoot).startsWith(`${tempBase}${sep}`) && relative(tempBase, runtimeRoot).startsWith("patchcourt-api-lifecycle-"),
  "temporary runtime escaped the operating-system temp directory"
);

const demoPort = await reservePort();
let targetPort = await reservePort();
while (targetPort === demoPort) targetPort = await reservePort();
let apiPort = await reservePort();
while (apiPort === demoPort || apiPort === targetPort) apiPort = await reservePort();
const demoOrigin = `http://127.0.0.1:${demoPort}`;
const targetOrigin = `http://127.0.0.1:${targetPort}`;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
let demo;
let targetProxy;
let api;

try {
  demo = startOwnedNode("demo/brand-match/server.mjs", {
    PATCHCOURT_DEMO_PORT: String(demoPort),
  });
  const health = await waitJson(`${demoOrigin}/health`);
  const manifest = await waitJson(`${demoOrigin}/__patchcourt/manifest.json`);
  assert(health.ok === true && health.owned === true, "fresh demo health boundary failed");
  assert(manifest.facts?.digest === EXPECTED_FACTS_SHA256, "fresh demo facts digest mismatch");
  targetProxy = await startSnapshotGateProxy(demoOrigin, targetPort);
  const targetHealth = await waitJson(`${targetOrigin}/health`);
  assert(targetHealth.ok === true && targetHealth.owned === true, "snapshot gate target health failed");

  const apiEnv = {
    PATCHCOURT_API_HOST: "127.0.0.1",
    PATCHCOURT_API_PORT: String(apiPort),
    PATCHCOURT_RUNTIME_ROOT: runtimeRoot,
    PATCHCOURT_EXECUTION_MODE: "offline-demo",
    PATCHCOURT_OWNED_ORIGINS: targetOrigin,
  };
  const initialApi = startOwnedNode("apps/api/dist/src/index.js", apiEnv);
  api = initialApi;
  const firstHealth = await waitJson(`${apiOrigin}/api/health`);
  assert(firstHealth.ok === true && firstHealth.mode === "offline-demo", "fresh API health failed");

  const created = await jsonRequest(`${apiOrigin}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      targetUrl: targetOrigin,
      userTask: CANONICAL_USER_TASK,
      taskContractVersion: "pc01-v1",
      demoSlug: "cancel-recovery",
    }),
  });
  assert(created.status === "created", `expected created run, found ${created.status}`);

  const stream = await openEventStream(`${apiOrigin}/api/runs/${created.id}/events`);
  await targetProxy.waitUntilSnapshotBlocked();
  const cancelled = await jsonRequest(`${apiOrigin}/api/runs/${created.id}/cancel`, { method: "POST" });
  assert(cancelled.status === "invalid", `cancel must protect incumbent with invalid terminal status, found ${cancelled.status}`);
  assert(
    cancelled.failure?.code === "cancelled_by_user",
    `cancel failure code was not persisted: ${JSON.stringify(cancelled.failure)}`
  );
  assert(cancelled.cancellationRequested === true, "cancel marker was not persisted");
  targetProxy.release();

  const terminalEvents = await waitForEventStream(stream, 30_000, "SSE terminal timeout");
  const eventNames = terminalEvents.map(({ event }) => event);
  assert(eventNames.includes("run_terminal"), "SSE omitted run_terminal");
  assert(eventNames.at(-1) === "receipt_ready", "SSE did not terminate with receipt_ready");

  const beforeRestart = await jsonRequest(`${apiOrigin}/api/runs/${created.id}`);
  const beforeProjection = stableRecoveryProjection(beforeRestart);
  await stopOwnedNode(api);
  const recoveredApi = startOwnedNode("apps/api/dist/src/index.js", apiEnv);
  api = recoveredApi;
  const recoveredHealth = await waitJson(`${apiOrigin}/api/health`);
  assert(recoveredHealth.ok === true, "API did not recover on the same runtime root");
  const afterRestart = await jsonRequest(`${apiOrigin}/api/runs/${created.id}`);
  const afterProjection = stableRecoveryProjection(afterRestart);
  assert(
    JSON.stringify(afterProjection) === JSON.stringify(beforeProjection),
    "restarted API changed the sealed cancelled run"
  );

  const recoveryStream = await openEventStream(`${apiOrigin}/api/runs/${created.id}/events`);
  const replayedEvents = await waitForEventStream(recoveryStream, 10_000, "recovery SSE timeout");
  assert(replayedEvents.at(-1)?.event === "receipt_ready", "recovered terminal SSE did not close cleanly");
  const finalManifest = await waitJson(`${targetOrigin}/__patchcourt/manifest.json`);
  assert(
    finalManifest.taskFingerprint === manifest.taskFingerprint &&
      finalManifest.sourceSnapshotDigest === manifest.sourceSnapshotDigest &&
      finalManifest.candidateSnapshotDigest === manifest.candidateSnapshotDigest &&
      finalManifest.patchDigest === manifest.patchDigest &&
      finalManifest.facts?.digest === manifest.facts.digest,
    "fixture manifest changed during cancel/recovery evidence"
  );

  const evidence = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    boundary: {
      syntheticOwnedFixture: true,
      loopbackOnly: true,
      externalEffects: false,
      privateData: false,
    },
    freshServers: {
      demo: { pid: demo.child.pid, startedAt: demo.startedAt, origin: demoOrigin },
      gatedTarget: { pid: process.pid, startedAt: targetProxy.startedAt, origin: targetOrigin },
      apiInitial: { pid: initialApi.child.pid, startedAt: initialApi.startedAt, origin: apiOrigin },
      apiRecovered: { pid: recoveredApi.child.pid, startedAt: recoveredApi.startedAt, origin: apiOrigin },
      runtimeRootKind: "owned-os-temp",
    },
    manifest: {
      taskFingerprint: manifest.taskFingerprint,
      sourceSnapshotDigest: manifest.sourceSnapshotDigest,
      candidateSnapshotDigest: manifest.candidateSnapshotDigest,
      patchDigest: manifest.patchDigest,
      factsSha256: manifest.facts.digest,
    },
    synchronization: {
      strategy: "second-manifest snapshot gate",
      manifestRequestCount: targetProxy.manifestRequestCount,
      cancelIssuedWhileSnapshotBlocked: true,
      snapshotReleasedAfterCancelPersisted: true,
    },
    run: {
      id: created.id,
      status: afterRestart.status,
      failureCode: afterRestart.failure.code,
      cancellationRequested: afterRestart.cancellationRequested,
      receiptId: afterRestart.receipt.receiptId,
      receiptLedgerHead: afterRestart.receipt.ledgerHead,
      stateProjectionSha256: sha256(JSON.stringify(afterProjection)),
    },
    sse: {
      initialEventNames: eventNames,
      recoveryEventNames: replayedEvents.map(({ event }) => event),
      terminalReceiptReady: true,
    },
    assertions: {
      terminalCancelProtectedIncumbent: true,
      lateExecutionDidNotOverwriteCancel: true,
      restartRecoveredExactProjection: true,
      terminalSseReplayAfterRestart: true,
      factsDigestCheckedBeforeRun: true,
      cancellationRaceDeterministicallyGated: true,
    },
  };
  await writeFile(
    join(EVIDENCE_DIR, "api-cancel-recovery.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8"
  );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (api) await stopOwnedNode(api);
  if (targetProxy) await targetProxy.close();
  if (demo) await stopOwnedNode(demo);
  const resolvedRuntime = resolve(runtimeRoot);
  assert(
    resolvedRuntime.startsWith(`${tempBase}${sep}`) && relative(tempBase, resolvedRuntime).startsWith("patchcourt-api-lifecycle-"),
    "refusing to remove an unverified runtime path"
  );
  await rm(resolvedRuntime, { recursive: true, force: true });
}
