import { readFile } from "node:fs/promises";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { expect, test } from "@playwright/test";

import { inspectCriticProvenance } from "../../benchmark/critic-provenance.mjs";
import {
  buildJudgeValidationRepair,
  inspectJudgeValidationRepair,
} from "../../benchmark/judge-validation-repair.mjs";
import {
  PROMOTION_EVIDENCE_DIR,
  REJECTION_EVIDENCE_DIR,
  REPO_ROOT as REPO,
} from "./evidence-paths.mjs";

async function validator() {
  const artifactSchema = JSON.parse(
    await readFile(join(REPO, "benchmark", "schemas", "artifact.schema.json"), "utf8")
  );
  const receiptSchema = JSON.parse(
    await readFile(join(REPO, "benchmark", "schemas", "run-receipt.schema.json"), "utf8")
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(artifactSchema);
  return ajv.compile(receiptSchema);
}

async function receipt(kind = "latest") {
  const directory = kind === "latest" ? PROMOTION_EVIDENCE_DIR : REJECTION_EVIDENCE_DIR;
  return JSON.parse(
    await readFile(join(directory, "receipt.json"), "utf8")
  );
}

test("committed promotion and rejection receipts satisfy the canonical schema", async () => {
  const validate = await validator();
  expect(validate(await receipt("latest")), JSON.stringify(validate.errors)).toBe(true);
  expect(validate(await receipt("rejection")), JSON.stringify(validate.errors)).toBe(true);
});

test("schema rejects an A/B reveal that maps both labels to one variant", async () => {
  const validate = await validator();
  const tampered = await receipt("latest");
  tampered.blindComparison.mappingReveal.B =
    tampered.blindComparison.mappingReveal.A;
  expect(validate(tampered)).toBe(false);
  expect(
    validate.errors.some(({ instancePath }) =>
      instancePath.startsWith("/blindComparison/mappingReveal")
    )
  ).toBe(true);
});

test("schema rejects missing effect metrics and zero-invocation valid judging", async () => {
  const validate = await validator();
  const missingEffectMetric = await receipt("latest");
  delete missingEffectMetric.evaluations.candidate.metrics.effectRequestCount;
  expect(validate(missingEffectMetric)).toBe(false);

  const fakeJudge = await receipt("latest");
  fakeJudge.blindComparison.invocationCount = 0;
  expect(validate(fakeJudge)).toBe(false);
});

test("schema requires sealed execution providers and enforces the model boundary", async () => {
  const validate = await validator();
  const missingExecution = await receipt("latest");
  delete missingExecution.execution;
  expect(validate(missingExecution)).toBe(false);

  const falseOfflineModelClaim = await receipt("latest");
  falseOfflineModelClaim.execution.model = "gemini-3.6-flash";
  expect(validate(falseOfflineModelClaim)).toBe(false);

  const missingProvider = await receipt("latest");
  delete missingProvider.execution.patchProvider;
  expect(validate(missingProvider)).toBe(false);
});

test("critic provenance rejects reordered IDs, inconsistent counts, duplicates, and digest tampering", async () => {
  const source = (await receipt("latest")).criticProvenance;
  expect(inspectCriticProvenance(source)).toEqual({ ok: true, errors: [] });

  const reordered = structuredClone(source);
  reordered.entries.reverse();
  expect(inspectCriticProvenance(reordered).ok).toBe(false);

  const inconsistent = structuredClone(source);
  inconsistent.entries[0].acceptedCount += 1;
  expect(inspectCriticProvenance(inconsistent).ok).toBe(false);

  const duplicate = structuredClone(source);
  duplicate.entries[1].criticId = duplicate.entries[0].criticId;
  expect(inspectCriticProvenance(duplicate).ok).toBe(false);

  const tamperedDigest = structuredClone(source);
  tamperedDigest.digest = "0".repeat(64);
  expect(inspectCriticProvenance(tamperedDigest).ok).toBe(false);
});

test("one bounded judge format repair allows exactly two calls and rejects metadata tampering", async () => {
  const validate = await validator();
  const repaired = await receipt("latest");
  repaired.blindComparison.invocationCount = 2;
  repaired.blindComparison.validationRepair = buildJudgeValidationRepair({
    mode: "format-completion",
    rejectedResponseSha256: "a".repeat(64),
    invalidFields: ["rationale"],
  });
  expect(validate(repaired), JSON.stringify(validate.errors)).toBe(true);
  expect(
    inspectJudgeValidationRepair(repaired.blindComparison.validationRepair, {
      invocationCount: 2,
      status: "valid",
    })
  ).toEqual({ ok: true, errors: [] });

  const wrongCount = structuredClone(repaired.blindComparison.validationRepair);
  expect(inspectJudgeValidationRepair(wrongCount, { invocationCount: 1, status: "valid" }).ok).toBe(false);

  const tamperedFields = structuredClone(repaired.blindComparison.validationRepair);
  tamperedFields.invalidFields.push("winner");
  expect(inspectJudgeValidationRepair(tamperedFields, { invocationCount: 2, status: "valid" }).ok).toBe(false);

  const unbounded = structuredClone(repaired);
  unbounded.blindComparison.invocationCount = 3;
  expect(validate(unbounded)).toBe(false);
});
