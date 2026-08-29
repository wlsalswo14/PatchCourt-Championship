import { ContractError } from "./errors.js";
import { contentHash, redactText } from "./hash.js";
import { FINDING_DOMAINS, FINDING_SEVERITIES } from "./types.js";
import type {
  AtomicFinding,
  CriticFindingInput,
  CriticProvenanceProof,
  EvidenceArtifact,
  ImplementationBrief,
  RejectedFinding,
} from "./types.js";

const SEVERITY_ORDER = new Map(FINDING_SEVERITIES.map((severity, index) => [severity, index]));
const compareCodeUnits = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

export function buildCriticProvenanceProof(input: Pick<ImplementationBrief, "criticProvenance" | "acceptedCriticIdsDigest">): CriticProvenanceProof {
  const entries = [...input.criticProvenance].sort((left, right) => compareCodeUnits(left.criticId, right.criticId));
  const payload = { entries, acceptedCriticIdsDigest: input.acceptedCriticIdsDigest };
  return { entries, acceptedCriticIdsDigest: input.acceptedCriticIdsDigest, digest: contentHash(payload) };
}

export function verifyCriticProvenanceProof(proof: CriticProvenanceProof): boolean {
  const sorted = [...proof.entries].sort((left, right) => compareCodeUnits(left.criticId, right.criticId));
  const unique = new Set(sorted.map((entry) => entry.criticId));
  const countsValid = sorted.every((entry) => [entry.proposedCount, entry.acceptedCount, entry.rejectedCount].every((count) => Number.isInteger(count) && count >= 0)
    && entry.acceptedCount <= entry.proposedCount
    && entry.acceptedCount + entry.rejectedCount === entry.proposedCount);
  const acceptedIdsDigest = contentHash(sorted.filter((entry) => entry.acceptedCount > 0).map((entry) => entry.criticId));
  return unique.size === sorted.length
    && JSON.stringify(sorted) === JSON.stringify(proof.entries)
    && countsValid
    && proof.acceptedCriticIdsDigest === acceptedIdsDigest
    && proof.digest === contentHash({ entries: proof.entries, acceptedCriticIdsDigest: proof.acceptedCriticIdsDigest });
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmpty);
}

function rejectionReasons(finding: CriticFindingInput, evidenceIds: ReadonlySet<string>): string[] {
  const reasons: string[] = [];
  if (!nonEmpty(finding.criticId)) reasons.push("criticId is required");
  if (!(FINDING_DOMAINS as readonly string[]).includes(finding.domain)) reasons.push("unsupported domain");
  if (!(FINDING_SEVERITIES as readonly string[]).includes(finding.severity)) reasons.push("unsupported severity");
  for (const [key, value] of Object.entries({
    title: finding.title,
    userImpact: finding.userImpact,
    expectedBehavior: finding.expectedBehavior,
    patchLocus: finding.patchLocus,
    proposedDirection: finding.proposedDirection,
  })) {
    if (!nonEmpty(value)) reasons.push(`${key} is required`);
  }
  if (!validList(finding.reproduction)) reasons.push("reproduction must contain executable steps");
  if (!validList(finding.acceptanceChecks)) reasons.push("acceptanceChecks must be executable");
  if (!validList(finding.regressionRisks)) reasons.push("regressionRisks must name protected behavior");
  if (!Array.isArray(finding.evidence) || finding.evidence.length === 0) {
    reasons.push("at least one evidence reference is required");
  } else {
    for (const reference of finding.evidence) {
      if (!nonEmpty(reference.artifactId) || !nonEmpty(reference.observation)) reasons.push("evidence needs artifactId and falsifiable observation");
      else if (!evidenceIds.has(reference.artifactId)) reasons.push(`unknown evidence artifact: ${reference.artifactId}`);
    }
  }
  return [...new Set(reasons)];
}

function sanitizeFinding(finding: CriticFindingInput): CriticFindingInput {
  return {
    ...finding,
    id: finding.id ? redactText(finding.id.trim()) : undefined,
    criticId: redactText(finding.criticId.trim()),
    title: redactText(finding.title.trim()),
    evidence: finding.evidence.map((item) => ({
      artifactId: redactText(item.artifactId.trim()),
      observation: redactText(item.observation.trim()),
    })),
    reproduction: finding.reproduction.map((item) => redactText(item.trim())),
    userImpact: redactText(finding.userImpact.trim()),
    expectedBehavior: redactText(finding.expectedBehavior.trim()),
    patchLocus: redactText(finding.patchLocus.trim()),
    proposedDirection: redactText(finding.proposedDirection.trim()),
    acceptanceChecks: finding.acceptanceChecks.map((item) => redactText(item.trim())),
    regressionRisks: finding.regressionRisks.map((item) => redactText(item.trim())),
  };
}

