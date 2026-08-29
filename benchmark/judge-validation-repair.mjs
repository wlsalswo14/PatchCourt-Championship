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

const compareCodeUnits = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

export function buildJudgeValidationRepair({
  mode = "none",
  rejectedResponseSha256 = null,
  invalidFields = [],
} = {}) {
  const orderedFields = [...invalidFields].sort(compareCodeUnits);
  const payload = { mode, rejectedResponseSha256, invalidFields: orderedFields };
  return { ...payload, digest: sha256(canonicalJson(payload)) };
}

export function inspectJudgeValidationRepair(value, { invocationCount, status } = {}) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["validationRepair must be an object"] };
  }
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["digest", "invalidFields", "mode", "rejectedResponseSha256"])) {
    errors.push("validationRepair has an unexpected shape");
  }
  const repaired = value.mode === "format-completion" || value.mode === "full-rejudge";
  if (value.mode !== "none" && !repaired) errors.push("validationRepair mode is invalid");
  if (!Array.isArray(value.invalidFields) || value.invalidFields.length > 16) {
    errors.push("invalidFields must be an array with at most 16 items");
  } else {
    const fields = value.invalidFields;
    if (
      fields.some(
        (field) => typeof field !== "string" || !/^[a-z][a-zA-Z0-9._-]{0,99}$/u.test(field)
      )
    ) {
      errors.push("invalidFields contains an unsafe field path");
    }
    if (new Set(fields).size !== fields.length) errors.push("invalidFields must be unique");
    const ordered = [...fields].sort(compareCodeUnits);
    if (JSON.stringify(ordered) !== JSON.stringify(fields)) errors.push("invalidFields must be ordered");
  }
  if (!/^[a-f0-9]{64}$/u.test(String(value.digest))) errors.push("validationRepair digest must be SHA-256");
  if (value.rejectedResponseSha256 !== null && !/^[a-f0-9]{64}$/u.test(String(value.rejectedResponseSha256))) {
    errors.push("rejectedResponseSha256 must be null or SHA-256");
  }

  if (value.mode === "none") {
    if (value.rejectedResponseSha256 !== null) errors.push("no-repair mode cannot seal a rejected response");
    if (value.invalidFields?.length !== 0) errors.push("no-repair mode cannot list invalid fields");
    if (status === "invalid" && invocationCount !== 0) errors.push("pre-gate invalid comparison must invoke no judge");
    if ((status === "valid" || status === "tie") && invocationCount !== 1) {
      errors.push("valid no-repair comparison must invoke the judge exactly once");
    }
  } else if (repaired) {
    if (!/^[a-f0-9]{64}$/u.test(String(value.rejectedResponseSha256))) {
      errors.push("repair mode requires a rejected response digest");
    }
    if (!Array.isArray(value.invalidFields) || value.invalidFields.length === 0) {
      errors.push("repair mode requires at least one invalid field");
    }
    if (invocationCount !== 2) errors.push("one bounded repair must make exactly two judge calls");
    if (status !== "valid" && status !== "tie") errors.push("repair metadata requires a terminal judge verdict");
  }

  if (errors.length === 0) {
    const expected = buildJudgeValidationRepair(value);
    if (value.digest !== expected.digest) errors.push("validationRepair digest does not match its fields");
  }
  return { ok: errors.length === 0, errors };
}
