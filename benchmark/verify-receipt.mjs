#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  candidateReadyForBlindJudge,
  decidePromotion
} from "./promotion-policy.mjs";
import { inspectCriticProvenance } from "./critic-provenance.mjs";
import { inspectJudgeValidationRepair } from "./judge-validation-repair.mjs";
import { buildManifest } from "../demo/brand-match/server.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const receiptPath = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(REPO, "docs", "evidence", "latest", "receipt.json");

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

const errors = [];
const checks = [];

function check(name, passed, detail) {
  checks.push({ name, passed, detail });
  if (!passed) errors.push(`${name}: ${detail}`);
}

let receipt;
try {
  receipt = JSON.parse(await readFile(receiptPath, "utf8"));
} catch (error) {
  console.error(`Receipt read failed: ${error.message}`);
  process.exit(1);
}

check("schema_version", receipt.schemaVersion === 1, `found ${receipt.schemaVersion}`);
check("benchmark_id", receipt.benchmarkId === "PC01", `found ${receipt.benchmarkId}`);
check("task_fingerprint", isSha256(receipt.taskFingerprint), "must be lowercase SHA-256");

const payload = { ...receipt };
delete payload.integrity;
const expectedPayloadHash = sha256(canonicalJson(payload));
check(
  "canonical_payload_hash",
  receipt.integrity?.algorithm === "sha256-canonical-json-v1" &&
    receipt.integrity?.payloadSha256 === expectedPayloadHash,
  `expected ${expectedPayloadHash}`
);

let targetOrigin = null;
try {
  const parsed = new URL(receipt.target.origin);
  targetOrigin = parsed.origin;
  check(
    "loopback_target",
    parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname),
    parsed.origin
  );
} catch {
  check("loopback_target", false, "target origin is not a URL");
}
check(
  "owned_effect_boundary",
  receipt.target?.owned === true &&
    receipt.target?.loopbackOnly === true &&
    receipt.target?.externalRequestsBlocked === true,
  "owned, loopbackOnly, and externalRequestsBlocked must all be true"
);

for (const [name, value] of Object.entries(receipt.source ?? {})) {
  check(`source_digest:${name}`, isSha256(value), "must be lowercase SHA-256");
}

const execution = receipt.execution;
check(
  "execution_metadata",
  ["offline-demo", "live-gemini"].includes(execution?.mode) &&
    [execution?.criticProvider, execution?.patchProvider, execution?.judgeProvider].every(
      (value) => typeof value === "string" && value.length > 0
    ),
  "mode and all three provider identities must be sealed"
);
check(
  "execution_model_boundary",
  execution?.mode === "offline-demo"
    ? execution.model === null
    : execution?.mode === "live-gemini" && typeof execution.model === "string" && execution.model.length > 0,
  "offline-demo must declare model=null; live-gemini must name its model"
);

const criticProvenance = inspectCriticProvenance(receipt.criticProvenance);
check(
  "critic_provenance",
  criticProvenance.ok,
  criticProvenance.errors.join("; ") || "ordered unique critic IDs, counts, and digests verified"
);

const currentManifest = await buildManifest();
check(
  "live_manifest_task",
  receipt.taskFingerprint === currentManifest.taskFingerprint,
  `receipt=${receipt.taskFingerprint}; live=${currentManifest.taskFingerprint}`
);
check(
  "live_manifest_incumbent",
  receipt.source?.incumbentSha256 === currentManifest.sourceSnapshotDigest,
  `receipt=${receipt.source?.incumbentSha256}; live=${currentManifest.sourceSnapshotDigest}`
);
check(
  "live_manifest_facts",
  receipt.source?.factsSha256 === currentManifest.facts.digest,
  `receipt=${receipt.source?.factsSha256}; live=${currentManifest.facts.digest}`
);
if (receipt.comparison?.decision === "promote") {
  check(
    "live_manifest_candidate",
    receipt.source?.candidateSha256 === currentManifest.candidateSnapshotDigest,
    `receipt=${receipt.source?.candidateSha256}; live=${currentManifest.candidateSnapshotDigest}`
  );
  check(
    "live_manifest_patch",
    receipt.source?.patchSha256 === currentManifest.patchDigest,
    `receipt=${receipt.source?.patchSha256}; live=${currentManifest.patchDigest}`
  );
}

const reveal = receipt.blindComparison?.mappingReveal;
const validMapping =
  reveal &&
  ((reveal.A === "incumbent" && reveal.B === "candidate") ||
    (reveal.A === "candidate" && reveal.B === "incumbent"));
check("blind_distinct_mapping", validMapping, "A and B must reveal opposite variants");

