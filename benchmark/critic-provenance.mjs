import { createHash } from "node:crypto";

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

export function buildCriticProvenance(entries) {
  const ordered = entries
    .map(({ criticId, proposedCount, acceptedCount, rejectedCount }) => ({
      criticId,
      proposedCount,
      acceptedCount,
      rejectedCount,
    }))
    .sort((left, right) => (left.criticId < right.criticId ? -1 : left.criticId > right.criticId ? 1 : 0));
  const acceptedCriticIdsDigest = sha256(
    canonicalJson(ordered.filter(({ acceptedCount }) => acceptedCount > 0).map(({ criticId }) => criticId))
  );
  return {
    entries: ordered,
    acceptedCriticIdsDigest,
    digest: sha256(canonicalJson({ entries: ordered, acceptedCriticIdsDigest })),
  };
}

export function inspectCriticProvenance(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["criticProvenance must be an object"] };
  }
  const proofKeys = Object.keys(value).sort();
  if (JSON.stringify(proofKeys) !== JSON.stringify(["acceptedCriticIdsDigest", "digest", "entries"])) {
    errors.push("criticProvenance has an unexpected shape");
  }
  if (!Array.isArray(value.entries) || value.entries.length === 0) {
    return { ok: false, errors: ["criticProvenance.entries must be non-empty"] };
  }
  const ids = [];
  for (const [index, entry] of value.entries.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`entry ${index} must be an object`);
      continue;
    }
    const keys = Object.keys(entry).sort();
    if (JSON.stringify(keys) !== JSON.stringify(["acceptedCount", "criticId", "proposedCount", "rejectedCount"])) {
      errors.push(`entry ${index} has an unexpected shape`);
    }
    if (
      typeof entry.criticId !== "string" ||
      entry.criticId.trim() !== entry.criticId ||
      entry.criticId.length === 0 ||
      entry.criticId.length > 200
    ) {
      errors.push(`entry ${index} criticId is invalid`);
    } else {
      ids.push(entry.criticId);
    }
    for (const name of ["proposedCount", "acceptedCount", "rejectedCount"]) {
      if (!Number.isInteger(entry[name]) || entry[name] < 0) errors.push(`entry ${index} ${name} is invalid`);
    }
    if (
      Number.isInteger(entry.proposedCount) &&
      Number.isInteger(entry.acceptedCount) &&
      Number.isInteger(entry.rejectedCount)
    ) {
      if (entry.acceptedCount > entry.proposedCount) errors.push(`entry ${index} accepts more than proposed`);
      if (entry.acceptedCount + entry.rejectedCount !== entry.proposedCount) {
        errors.push(`entry ${index} counts do not sum to proposedCount`);
      }
    }
  }
  if (new Set(ids).size !== ids.length) errors.push("criticId values must be unique");
  const orderedIds = [...ids].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (JSON.stringify(ids) !== JSON.stringify(orderedIds)) errors.push("entries must be ordered by criticId");
  if (!/^[a-f0-9]{64}$/u.test(String(value.acceptedCriticIdsDigest))) {
    errors.push("acceptedCriticIdsDigest must be SHA-256");
  }
  if (!/^[a-f0-9]{64}$/u.test(String(value.digest))) errors.push("digest must be SHA-256");

  if (errors.length === 0) {
    const expected = buildCriticProvenance(value.entries);
    if (value.acceptedCriticIdsDigest !== expected.acceptedCriticIdsDigest) {
      errors.push("acceptedCriticIdsDigest does not match accepted critic IDs");
    }
    if (value.digest !== expected.digest) errors.push("digest does not match provenance entries");
  }
  return { ok: errors.length === 0, errors };
}
