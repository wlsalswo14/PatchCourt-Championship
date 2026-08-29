import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { ContractError, NotFoundError, isTerminal, redactText, type RunRequest } from "@patchcourt/core";

import { DEFAULT_TARGET_URL, TASK_CONTRACT_VERSION } from "./constants.js";
import { PatchCourtService } from "./service.js";

function allowedOrigins(): Set<string> {
  const configured = (process.env.PATCHCOURT_WEB_ORIGINS ?? "http://127.0.0.1:4175,http://localhost:4175,http://127.0.0.1:5173,http://localhost:5173")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set(configured);
}

function corsHeaders(request: IncomingMessage): Record<string, string> {
  const origin = request.headers.origin;
  const allowed = allowedOrigins();
  return origin && allowed.has(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
}

function baseHeaders(request: IncomingMessage): Record<string, string> {
  return {
    ...corsHeaders(request),
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(response: ServerResponse, request: IncomingMessage, status: number, body: unknown): void {
  response.writeHead(status, { ...baseHeaders(request), "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 64_000) throw new ContractError("request body exceeds 64KB");
    chunks.push(buffer);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ContractError("request body must be a JSON object");
  }
}

export function createApiServer(service = new PatchCourtService()) {
  return createServer(async (request, response) => {
    try {
      const origin = request.headers.origin;
      if (origin && !allowedOrigins().has(origin)) return json(response, request, 403, { error: "origin_not_allowed" });
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          ...baseHeaders(request),
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "600",
        });
        return response.end();
      }
      const url = new URL(request.url ?? "/", "http://api.patchcourt.local");
      if (request.method === "GET" && (url.pathname === "/api/health" || url.pathname === "/health")) {
        return json(response, request, 200, { ok: true, service: "patchcourt-api", mode: service.mode, syntheticFixtureOnly: true });
      }
      if (request.method === "GET" && url.pathname === "/api/capabilities") return json(response, request, 200, service.capabilities());
      if (request.method === "GET" && url.pathname === "/api/runs") return json(response, request, 200, { runs: await service.list() });
      if (request.method === "POST" && url.pathname === "/api/runs") {
        const body = await readJson(request);
        if (typeof body.userTask !== "string") throw new ContractError("userTask is required");
        if ("taskContractVersion" in body && typeof body.taskContractVersion !== "string") throw new ContractError("taskContractVersion must be text");
        if (typeof body.taskContractVersion === "string" && body.taskContractVersion !== TASK_CONTRACT_VERSION) {
          throw new ContractError(`unsupported task contract version: ${body.taskContractVersion}`);
        }
        const runRequest: RunRequest = {
          targetUrl: typeof body.targetUrl === "string" ? body.targetUrl : DEFAULT_TARGET_URL,
          userTask: body.userTask,
          ...(typeof body.taskContractVersion === "string" ? { taskContractVersion: body.taskContractVersion } : {}),
          ...(typeof body.demoSlug === "string" ? { demoSlug: body.demoSlug } : {}),
        };
        const run = await service.create(runRequest);
        return json(response, request, 202, run);
      }
      const runMatch = url.pathname.match(/^\/api\/runs\/([a-z0-9_-]+)$/i);
      if (request.method === "GET" && runMatch?.[1]) return json(response, request, 200, await service.get(runMatch[1]));
      const cancelMatch = url.pathname.match(/^\/api\/runs\/([a-z0-9_-]+)\/cancel$/i);
      if (request.method === "POST" && cancelMatch?.[1]) return json(response, request, 200, await service.cancel(cancelMatch[1]));
      const receiptMatch = url.pathname.match(/^\/api\/runs\/([a-z0-9_-]+)\/receipt$/i);
      if (request.method === "GET" && receiptMatch?.[1]) return json(response, request, 200, await service.receipt(receiptMatch[1]));
      const eventsMatch = url.pathname.match(/^\/api\/runs\/([a-z0-9_-]+)\/events$/i);
      if (request.method === "GET" && eventsMatch?.[1]) {
        const run = await service.get(eventsMatch[1]);
        response.writeHead(200, {
          ...baseHeaders(request),
          "Content-Type": "text/event-stream; charset=utf-8",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        response.write("retry: 1500\n\n");
        const unsubscribe = service.broker.subscribe(run, response);
        if (isTerminal(run.status)) return;
        const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000);
        let cleaned = false;
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          clearInterval(heartbeat);
          unsubscribe();
        };
        request.on("close", cleanup);
        response.on("close", cleanup);
        return;
      }
      const demoMatch = url.pathname.match(/^\/api\/demo-runs\/([a-z0-9_-]+)$/i);
      if (request.method === "GET" && demoMatch?.[1]) {
        const run = await service.demoRun(demoMatch[1]);
        if (!run) throw new NotFoundError("recorded demo run not found");
        return json(response, request, 200, run);
      }
      const artifactMatch = url.pathname.match(/^\/api\/artifacts\/([a-z0-9._-]+)$/i);
      if (request.method === "GET" && artifactMatch?.[1]) {
        const artifact = await service.artifacts.read(artifactMatch[1]);
        response.writeHead(200, { ...baseHeaders(request), "Content-Type": artifact.contentType, "Content-Length": String(artifact.bytes.length) });
        return response.end(artifact.bytes);
      }
      return json(response, request, 404, { error: "not_found" });
    } catch (error) {
      const status = error instanceof NotFoundError ? 404 : error instanceof ContractError ? 400 : 500;
      if (status === 500) console.error("api_request_failed", { name: error instanceof Error ? error.name : "unknown" });
      return json(response, request, status, {
        error: status === 500 ? "internal_error" : error instanceof Error ? redactText(error.message) : "request_failed",
      });
    }
  });
}
