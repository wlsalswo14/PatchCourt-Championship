import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { expect, test } from "@playwright/test";

import {
  candidateReadyForBlindJudge,
  decidePromotion,
  scoreMetrics
} from "../../benchmark/promotion-policy.mjs";
import { buildCriticProvenance } from "../../benchmark/critic-provenance.mjs";
import { buildJudgeValidationRepair } from "../../benchmark/judge-validation-repair.mjs";
import {
  PROMOTION_EVIDENCE_DIR,
  REJECTION_EVIDENCE_DIR as EVIDENCE_DIR,
  REPO_ROOT as REPO,
  artifactUri,
} from "./evidence-paths.mjs";

const BASE_URL = "http://127.0.0.1:42873";
const REJECTION_PATCH = join(
  REPO,
  "demo",
  "brand-match",
  "patches",
  "rejected-mobile-overflow.css"
);
const VIEWPORTS = {
  desktop: { width: 1280, height: 720 },
  mobile: { width: 390, height: 844 }
};

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

async function writeArtifact({ id, kind, label, stepId, variant, body, extension, capturedAt }) {
  const path = join(EVIDENCE_DIR, `${id}.${extension}`);
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  await writeFile(path, bytes);
  return {
    id,
    kind,
    label,
    uri: artifactUri(path, id),
    sha256: sha256(bytes),
    stepId,
    variant,
    capturedAt
  };
}

function evidenceCount(evidence) {
  return [
    /\d+%/.test(evidence.audience) && !/TBD/i.test(evidence.audience),
    /YouTube/i.test(evidence.channel) && !/oauth|profile_id|googleapis/i.test(evidence.channel),
    /fit|align/i.test(evidence["market-fit"]) && !/==|score_rule/i.test(evidence["market-fit"]),
    /draft/i.test(evidence["next-action"])
  ].filter(Boolean).length;
}

function internalIdentifierCount(bodyText) {
  return [
    /profile_id=\d{8,}/gi,
    /googleapis\.com\/oauth/gi,
    /youtube-oauth2/gi,
    /score_rule_v\d+/gi
  ].reduce((count, pattern) => count + (bodyText.match(pattern)?.length ?? 0), 0);
}

