import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "public");
const DATA = join(HERE, "data");
const PATCH = join(HERE, "patches", "trust-profile.patch.json");
const REJECTION_PATCH = join(HERE, "patches", "rejected-mobile-overflow.css");
const VERIFIED_FACTS = join(DATA, "verified-facts.json");
const PORT = Number.parseInt(process.env.PATCHCOURT_DEMO_PORT ?? "4173", 10);
const HOST = "127.0.0.1";

const TASK = {
  id: "pc01-creator-discovery-offer-draft",
  title: "Find a credible US creator and prepare a safe offer draft",
  steps: [
    {
      id: "login",
      instruction: "Sign in with the brand demo account",
      actions: [
        { kind: "click", selector: "[data-testid='demo-login']" },
        { kind: "assertVisible", selector: "[data-testid='home-heading']" }
      ],
      capture: true
    },
    {
      id: "directory",
      instruction: "Open Creator Directory",
      actions: [
        { kind: "click", selector: "[data-testid='open-directory']" },
        { kind: "assertVisible", selector: "[data-testid='creator-search']" }
      ],
      capture: true
    },
    {
      id: "search",
      instruction: "Search for US",
      actions: [
        { kind: "fill", selector: "[data-testid='creator-search']", value: "US" },
        { kind: "click", selector: "[data-testid='search-submit']" },
        { kind: "assertVisible", selector: "[data-testid='creator-result']" }
      ],
      capture: true
    },
    {
      id: "profile",
      instruction: "Open John Smith",
      actions: [
        { kind: "click", selector: "[data-testid='open-john-smith']" },
        { kind: "assertVisible", selector: "[data-testid='profile-heading']" }
      ],
      capture: true
    },
    {
      id: "inspect",
      instruction:
        "Determine audience, verified channel, US-market fit, and next action",
      actions: [
        { kind: "assertVisible", selector: "[data-evidence-key='audience']" },
        { kind: "assertVisible", selector: "[data-evidence-key='channel']" },
        { kind: "assertVisible", selector: "[data-evidence-key='market-fit']" },
        { kind: "assertVisible", selector: "[data-evidence-key='next-action']" }
      ],
      capture: true
    },
    {
      id: "offer",
      instruction: "Change the fee to 1500 and prepare the draft",
      actions: [
        { kind: "click", selector: "[data-testid='open-offer']" },
        { kind: "assertEditable", selector: "[data-testid='offer-message']" },
        { kind: "assertEditable", selector: "[data-testid='offer-amount']" },
        { kind: "fill", selector: "[data-testid='offer-amount']", value: "1500" },
        { kind: "click", selector: "[data-testid='prepare-offer']" }
      ],
      capture: true
    },
    {
      id: "confirm",
      instruction: "Confirm the offer remains an unsent draft",
      actions: [
        { kind: "assertVisible", selector: "[data-testid='draft-status']" }
      ],
      capture: true
    }
  ]
};

