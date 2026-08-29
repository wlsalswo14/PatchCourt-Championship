import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { PatchCourtService } from "../../apps/api/dist/src/service.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runtimeRoot = resolve(process.argv[2] ?? "");
const runId = process.argv[3] ?? "";
const evidenceDir = resolve(REPO, "docs", "evidence", "live");
const evidenceRelative = relative(resolve(REPO, "docs", "evidence"), evidenceDir);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

assert(process.argv[2], "usage: node extract-live-evidence.mjs <runtime-root> <run-id>");
assert(runId, "live run id is required");
assert(!isAbsolute(evidenceRelative) && !evidenceRelative.startsWith(".."), "live evidence escaped docs/evidence");

const service = new PatchCourtService({ runtimeRoot, mode: "offline-demo" });
const run = await service.get(runId);
const receipt = await service.receipt(runId);
assert(receipt && typeof receipt === "object" && !Array.isArray(receipt), "canonical receipt was not an object");

const artifactSchema = JSON.parse(
  await readFile(resolve(REPO, "benchmark", "schemas", "artifact.schema.json"), "utf8")
);
const receiptSchema = JSON.parse(
  await readFile(resolve(REPO, "benchmark", "schemas", "run-receipt.schema.json"), "utf8")
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(artifactSchema);
const validateReceipt = ajv.compile(receiptSchema);
assert(validateReceipt(receipt), `live receipt schema rejected: ${JSON.stringify(validateReceipt.errors)}`);

const payload = { ...receipt };
delete payload.integrity;
const canonicalPayloadSha256 = sha256(canonicalJson(payload));
assert(receipt.integrity?.payloadSha256 === canonicalPayloadSha256, "live receipt canonical payload hash mismatch");
assert(receipt.runId === runId, "live receipt run id mismatch");
assert(receipt.execution?.mode === "live-gemini", "live execution provenance was not sealed");
assert(receipt.comparison?.decision === "promote", "authoritative live run was not promoted");
assert(receipt.blindComparison?.status === "valid", "live blind comparison was not valid");

const candidateGates = receipt.evaluations?.candidate?.gates ?? [];
const failedCandidateGates = candidateGates.filter((gate) => !gate.passed);
assert(candidateGates.length > 0 && failedCandidateGates.length === 0, "live candidate has a failed deterministic gate");

let manifest = null;
try {
  const response = await fetch(`${receipt.target.origin}/__patchcourt/manifest.json`);
  if (response.ok) manifest = await response.json();
} catch {
  // The canonical receipt remains independently byte-verified if the fixture has stopped.
}
if (manifest) {
  assert(manifest.taskFingerprint === receipt.taskFingerprint, "live fixture task fingerprint drifted");
  assert(manifest.sourceSnapshotDigest === receipt.source.incumbentSha256, "live fixture source digest drifted");
  assert(manifest.facts?.digest === receipt.source.factsSha256, "live fixture facts digest drifted");
}

const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
const secretMatches = [
  ...receiptText.matchAll(/AIza[0-9A-Za-z_-]{20,}/gu),
  ...receiptText.matchAll(/AQ\.[0-9A-Za-z_-]{20,}/gu),
];
const absolutePathMatches = [
  ...receiptText.matchAll(/[A-Za-z]:\\\\[^"\r\n]+/gu),
  ...receiptText.matchAll(/file:\/\/\/[^"\r\n]+/gu),
];
assert(secretMatches.length === 0, "secret-like value found in canonical live receipt");
assert(absolutePathMatches.length === 0, "absolute local path found in canonical live receipt");

const groundingArtifactCount = run.patch?.groundingArtifactId ? 1 : 0;
const browserArtifactCount = Array.isArray(run.evidence) ? run.evidence.length : 0;
assert(
  receipt.artifacts.length === browserArtifactCount + groundingArtifactCount,
  "canonical artifact count did not match browser plus grounding evidence"
);
const proof = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  boundary: {
    ownedSyntheticFixture: true,
    loopbackOnly: receipt.target.loopbackOnly,
    externalRequestsBlocked: receipt.target.externalRequestsBlocked,
    providerRawResponsesCopied: false,
    secretsCopied: false,
    absoluteRuntimePathsCopied: false,
  },
  runtime: {
    rootNameOnly: basename(runtimeRoot),
    runId,
    status: run.status,
    execution: receipt.execution,
  },
  verification: {
    schemaValid: true,
    canonicalPayloadHashValid: true,
    artifactBytesReverifiedByService: true,
    browserArtifactCount,
    groundingArtifactCount,
    totalReverifiedArtifactCount: receipt.artifacts.length,
    candidateGateCount: candidateGates.length,
    candidateGatePassCount: candidateGates.length - failedCandidateGates.length,
    findingCount: Array.isArray(run.findings) ? run.findings.length : 0,
    criticProvenanceEntryCount: receipt.criticProvenance.entries.length,
    judgeInvocationCount: receipt.blindComparison.invocationCount,
    judgeValidationRepair: receipt.blindComparison.validationRepair,
    receiptPayloadSha256: receipt.integrity.payloadSha256,
    receiptFileSha256: sha256(receiptText),
    secretPatternMatches: secretMatches.length,
    absolutePathMatches: absolutePathMatches.length,
  },
  authority: {
    taskFingerprint: receipt.taskFingerprint,
    incumbentSha256: receipt.source.incumbentSha256,
    candidateSha256: receipt.source.candidateSha256,
    patchSha256: receipt.source.patchSha256,
    factsSha256: receipt.source.factsSha256,
    fixtureManifestAvailable: Boolean(manifest),
    fixtureManifestMatched: Boolean(manifest),
  },
  verdict: {
    decision: receipt.comparison.decision,
    blindStatus: receipt.blindComparison.status,
    scoreDelta: receipt.comparison.scoreDelta,
    decisionEvidenceDelta: receipt.comparison.decisionEvidenceDelta,
  },
};

await mkdir(evidenceDir, { recursive: true });
await writeFile(join(evidenceDir, "receipt.json"), receiptText, "utf8");
await writeFile(join(evidenceDir, "proof.json"), `${JSON.stringify(proof, null, 2)}\n`, "utf8");
await writeFile(
  join(evidenceDir, "SUMMARY.md"),
  `# Sanitized live Gemini evidence\n\n` +
    `- Run: \`${runId}\`\n` +
    `- Verdict: **${proof.verdict.decision}**; blind comparison **${proof.verdict.blindStatus}**\n` +
    `- Execution: **${receipt.execution.mode}** / \`${receipt.execution.model}\`\n` +
    `- Browser artifacts byte-reverified: **${proof.verification.browserArtifactCount}**\n` +
    `- Grounding artifacts byte-reverified: **${groundingArtifactCount}**\n` +
    `- Candidate deterministic gates: **${proof.verification.candidateGatePassCount}/${proof.verification.candidateGateCount} PASS**\n` +
    `- Critic provenance entries: **${proof.verification.criticProvenanceEntryCount}**\n` +
    `- Judge calls: **${proof.verification.judgeInvocationCount}**; repair: **${receipt.blindComparison.validationRepair.mode}**\n` +
    `- Task fingerprint: \`${receipt.taskFingerprint}\`\n` +
    `- Facts SHA-256: \`${receipt.source.factsSha256}\`\n` +
    `- Canonical payload SHA-256: \`${receipt.integrity.payloadSha256}\`\n\n` +
    `The API service reopened the persisted run without a provider key and re-hashed every sealed browser and grounding artifact before returning the canonical receipt. No raw provider response, secret-like value, or absolute runtime path was copied into public evidence.\n`,
  "utf8"
);

process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