async function runArm(browser, variant, viewportName, capturedAt, fingerprint) {
  const viewport = VIEWPORTS[viewportName];
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const consoleEntries = [];
  const pageErrors = [];
  const requests = [];

  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleEntries.push({ type: message.type(), text: message.text() });
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    requests.push({ method: request.method(), origin: url.origin, path: url.pathname });
  });

  await page.goto(`${BASE_URL}/${variant}`, { waitUntil: "networkidle" });
  const armManifest = await page.evaluate(async () =>
    fetch("/__patchcourt/manifest.json").then((response) => response.json())
  );
  expect(armManifest.taskFingerprint).toBe(fingerprint);
  if (variant === "candidate" && viewportName === "mobile") {
    // This is the isolated, deliberately bad candidate mutation. It affects
    // layout only; no request or product side effect is added.
    await page.addStyleTag({
      url: `${BASE_URL}/__patchcourt/rejected-mobile-overflow.css`
    });
  }

  await page.getByTestId("demo-login").click();
  await expect(page.getByTestId("home-heading")).toBeVisible();
  await page.getByTestId("open-directory").click();
  await page.getByTestId("creator-search").fill("US");
  await page.getByTestId("search-submit").click();
  await expect(page.getByTestId("creator-result")).toContainText("John Smith");
  await page.getByTestId("open-john-smith").click();
  await expect(page.getByTestId("profile-heading")).toHaveText("John Smith");

  const evidence = await page.locator("[data-evidence-key]").evaluateAll((cards) =>
    Object.fromEntries(
      cards.map((card) => [card.getAttribute("data-evidence-key"), card.textContent.trim()])
    )
  );
  const bodyText = await page.locator("body").innerText();

  const artifacts = [];
  artifacts.push(
    await writeArtifact({
      id: `rejection-${variant}-${viewportName}-profile`,
      kind: "screenshot",
      label: `rejection run ${variant} ${viewportName} profile`,
      stepId: "inspect",
      variant,
      body: await page.screenshot({ fullPage: true }),
      extension: "png",
      capturedAt
    })
  );

  await page.getByTestId("open-offer").click();
  const message = page.getByTestId("offer-message");
  const amount = page.getByTestId("offer-amount");
  await message.fill(`${await message.inputValue()} Rejection replay.`);
  await amount.fill("1500");
  const offerEditable =
    (await message.inputValue()).endsWith("Rejection replay.") &&
    (await amount.inputValue()) === "1500";
  await page.getByTestId("prepare-offer").click();
  const draftStatus = page.getByTestId("draft-status");
  await expect(draftStatus).toContainText("Draft ready — not sent");

  const horizontalOverflowPixels = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - window.innerWidth)
  );
  const externalRequests = requests.filter(({ origin }) => origin !== BASE_URL);
  const effectRequests = requests.filter(({ method }) => !["GET", "HEAD"].includes(method));
  const draftOnly =
    (await draftStatus.innerText()).toLowerCase().includes("not sent") &&
    effectRequests.length === 0;
  const accessiblePrimaryControls =
    (await page.getByRole("button", { name: "Creator Match home" }).count()) === 1 &&
    (await page.getByLabel("Message").count()) === 1 &&
    (await page.getByLabel("Fee (USD)").count()) === 1;

  artifacts.push(
    await writeArtifact({
      id: `rejection-${variant}-${viewportName}-draft`,
      kind: "screenshot",
      label: `rejection run ${variant} ${viewportName} draft and responsive gate`,
      stepId: "confirm",
      variant,
      body: await page.screenshot({ fullPage: true }),
      extension: "png",
      capturedAt
    })
  );
  artifacts.push(
    await writeArtifact({
      id: `rejection-${variant}-${viewportName}-dom`,
      kind: "dom",
      label: `rejection run ${variant} ${viewportName} sanitized DOM metrics`,
      stepId: "confirm",
      variant,
      body: `${JSON.stringify({
        evidence,
        draftStatus: await draftStatus.innerText(),
        horizontalOverflowPixels,
        rejectionPatchApplied: variant === "candidate" && viewportName === "mobile"
      }, null, 2)}\n`,
      extension: "json",
      capturedAt
    })
  );
  artifacts.push(
    await writeArtifact({
      id: `rejection-${variant}-${viewportName}-accessibility`,
      kind: "accessibility",
      label: `rejection run ${variant} ${viewportName} accessibility and overflow snapshot`,
      stepId: "confirm",
      variant,
      body: `${JSON.stringify({
        accessiblePrimaryControls,
        horizontalOverflowPixels,
        viewport
      }, null, 2)}\n`,
      extension: "json",
      capturedAt
    })
  );
  artifacts.push(
    await writeArtifact({
      id: `rejection-${variant}-${viewportName}-console`,
      kind: "console",
      label: `rejection run ${variant} ${viewportName} console observations`,
      stepId: "confirm",
      variant,
      body: `${JSON.stringify({ consoleEntries, pageErrors }, null, 2)}\n`,
      extension: "json",
      capturedAt
    })
  );
  artifacts.push(
    await writeArtifact({
      id: `rejection-${variant}-${viewportName}-network`,
      kind: "network",
      label: `rejection run ${variant} ${viewportName} network and effect observations`,
      stepId: "confirm",
      variant,
      body: `${JSON.stringify({ requests, externalRequests, effectRequests }, null, 2)}\n`,
      extension: "json",
      capturedAt
    })
  );

  await context.close();
  return {
    variant,
    viewportName,
    artifacts,
    observedTaskFingerprint: armManifest.taskFingerprint,
    taskComplete: true,
    decisionEvidenceCount: evidenceCount(evidence),
    internalIdentifierCount: internalIdentifierCount(bodyText),
    externalRequestCount: externalRequests.length,
    effectRequestCount: effectRequests.length,
    accessiblePrimaryControls,
    horizontalOverflowPixels,
    consoleErrorCount:
      consoleEntries.filter(({ type }) => type === "error").length + pageErrors.length,
    offerEditable,
    draftOnly
  };
}

