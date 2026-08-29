import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const webRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(webRoot, "../..");
const evidenceRoot = resolve(repoRoot, "docs/evidence/latest");
const rejectionEvidenceRoot = resolve(repoRoot, "docs/evidence/rejection");
const receiptSource = resolve(evidenceRoot, "receipt.json");
const rejectionReceiptSource = resolve(rejectionEvidenceRoot, "receipt.json");
const verifier = resolve(repoRoot, "benchmark/verify-receipt.mjs");
const benchmarkRoot = resolve(repoRoot, "benchmark");

function isInside(parentReal, candidateReal) {
  return candidateReal.startsWith(`${parentReal}${sep}`);
}

async function assertRealDirectory(path, label) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real non-symlink directory`);
  }
  return realpath(path);
}

async function assertRegularFileInside(path, allowedRoot, label) {
  const allowedRootReal = await assertRealDirectory(allowedRoot, `${label} root`);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  const fileReal = await realpath(path);
  if (!isInside(allowedRootReal, fileReal)) {
    throw new Error(`${label} escaped its sealed root`);
  }
  return fileReal;
}

async function verifyCanonicalReceipt(path, label) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [verifier, path], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const report = JSON.parse(stdout);
    if (report.ok !== true) throw new Error("verifier returned a negative report");
  } catch {
    throw new Error(`${label} failed the canonical benchmark receipt verifier`);
  }
}

const repoRootReal = await assertRealDirectory(repoRoot, "repository root");
const evidenceRootReal = await assertRealDirectory(evidenceRoot, "promotion evidence root");
const rejectionEvidenceRootReal = await assertRealDirectory(rejectionEvidenceRoot, "rejection evidence root");
if (!isInside(repoRootReal, evidenceRootReal) || !isInside(repoRootReal, rejectionEvidenceRootReal)) {
  throw new Error("sealed evidence roots escaped the repository");
}
await assertRegularFileInside(verifier, benchmarkRoot, "canonical receipt verifier");
await assertRegularFileInside(receiptSource, evidenceRoot, "promotion receipt");
await assertRegularFileInside(rejectionReceiptSource, rejectionEvidenceRoot, "rejection receipt");
await verifyCanonicalReceipt(receiptSource, "promotion receipt");
await verifyCanonicalReceipt(rejectionReceiptSource, "rejection receipt");

const receipt = JSON.parse(await readFile(receiptSource, "utf8"));
const rejectionReceipt = JSON.parse(await readFile(rejectionReceiptSource, "utf8"));
const mapping = receipt?.blindComparison?.mappingReveal;
const rejectionMapping = rejectionReceipt?.blindComparison?.mappingReveal;
for (const [label, armMapping] of [["latest", mapping], ["rejection", rejectionMapping]]) {
  if (
    !armMapping ||
    !["incumbent", "candidate"].includes(armMapping.A) ||
    !["incumbent", "candidate"].includes(armMapping.B) ||
    armMapping.A === armMapping.B
  ) {
    throw new Error(`${label} receipt does not contain a valid anonymous arm mapping`);
  }
}
if (!Array.isArray(receipt.artifacts) || !Array.isArray(rejectionReceipt.artifacts)) {
  throw new Error("verified receipts must contain artifact arrays");
}

const webRootReal = await assertRealDirectory(webRoot, "web workspace");
const publicEvidence = resolve(webRoot, "public/evidence");
const receiptData = resolve(webRoot, "src/data");
await mkdir(publicEvidence, { recursive: true });
await mkdir(receiptData, { recursive: true });
const publicEvidenceReal = await assertRealDirectory(publicEvidence, "public evidence destination");
const receiptDataReal = await assertRealDirectory(receiptData, "receipt data destination");
if (!isInside(webRootReal, publicEvidenceReal) || !isInside(webRootReal, receiptDataReal)) {
  throw new Error("replay destination escaped the web workspace");
}

async function assertSafeDestination(destination, allowedRootReal, label) {
  if (!isInside(allowedRootReal, destination)) {
    throw new Error(`${label} escaped its destination root`);
  }
  try {
    const stat = await lstat(destination);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`${label} must be a regular non-symlink file when it already exists`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const plannedDestinations = new Set();
const copyPlan = [];
async function planSealedPng(uri, destinationName) {
  const match = /^docs\/evidence\/(latest|rejection)\/([a-z0-9][a-z0-9._-]*\.png)$/u.exec(uri);
  if (!match) throw new Error(`receipt screenshot URI is outside the sealed PNG roots: ${uri}`);
  const [, group, filename] = match;
  const allowedRoot = group === "latest" ? evidenceRoot : rejectionEvidenceRoot;
  const source = resolve(allowedRoot, filename);
  const sourceReal = await assertRegularFileInside(source, allowedRoot, `receipt screenshot ${uri}`);
  const safeDestination = destinationName ?? filename;
  if (!/^[a-z0-9][a-z0-9._-]*\.png$/u.test(safeDestination)) {
    throw new Error(`public evidence destination is not a basename-only PNG: ${safeDestination}`);
  }
  const destination = resolve(publicEvidence, safeDestination);
  await assertSafeDestination(destination, publicEvidenceReal, `public evidence ${safeDestination}`);
  if (plannedDestinations.has(destination)) {
    throw new Error(`duplicate public evidence destination: ${safeDestination}`);
  }
  plannedDestinations.add(destination);
  copyPlan.push({ source: sourceReal, destination });
}

for (const artifact of [...receipt.artifacts, ...rejectionReceipt.artifacts]) {
  if (artifact.kind !== "screenshot" || !artifact.uri.startsWith("docs/evidence/")) continue;
  await planSealedPng(artifact.uri);
}
await planSealedPng(`docs/evidence/latest/${mapping.A}-desktop-profile.png`, "arm-a-profile.png");
await planSealedPng(`docs/evidence/latest/${mapping.B}-desktop-profile.png`, "arm-b-profile.png");
await planSealedPng(
  `docs/evidence/rejection/rejection-${rejectionMapping.A}-desktop-profile.png`,
  "rejection-arm-a-profile.png",
);
await planSealedPng(
  `docs/evidence/rejection/rejection-${rejectionMapping.B}-desktop-profile.png`,
  "rejection-arm-b-profile.png",
);

const promotionDestination = resolve(receiptData, "pc01-receipt.json");
const rejectionDestination = resolve(receiptData, "pc01-rejection-receipt.json");
await assertSafeDestination(promotionDestination, receiptDataReal, "promotion receipt destination");
await assertSafeDestination(rejectionDestination, receiptDataReal, "rejection receipt destination");

// Nothing is written until every receipt, source path, and destination has passed preflight.
await copyFile(receiptSource, promotionDestination);
await copyFile(rejectionReceiptSource, rejectionDestination);
for (const item of copyPlan) await copyFile(item.source, item.destination);

console.log(
  JSON.stringify({
    receiptId: receipt.receiptId,
    runId: receipt.runId,
    factsSha256: receipt.source.factsSha256,
    payloadSha256: receipt.integrity.payloadSha256,
    rejectionReceiptId: rejectionReceipt.receiptId,
    rejectionPayloadSha256: rejectionReceipt.integrity.payloadSha256,
    anonymousAssets: [
      "arm-a-profile.png",
      "arm-b-profile.png",
      "rejection-arm-a-profile.png",
      "rejection-arm-b-profile.png",
    ],
  }),
);