export function compileFindings(input: {
  findings: CriticFindingInput[];
  evidence: EvidenceArtifact[];
  taskFingerprint: string;
  compiledAt: string;
  maxFindings?: number;
  invokedCriticIds?: string[];
}): ImplementationBrief {
  const knownEvidence = new Set(input.evidence.map((artifact) => artifact.id));
  const rejectedFindings: RejectedFinding[] = [];
  const accepted: AtomicFinding[] = [];
  const seenFingerprints = new Set<string>();
  const seenIds = new Set<string>();

  for (const proposed of input.findings) {
    const reasons = rejectionReasons(proposed, knownEvidence);
    if (reasons.length > 0) {
      rejectedFindings.push({ criticId: proposed.criticId || "unknown", proposedId: proposed.id, reasons });
      continue;
    }
    const finding = sanitizeFinding(proposed);
    const fingerprint = contentHash({
      domain: finding.domain,
      title: finding.title.toLocaleLowerCase(),
      patchLocus: finding.patchLocus.toLocaleLowerCase(),
      expectedBehavior: finding.expectedBehavior.toLocaleLowerCase(),
      evidenceIds: finding.evidence.map((item) => item.artifactId).sort(),
    });
    if (seenFingerprints.has(fingerprint)) {
      rejectedFindings.push({ criticId: finding.criticId, proposedId: finding.id, reasons: ["duplicate atomic finding"] });
      continue;
    }
    const generatedId = `PC-${fingerprint.slice(0, 10).toUpperCase()}`;
    const id = finding.id && !seenIds.has(finding.id) ? finding.id : generatedId;
    if (seenIds.has(id)) {
      rejectedFindings.push({ criticId: finding.criticId, proposedId: finding.id, reasons: ["duplicate finding id"] });
      continue;
    }
    seenFingerprints.add(fingerprint);
    seenIds.add(id);
    const { id: _discarded, ...withoutOptionalId } = finding;
    accepted.push({
      ...withoutOptionalId,
      id,
      evidenceIds: [...new Set(finding.evidence.map((item) => item.artifactId))],
      fingerprint,
    });
  }

  accepted.sort((left, right) => {
    const severity = (SEVERITY_ORDER.get(left.severity) ?? 99) - (SEVERITY_ORDER.get(right.severity) ?? 99);
    return severity || left.id.localeCompare(right.id);
  });
  const maximum = input.maxFindings ?? 8;
  const selected = accepted.slice(0, maximum);
  for (const omitted of accepted.slice(maximum)) {
    rejectedFindings.push({ criticId: omitted.criticId, proposedId: omitted.id, reasons: ["brief finding limit exceeded"] });
  }
  if (selected.length === 0) throw new ContractError("no grounded critic finding survived compilation");
  const criticIds = [...new Set([
    ...(input.invokedCriticIds ?? []),
    ...input.findings.map((finding) => finding.criticId || "unknown"),
  ])];
  const criticProvenance = criticIds.map((criticId) => ({
    criticId: redactText(criticId),
    proposedCount: input.findings.filter((finding) => (finding.criticId || "unknown") === criticId).length,
    acceptedCount: selected.filter((finding) => finding.criticId === criticId).length,
    rejectedCount: rejectedFindings.filter((finding) => finding.criticId === criticId).length,
  })).sort((left, right) => compareCodeUnits(left.criticId, right.criticId));
  const acceptedCriticIdsDigest = contentHash([...new Set(selected.map((finding) => finding.criticId))].sort());
  const body = {
    schemaVersion: 1 as const,
    taskFingerprint: input.taskFingerprint,
    findings: selected,
    acceptanceChecks: [...new Set(selected.flatMap((finding) => finding.acceptanceChecks))],
    protectedBehaviors: [...new Set(selected.flatMap((finding) => finding.regressionRisks))],
    rejectedFindings,
    criticProvenance,
    acceptedCriticIdsDigest,
    compiledAt: input.compiledAt,
  };
  return { ...body, digest: contentHash(body) };
}