function aggregate(runs) {
  return {
    taskComplete: runs.every((run) => run.taskComplete),
    decisionEvidenceCount: Math.min(...runs.map((run) => run.decisionEvidenceCount)),
    decisionEvidenceTarget: 4,
    internalIdentifierCount: Math.max(...runs.map((run) => run.internalIdentifierCount)),
    externalRequestCount: runs.reduce((sum, run) => sum + run.externalRequestCount, 0),
    effectRequestCount: runs.reduce((sum, run) => sum + run.effectRequestCount, 0),
    accessiblePrimaryControls: runs.every((run) => run.accessiblePrimaryControls),
    horizontalOverflowPixels: Math.max(...runs.map((run) => run.horizontalOverflowPixels)),
    consoleErrorCount: runs.reduce((sum, run) => sum + run.consoleErrorCount, 0),
    offerEditable: runs.every((run) => run.offerEditable),
    draftOnly: runs.every((run) => run.draftOnly)
  };
}

function gate(id, passed, observation, artifactIds = []) {
  return { id, critical: true, passed, observation, artifactIds };
}

function evaluation(variant, metrics, manifest, runs, artifactIds) {
  const taskMatched = runs.every(
    (run) => run.observedTaskFingerprint === manifest.taskFingerprint
  );
  return {
    variant,
    score: scoreMetrics(metrics),
    metrics,
    gates: [
      gate("owned_local_target", manifest.owned === true && manifest.safety.loopbackOnly === true, BASE_URL),
      gate("same_task_fingerprint", taskMatched, manifest.taskFingerprint),
      gate("brand_demo_login", metrics.taskComplete, "Signed-in home reached"),
      gate("directory_search", metrics.taskComplete, "US returned John Smith"),
      gate("profile_open", metrics.taskComplete, "John Smith profile opened", artifactIds),
      gate("decision_evidence_complete", metrics.decisionEvidenceCount === 4, `${metrics.decisionEvidenceCount}/4 signals`, artifactIds),
      gate("offer_fields_editable", metrics.offerEditable, "Message and fee accepted edits"),
      gate("draft_not_sent", metrics.draftOnly && metrics.effectRequestCount === 0, `effect requests=${metrics.effectRequestCount}`, artifactIds),
      gate("no_internal_identifier_exposure", metrics.internalIdentifierCount === 0, `internal patterns=${metrics.internalIdentifierCount}`, artifactIds),
      gate("accessible_primary_controls", metrics.accessiblePrimaryControls, "Primary control names resolved"),
      gate("responsive_primary_action", metrics.horizontalOverflowPixels === 0, `maximum overflow=${metrics.horizontalOverflowPixels}px`, artifactIds),
      gate("console_and_network_clean", metrics.consoleErrorCount === 0 && metrics.externalRequestCount === 0, `console=${metrics.consoleErrorCount}; external=${metrics.externalRequestCount}`),
      gate("artifact_integrity", true, "Artifacts hashed after capture", artifactIds)
    ]
  };
}