const CRITICAL_INVARIANTS = [
  ["owned_local_target", "security", "Target is owned and loopback-only"],
  ["same_task_fingerprint", "security", "Both variants replay the exact same task"],
  ["brand_demo_login", "functionality", "Brand demo login succeeds"],
  ["directory_search", "functionality", "US search returns John Smith"],
  ["profile_open", "functionality", "John Smith profile opens"],
  [
    "decision_evidence_complete",
    "functionality",
    "Audience, verified channel, market fit, and next action are visible"
  ],
  ["offer_fields_editable", "functionality", "Message and fee stay editable"],
  ["draft_not_sent", "security", "Offer action only prepares a local draft"],
  [
    "no_internal_identifier_exposure",
    "privacy",
    "No opaque provider ID, secret, token, or internal URL is rendered"
  ],
  [
    "accessible_primary_controls",
    "accessibility",
    "Primary journey controls have accessible names"
  ],
  [
    "responsive_primary_action",
    "responsive",
    "Mobile has no document overflow or clipped primary action"
  ],
  [
    "console_and_network_clean",
    "security",
    "No relevant console error and no cross-origin request"
  ],
  ["artifact_integrity", "security", "Recorded evidence hashes verify"]
].map(([id, category, description]) => ({ id, category, description }));

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function digestFiles(paths) {
  const hash = createHash("sha256");
  for (const path of paths.sort()) {
    hash.update(path.replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await readFile(join(HERE, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function buildManifest() {
  const shellFiles = [
    "package.json",
    "server.mjs",
    "public/index.html",
    "public/app.js",
    "public/styles.css",
    "public/avatar.svg"
  ];
  const incumbentSha256 = await digestFiles([
    ...shellFiles,
    "data/incumbent.json"
  ]);
  const candidateSha256 = await digestFiles([
    ...shellFiles,
    "data/candidate.json"
  ]);
  const patchBody = await readFile(PATCH);
  const factsBody = await readFile(VERIFIED_FACTS);

  return {
    schemaVersion: 1,
    appId: "patchcourt-brand-match",
    owned: true,
    safety: {
      loopbackOnly: true,
      realCredentialsAccepted: false,
      privateDataAccepted: false,
      externalEffects: false,
      mustClearPaths: ["trust.providerDebug"]
    },
    sourceSnapshotDigest: incumbentSha256,
    candidateSnapshotDigest: candidateSha256,
    patchDigest: sha256(patchBody),
    facts: {
      path: "/__patchcourt/verified-facts.json",
      digest: sha256(factsBody),
      kind: "synthetic-public-fixture",
      fields: [
        "creator.followers",
        "creator.engagementRate",
        "audience.country.US",
        "audience.age.18-34",
        "channel.platform",
        "channel.publicHandle",
        "channel.ownershipStatus",
        "content.recentCategory",
        "campaign.targetAudience",
        "offer.recommendedStartingFeeUsd"
      ]
    },
    variants: { incumbent: "/incumbent", candidate: "/candidate" },
    task: TASK,
    taskFingerprint: sha256(stableJson(TASK)),
    criticalInvariants: CRITICAL_INVARIANTS
  };
}

function hostIsAllowed(hostHeader = "") {
  const normalized = hostHeader.toLowerCase();
  return /^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/.test(normalized);
}

function headers(contentType, extra = {}) {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Type": contentType,
    ...extra
  };
}

function send(res, status, body, contentType = "text/plain; charset=utf-8", extra = {}) {
  res.writeHead(status, headers(contentType, extra));
  if (res.req.method === "HEAD") return res.end();
  res.end(body);
}

async function serveFile(res, path) {
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };
  const body = await readFile(path);
  send(res, 200, body, contentTypes[extname(path)] ?? "application/octet-stream");
}

const server = createServer(async (req, res) => {
  try {
    if (!hostIsAllowed(req.headers.host)) {
      return send(res, 403, "Loopback host required");
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, "Method not allowed", undefined, { Allow: "GET, HEAD" });
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/health") {
      return send(
        res,
        200,
        JSON.stringify({ ok: true, owned: true, effects: "none" }),
        "application/json; charset=utf-8"
      );
    }
    if (url.pathname === "/__patchcourt/manifest.json") {
      return send(
        res,
        200,
        JSON.stringify(await buildManifest(), null, 2),
        "application/json; charset=utf-8"
      );
    }
    if (url.pathname === "/__patchcourt/patch.json") {
      return serveFile(res, PATCH);
    }
    if (url.pathname === "/__patchcourt/verified-facts.json") {
      return serveFile(res, VERIFIED_FACTS);
    }
    if (url.pathname === "/__patchcourt/rejected-mobile-overflow.css") {
      return serveFile(res, REJECTION_PATCH);
    }
    if (url.pathname === "/__patchcourt/data.json") {
      const variant = url.searchParams.get("variant");
      if (variant !== "incumbent" && variant !== "candidate") {
        return send(res, 400, "Unknown variant");
      }
      return serveFile(res, join(DATA, `${variant}.json`));
    }
    if (url.pathname === "/") {
      res.writeHead(302, headers("text/plain; charset=utf-8", { Location: "/incumbent" }));
      return res.end();
    }
    if (url.pathname === "/incumbent" || url.pathname === "/candidate") {
      return serveFile(res, join(PUBLIC, "index.html"));
    }

    const assetRoutes = new Map([
      ["/assets/app.js", "app.js"],
      ["/assets/styles.css", "styles.css"],
      ["/assets/avatar.svg", "avatar.svg"]
    ]);
    if (assetRoutes.has(url.pathname)) {
      return serveFile(res, join(PUBLIC, assetRoutes.get(url.pathname)));
    }

    return send(res, 404, "Not found");
  } catch (error) {
    console.error("fixture_server_error", error instanceof Error ? error.message : "unknown");
    return send(res, 500, "Fixture error");
  }
});

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  server.listen(PORT, HOST, () => {
    console.log(`PatchCourt owned demo listening on http://${HOST}:${PORT}`);
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export { TASK, CRITICAL_INVARIANTS, buildManifest, hostIsAllowed, stableJson, server };