if (validMapping) {
  const expectedCommitment = sha256(
    canonicalJson({
      mapping: { A: reveal.A, B: reveal.B },
      nonce: reveal.nonce,
      taskFingerprint: receipt.taskFingerprint
    })
  );
  check(
    "blind_order_commitment",
    receipt.blindComparison.orderCommitmentSha256 === expectedCommitment,
    `expected ${expectedCommitment}`
  );
}

const blind = receipt.blindComparison;
const judgeValidationRepair = inspectJudgeValidationRepair(blind?.validationRepair, {
  invocationCount: blind?.invocationCount,
  status: blind?.status,
});
check(
  "judge_validation_repair",
  judgeValidationRepair.ok,
  judgeValidationRepair.errors.join("; ") || "bounded judge invocation/repair metadata verified"
);
if (blind?.status === "valid") {
  check(
    "blind_valid_result",
    ["A", "B"].includes(blind.winnerLabel) &&
      reveal?.[blind.winnerLabel] === blind.revealedWinner &&
      ["incumbent", "candidate"].includes(blind.revealedWinner) &&
      blind.invalidReason === null,
    "valid result must map one winner label to its revealed variant"
  );
} else {
  check(
    "blind_nonvalid_cannot_promote",
    receipt.comparison?.decision !== "promote",
    `${blind?.status ?? "missing"} judge evidence cannot promote`
  );
}

const candidate = receipt.evaluations?.candidate;
const incumbent = receipt.evaluations?.incumbent;
const candidateReady = candidate && candidateReadyForBlindJudge(candidate);
if (candidateReady) {
  check(
    "candidate_gates_before_judge",
    blind?.status !== "valid" || blind.invocationCount >= 1,
    "a valid judge result requires at least one invocation after deterministic gates pass"
  );
} else {
  check(
    "judge_not_called_after_gate_failure",
    blind?.status === "invalid" &&
      blind.invocationCount === 0 &&
      blind.judge?.responseId === null &&
      blind.invalidReason?.startsWith("not_called:critical_gate_failed:"),
    "failed deterministic candidate gate must yield invalid/not-called judge evidence"
  );
}

if (incumbent && candidate && blind) {
  const expectedComparison = decidePromotion(incumbent, candidate, blind);
  check(
    "promotion_recomputed",
    sameJson(receipt.comparison, expectedComparison),
    `expected ${canonicalJson(expectedComparison)}`
  );
}

const artifactIds = new Set();
let verifiedArtifactCount = 0;
for (const artifact of receipt.artifacts ?? []) {
  check(
    `artifact_unique:${artifact.id}`,
    !artifactIds.has(artifact.id),
    "artifact id must be unique"
  );
  artifactIds.add(artifact.id);
  check(`artifact_hash_shape:${artifact.id}`, isSha256(artifact.sha256), "invalid SHA-256");

  if (!artifact.uri?.startsWith("docs/evidence/")) {
    check(`artifact_committed_uri:${artifact.id}`, false, `unsupported URI ${artifact.uri}`);
    continue;
  }
  const artifactPath = resolve(REPO, artifact.uri);
  const withinEvidence =
    !isAbsolute(artifact.uri) &&
    !relative(resolve(REPO, "docs", "evidence"), artifactPath).startsWith("..");
  check(`artifact_path_boundary:${artifact.id}`, withinEvidence, artifact.uri);
  if (!withinEvidence) continue;

  try {
    const bytes = await readFile(artifactPath);
    const actualHash = sha256(bytes);
    check(
      `artifact_bytes:${artifact.id}`,
      actualHash === artifact.sha256,
      `expected ${artifact.sha256}; found ${actualHash}`
    );
    verifiedArtifactCount += 1;
  } catch (error) {
    check(`artifact_bytes:${artifact.id}`, false, error.message);
  }
}

check(
  "artifact_minimum",
  verifiedArtifactCount >= 20,
  `verified ${verifiedArtifactCount}; expected at least 20 across four browser runs`
);

const serialized = JSON.stringify(receipt);
const secretPatterns = [
  /AIza[0-9A-Za-z_-]{30,}/,
  /\bsk-[0-9A-Za-z_-]{20,}/,
  /\bBearer\s+[0-9A-Za-z._-]{16,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
];
check(
  "secret_scan",
  secretPatterns.every((pattern) => !pattern.test(serialized)),
  "receipt resembles a credential or private key"
);

const report = {
  ok: errors.length === 0,
  receipt: relative(REPO, receiptPath).replaceAll("\\", "/"),
  runId: receipt.runId,
  targetOrigin,
  decision: receipt.comparison?.decision,
  blindStatus: blind?.status,
  verifiedArtifactCount,
  checkCount: checks.length,
  failedChecks: errors
};

console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) process.exit(1);