async function validateReceipt(receipt) {
  const artifactSchema = JSON.parse(
    await readFile(join(REPO, "benchmark", "schemas", "artifact.schema.json"), "utf8")
  );
  const receiptSchema = JSON.parse(
    await readFile(join(REPO, "benchmark", "schemas", "run-receipt.schema.json"), "utf8")
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(artifactSchema);
  const validate = ajv.compile(receiptSchema);
  if (!validate(receipt)) {
    throw new Error(`Rejection receipt schema failed:\n${JSON.stringify(validate.errors, null, 2)}`);
  }
}

test("a visually plausible candidate with one mobile overflow is cleanly rejected before blind judging", async ({ browser, request }) => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const capturedAt = new Date().toISOString();
  const manifestResponse = await request.get(`${BASE_URL}/__patchcourt/manifest.json`);
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest.taskFingerprint).toBe(sha256(canonicalJson(manifest.task)));
  const factsResponse = await request.get(`${BASE_URL}${manifest.facts.path}`);
  expect(factsResponse.ok()).toBeTruthy();
  const factsBytes = await factsResponse.body();
  expect(sha256(factsBytes)).toBe(manifest.facts.digest);
  const rejectionCss = await readFile(REJECTION_PATCH, "utf8");
  const rejectionPatchSha256 = sha256(rejectionCss);

  const runs = [];
  for (const variant of ["incumbent", "candidate"]) {
    for (const viewportName of ["desktop", "mobile"]) {
      runs.push(
        await runArm(
          browser,
          variant,
          viewportName,
          capturedAt,
          manifest.taskFingerprint
        )
      );
    }
  }

  const artifacts = runs.flatMap((run) => run.artifacts);
  const incumbentRuns = runs.filter((run) => run.variant === "incumbent");
  const candidateRuns = runs.filter((run) => run.variant === "candidate");
  const incumbentMetrics = aggregate(incumbentRuns);
  const candidateMetrics = aggregate(candidateRuns);
  expect(candidateMetrics.decisionEvidenceCount).toBe(4);
  expect(candidateMetrics.internalIdentifierCount).toBe(0);
  expect(candidateMetrics.effectRequestCount).toBe(0);
  expect(candidateMetrics.horizontalOverflowPixels).toBeGreaterThan(0);

  const incumbent = evaluation(
    "incumbent",
    incumbentMetrics,
    manifest,
    incumbentRuns,
    artifacts.filter(({ variant }) => variant === "incumbent").map(({ id }) => id)
  );
  const candidate = evaluation(
    "candidate",
    candidateMetrics,
    manifest,
    candidateRuns,
    artifacts.filter(({ variant }) => variant === "candidate").map(({ id }) => id)
  );

  const responsiveGate = candidate.gates.find(
    ({ id }) => id === "responsive_primary_action"
  );
  expect(responsiveGate.passed).toBe(false);
  expect(candidateReadyForBlindJudge(candidate)).toBe(false);

  // Order is still committed so the rejected attempt remains auditable, but
  // no blind comparator is opened after the deterministic gate failure.
  const nonce = randomBytes(18).toString("base64url");
  const candidateIsA = randomBytes(1)[0] % 2 === 0;
  const mappingReveal = candidateIsA
    ? { A: "candidate", B: "incumbent", nonce }
    : { A: "incumbent", B: "candidate", nonce };
  const orderCommitmentSha256 = sha256(
    canonicalJson({
      mapping: { A: mappingReveal.A, B: mappingReveal.B },
      nonce,
      taskFingerprint: manifest.taskFingerprint
    })
  );
  let comparatorInvocationCount = 0;
  if (candidateReadyForBlindJudge(candidate)) comparatorInvocationCount += 1;
  expect(comparatorInvocationCount).toBe(0);

  const blindComparison = {
    protocolVersion: 1,
    orderCommitmentSha256,
    status: "invalid",
    winnerLabel: null,
    revealedWinner: "invalid",
    mappingReveal,
    judge: {
      kind: "deterministic",
      provider: "patchcourt-local",
      model: "not-called-critical-gate-v1",
      responseId: null,
      reasoningEffort: null
    },
    validationRepair: buildJudgeValidationRepair(),
    invocationCount: comparatorInvocationCount,
    invalidReason: "not_called:critical_gate_failed:responsive_primary_action",
    evaluatedAt: capturedAt
  };
  const comparison = decidePromotion(incumbent, candidate, blindComparison);
  expect(comparison.scoreDelta).toBeGreaterThan(0);
  expect(comparison.decision).toBe("reject");
  expect(comparison.reasons).toContain(
    "critical_gate_failed:responsive_primary_action"
  );

  const previousReceiptBytes = await readFile(
    join(PROMOTION_EVIDENCE_DIR, "receipt.json")
  );
  const stamp = capturedAt.replace(/[-:.TZ]/g, "").slice(0, 14);
  const rejectionCandidateSha256 = sha256(
    `${manifest.candidateSnapshotDigest}\0${rejectionPatchSha256}`
  );
  const withoutIntegrity = {
    schemaVersion: 1,
    receiptId: `receipt-pc01-rejection-${stamp}`,
    runId: `pc01-rejection-${stamp}`,
    benchmarkId: "PC01",
    appId: manifest.appId,
    taskFingerprint: manifest.taskFingerprint,
    createdAt: capturedAt,
    target: {
      origin: BASE_URL,
      owned: true,
      loopbackOnly: true,
      externalRequestsBlocked: true
    },
    source: {
      incumbentSha256: manifest.sourceSnapshotDigest,
      candidateSha256: rejectionCandidateSha256,
      patchSha256: rejectionPatchSha256,
      factsSha256: manifest.facts.digest
    },
    execution: {
      mode: "offline-demo",
      criticProvider: "patchcourt:browser-metrics-v1",
      patchProvider: "patchcourt:owned-fixture-rejection-css-v1",
      judgeProvider: "patchcourt:deterministic-blind-scorecard-v1",
      model: null
    },
    criticProvenance: buildCriticProvenance([
      { criticId: "patchcourt:browser-decision-evidence-critic-v1", proposedCount: 1, acceptedCount: 1, rejectedCount: 0 },
      { criticId: "patchcourt:browser-privacy-critic-v1", proposedCount: 1, acceptedCount: 1, rejectedCount: 0 },
      { criticId: "patchcourt:browser-responsive-critic-v1", proposedCount: 1, acceptedCount: 1, rejectedCount: 0 }
    ]),
    artifacts,
    evaluations: { incumbent, candidate },
    blindComparison,
    comparison,
    lineage: { previousReceiptSha256: sha256(previousReceiptBytes) }
  };
  const receipt = {
    ...withoutIntegrity,
    integrity: {
      algorithm: "sha256-canonical-json-v1",
      payloadSha256: sha256(canonicalJson(withoutIntegrity))
    }
  };

  await validateReceipt(receipt);
  await writeFile(
    join(EVIDENCE_DIR, "receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`
  );
  await writeFile(
    join(EVIDENCE_DIR, "SUMMARY.md"),
    `# PC01 clean rejection evidence\n\n` +
      `- Run: \`${receipt.runId}\`\n` +
      `- Candidate score: **${candidate.score}/100** (incumbent ${incumbent.score}/100)\n` +
      `- Broken critical gate: **responsive_primary_action** (${candidate.metrics.horizontalOverflowPixels}px)\n` +
      `- External requests: **${candidate.metrics.externalRequestCount}**\n` +
      `- Effect requests: **${candidate.metrics.effectRequestCount}**\n` +
      `- Synthetic facts digest: \`${manifest.facts.digest}\`\n` +
      `- Execution: **${receipt.execution.mode}** (${receipt.execution.criticProvider}; ${receipt.execution.patchProvider}; ${receipt.execution.judgeProvider})\n` +
      `- Critic provenance: **${receipt.criticProvenance.entries.length} critics**, digest \`${receipt.criticProvenance.digest}\`\n` +
      `- Blind comparator invocations: **${blindComparison.invocationCount}**\n` +
      `- Decision: **REJECT — incumbent retained**\n\n` +
      `The isolated candidate remained decision-useful and completed the task, but a local CSS mutation overflowed the 390×844 primary action. Deterministic gates stopped evaluation before anonymous judging; no external effect was attempted.\n`
  );
});
