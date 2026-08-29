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
  PROMOTION_EVIDENCE_DIR as EVIDENCE_DIR,
  REPO_ROOT as REPO,
  artifactUri,
} from "./evidence-paths.mjs";

const BASE_URL = "http://127.0.0.1:42873";
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

function evidenceCompleteness(evidence) {
  return [
    /\d+%/.test(evidence.audience) && !/TBD/i.test(evidence.audience),
    /YouTube/i.test(evidence.channel) && !/oauth|profile_id|googleapis/i.test(evidence.channel),
    /fit|align/i.test(evidence["market-fit"]) && !/==|score_rule/i.test(evidence["market-fit"]),
    /draft/i.test(evidence["next-action"])
  ].filter(Boolean).length;
}

function internalIdentifierCount(bodyText) {
  const patterns = [
    /profile_id=\d{8,}/gi,
    /googleapis\.com\/oauth/gi,
    /youtube-oauth2/gi,
    /score_rule_v\d+/gi
  ];
  return patterns.reduce((count, pattern) => count + (bodyText.match(pattern)?.length ?? 0), 0);
}

function aggregateMetrics(runs) {
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

function buildEvaluation(variant, metrics, artifactIds, manifest, taskFingerprintMatched) {
  const isOwnedLocal =
    manifest.owned === true &&
    manifest.safety.loopbackOnly === true &&
    new URL(BASE_URL).hostname === "127.0.0.1";

  const gates = [
    gate("owned_local_target", isOwnedLocal, `owned=${manifest.owned}; origin=${BASE_URL}`),
    gate(
      "same_task_fingerprint",
      taskFingerprintMatched && /^[a-f0-9]{64}$/.test(manifest.taskFingerprint),
      `authoritative manifest task=${manifest.taskFingerprint}; both viewport replays matched`
    ),
    gate("brand_demo_login", metrics.taskComplete, "Both viewports reached the signed-in journey"),
    gate("directory_search", metrics.taskComplete, "US returned John Smith at both viewports"),
    gate("profile_open", metrics.taskComplete, "John Smith profile rendered at both viewports", artifactIds),
    gate(
      "decision_evidence_complete",
      metrics.decisionEvidenceCount === metrics.decisionEvidenceTarget,
      `${metrics.decisionEvidenceCount}/${metrics.decisionEvidenceTarget} required signals were explicit`,
      artifactIds
    ),
    gate("offer_fields_editable", metrics.offerEditable, "Message and fee accepted browser edits"),
    gate(
      "draft_not_sent",
      metrics.draftOnly && metrics.effectRequestCount === 0,
      `Rendered status says draft ready and not sent; effect requests=${metrics.effectRequestCount}`,
      artifactIds
    ),
    gate(
      "no_internal_identifier_exposure",
      metrics.internalIdentifierCount === 0,
      `${metrics.internalIdentifierCount} opaque provider/debug patterns rendered`,
      artifactIds
    ),
    gate(
      "accessible_primary_controls",
      metrics.accessiblePrimaryControls,
      "Role/name and label locators resolved for every primary control"
    ),
    gate(
      "responsive_primary_action",
      metrics.horizontalOverflowPixels === 0,
      `maximum document overflow=${metrics.horizontalOverflowPixels}px`,
      artifactIds
    ),
    gate(
      "console_and_network_clean",
      metrics.consoleErrorCount === 0 && metrics.externalRequestCount === 0,
      `console errors=${metrics.consoleErrorCount}; cross-origin requests=${metrics.externalRequestCount}`
    ),
    gate("artifact_integrity", true, "Artifact bytes were hashed immediately after capture", artifactIds)
  ];

  return { variant, score: scoreMetrics(metrics), metrics, gates };
}

async function runJourney(browser, variant, viewportName, capturedAt, expectedTaskFingerprint) {
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
    const requestUrl = new URL(request.url());
    requests.push({ method: request.method(), origin: requestUrl.origin, path: requestUrl.pathname });
  });

  await page.goto(`${BASE_URL}/${variant}`, { waitUntil: "networkidle" });
  await expect(page).toHaveTitle("Creator Match — PatchCourt owned demo");
  await expect(page.locator("main")).toContainText("Find the creator");
  await expect(page.locator("body")).not.toContainText(/Application error|Vite error|Next\.js/i);
  const armManifest = await page.evaluate(async () =>
    fetch("/__patchcourt/manifest.json").then((response) => response.json())
  );
  expect(armManifest.taskFingerprint).toBe(expectedTaskFingerprint);

  const login = page.getByRole("button", { name: "Continue as brand demo" });
  await expect(login).toBeVisible();
  await login.click();
  await expect(page.getByRole("heading", { name: /Good evening/ })).toBeVisible();

  const directory = page.getByRole("button", { name: "Open Creator Directory" });
  await expect(directory).toBeVisible();
  await directory.click();
  const search = page.getByLabel("Market or creator");
  await expect(search).toBeVisible();
  await search.fill("US");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("creator-result")).toContainText("John Smith");

  if (variant === "incumbent") {
    await expect(page.getByTestId("followers")).toHaveText("0 followers");
  } else {
    await expect(page.getByTestId("followers")).toHaveText("248K followers");
  }
  const followersText = await page.getByTestId("followers").innerText();

  await page.getByRole("button", { name: "Open John Smith profile" }).click();
  await expect(page.getByRole("heading", { name: "John Smith", exact: true })).toBeVisible();

  const evidence = await page.locator("[data-evidence-key]").evaluateAll((cards) =>
    Object.fromEntries(
      cards.map((card) => [card.getAttribute("data-evidence-key"), card.textContent.trim()])
    )
  );
  const bodyText = await page.locator("body").innerText();

  if (variant === "incumbent") {
    await expect(page.getByTestId("provider-debug")).toContainText("profile_id=");
    expect(evidence.audience).toContain("TBD");
  } else {
    await expect(page.getByTestId("provider-debug")).toHaveCount(0);
    expect(evidenceCompleteness(evidence)).toBe(4);
  }

  const artifacts = [];
  const profileScreenshotId = `${variant}-${viewportName}-profile`;
  artifacts.push(
    await writeArtifact({
      id: profileScreenshotId,
      kind: "screenshot",
      label: `${variant} ${viewportName} profile evidence`,
      stepId: "inspect",
      variant,
      body: await page.screenshot({ fullPage: true }),
      extension: "png",
      capturedAt
    })
  );
  const offerButton = page.getByRole("button", { name: "Review offer draft" });
  await expect(offerButton).toBeVisible();
  await offerButton.click();
  const message = page.getByLabel("Message");
  const amount = page.getByLabel("Fee (USD)");
  const originalMessage = await message.inputValue();
  await message.fill(`${originalMessage} Demo review.`);
  await amount.fill("1500");
  const offerEditable =
    (await message.inputValue()).endsWith("Demo review.") &&
    (await amount.inputValue()) === "1500";
  await page.getByRole("button", { name: "Prepare draft — do not send" }).click();
  const draftStatus = page.getByTestId("draft-status");
  await expect(draftStatus).toContainText("Draft ready — not sent");
  await expect(draftStatus).toContainText("1500");
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid")))
    .toBe("draft-status");
  const focusSnapshot = await page.evaluate(() => {
    const skip = document.querySelector(".skip-link");
    const rect = skip.getBoundingClientRect();
    return {
      activeTestId: document.activeElement?.getAttribute("data-testid") ?? null,
      skipLinkFocused: document.activeElement === skip,
      skipLinkTop: rect.top,
      skipLinkBottom: rect.bottom
    };
  });
  expect(focusSnapshot.skipLinkFocused).toBe(false);
  expect(focusSnapshot.skipLinkBottom).toBeLessThanOrEqual(0);
  const primaryActionSnapshot = await page.evaluate(() => {
    const button = document.querySelector("[data-testid='prepare-offer']").getBoundingClientRect();
    const textarea = document.querySelector("[data-testid='offer-message']").getBoundingClientRect();
    return {
      width: button.width,
      height: button.height,
      peerControlWidth: textarea.width
    };
  });
  if (variant === "candidate" && viewportName === "mobile") {
    expect(primaryActionSnapshot.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(primaryActionSnapshot.width - primaryActionSnapshot.peerControlWidth)).toBeLessThanOrEqual(1);
  }

  const horizontalOverflowPixels = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - window.innerWidth)
  );
  const accessiblePrimaryControls =
    (await page.getByRole("button", { name: "Creator Match home" }).count()) === 1 &&
    (await page.getByLabel("Message").count()) === 1 &&
    (await page.getByLabel("Fee (USD)").count()) === 1 &&
    (await page.getByRole("button", { name: "Prepare draft — do not send" }).count()) === 1;
  const externalRequests = requests.filter(({ origin }) => origin !== BASE_URL);
  const effectRequests = requests.filter(({ method }) => !["GET", "HEAD"].includes(method));
  const draftOnly =
    (await draftStatus.innerText()).toLowerCase().includes("not sent") &&
    effectRequests.length === 0;

  artifacts.push(
    await writeArtifact({
      id: `${variant}-${viewportName}-accessibility`,
      kind: "accessibility",
      label: `${variant} ${viewportName} accessible-name and responsive snapshot`,
      stepId: "confirm",
      variant,
      body: `${JSON.stringify({
        primaryControls: {
          home: "Creator Match home",
          offerMessage: "Message",
          offerAmount: "Fee (USD)",
          prepareDraft: "Prepare draft — do not send"
        },
        allResolved: accessiblePrimaryControls,
        focusAfterPrepare: focusSnapshot,
        primaryAction: primaryActionSnapshot,
        viewport,
        horizontalOverflowPixels
      }, null, 2)}\n`,
      extension: "json",
      capturedAt
    })
  );

  const draftScreenshotId = `${variant}-${viewportName}-draft`;
  artifacts.push(
    await writeArtifact({
      id: draftScreenshotId,
      kind: "screenshot",
      label: `${variant} ${viewportName} unsent offer draft`,
      stepId: "confirm",
      variant,
      body: await page.screenshot({ fullPage: true }),
      extension: "png",
      capturedAt
    })
  );

  const domSummary = {
    page: `/${variant}`,
    viewport,
    creator: "John Smith",
    search: "US",
    followers: followersText,
    evidence,
    providerDebugVisible: (await page.getByTestId("provider-debug").count()) > 0,
    draftStatus: await draftStatus.innerText(),
    horizontalOverflowPixels
  };
  artifacts.push(
    await writeArtifact({
      id: `${variant}-${viewportName}-dom`,
      kind: "dom",
      label: `${variant} ${viewportName} sanitized DOM summary`,
      stepId: "confirm",
      variant,
      body: `${JSON.stringify(domSummary, null, 2)}\n`,
      extension: "json",
      capturedAt
    })
  );
  artifacts.push(
    await writeArtifact({
      id: `${variant}-${viewportName}-console`,
      kind: "console",
      label: `${variant} ${viewportName} console observations`,
      stepId: "confirm",
      variant,
      body: `${JSON.stringify({ consoleEntries, pageErrors }, null, 2)}\n`,
      extension: "json",
      capturedAt
    })
  );
  artifacts.push(
    await writeArtifact({
      id: `${variant}-${viewportName}-network`,
      kind: "network",
      label: `${variant} ${viewportName} origin and method observations`,
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
    taskComplete: true,
    decisionEvidenceCount: evidenceCompleteness(evidence),
    internalIdentifierCount: internalIdentifierCount(bodyText),
    externalRequestCount: externalRequests.length,
    effectRequestCount: effectRequests.length,
    accessiblePrimaryControls,
    horizontalOverflowPixels,
    consoleErrorCount:
      consoleEntries.filter(({ type }) => type === "error").length + pageErrors.length,
    offerEditable,
    draftOnly,
    observedTaskFingerprint: armManifest.taskFingerprint
  };
}

async function validateReceiptSchema(receipt) {
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
    throw new Error(`Receipt schema failed:\n${JSON.stringify(validate.errors, null, 2)}`);
  }
}

test("PC01 exact replay proves an outcome improvement and emits a valid receipt", async ({ browser, request }) => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const capturedAt = new Date().toISOString();
  const manifestResponse = await request.get(`${BASE_URL}/__patchcourt/manifest.json`);
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest.owned).toBe(true);
  expect(manifest.safety.loopbackOnly).toBe(true);
  expect(manifest.taskFingerprint).toBe(sha256(canonicalJson(manifest.task)));
  const factsResponse = await request.get(`${BASE_URL}${manifest.facts.path}`);
  expect(factsResponse.ok()).toBeTruthy();
  const factsBytes = await factsResponse.body();
  expect(sha256(factsBytes)).toBe(manifest.facts.digest);
  const factsPacket = JSON.parse(factsBytes.toString("utf8"));
  expect(factsPacket.provenance).toEqual({
    synthetic: true,
    owned: true,
    private: false
  });
  expect(factsPacket.facts.map(({ field }) => field)).toEqual(manifest.facts.fields);
  expect(factsBytes.toString("utf8")).not.toMatch(
    /https?:\/\/|profile_id|oauth|token|cookie|secret|credential|email|phone/i
  );

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

  const runs = [];
  for (const variant of ["incumbent", "candidate"]) {
    for (const viewportName of ["desktop", "mobile"]) {
      runs.push(
        await runJourney(
          browser,
          variant,
          viewportName,
          capturedAt,
          manifest.taskFingerprint
        )
      );
    }
  }

  const manifestAfterResponse = await request.get(`${BASE_URL}/__patchcourt/manifest.json`);
  expect(manifestAfterResponse.ok()).toBeTruthy();
  const manifestAfter = await manifestAfterResponse.json();
  expect({
    taskFingerprint: manifestAfter.taskFingerprint,
    sourceSnapshotDigest: manifestAfter.sourceSnapshotDigest,
    candidateSnapshotDigest: manifestAfter.candidateSnapshotDigest,
    patchDigest: manifestAfter.patchDigest,
    factsDigest: manifestAfter.facts.digest
  }).toEqual({
    taskFingerprint: manifest.taskFingerprint,
    sourceSnapshotDigest: manifest.sourceSnapshotDigest,
    candidateSnapshotDigest: manifest.candidateSnapshotDigest,
    patchDigest: manifest.patchDigest,
    factsDigest: manifest.facts.digest
  });

  const artifacts = runs.flatMap((run) => run.artifacts);
  const incumbentMetrics = aggregateMetrics(runs.filter((run) => run.variant === "incumbent"));
  const candidateMetrics = aggregateMetrics(runs.filter((run) => run.variant === "candidate"));

  expect(incumbentMetrics.internalIdentifierCount).toBeGreaterThan(0);
  expect(incumbentMetrics.decisionEvidenceCount).toBeLessThan(4);
  expect(incumbentMetrics.horizontalOverflowPixels).toBeGreaterThan(0);
  expect(candidateMetrics.internalIdentifierCount).toBe(0);
  expect(candidateMetrics.decisionEvidenceCount).toBe(4);
  expect(candidateMetrics.horizontalOverflowPixels).toBe(0);

  const incumbent = buildEvaluation(
    "incumbent",
    incumbentMetrics,
    artifacts.filter(({ variant }) => variant === "incumbent").map(({ id }) => id),
    manifest,
    runs
      .filter((run) => run.variant === "incumbent")
      .every((run) => run.observedTaskFingerprint === manifest.taskFingerprint)
  );
  const candidate = buildEvaluation(
    "candidate",
    candidateMetrics,
    artifacts.filter(({ variant }) => variant === "candidate").map(({ id }) => id),
    manifest,
    runs
      .filter((run) => run.variant === "candidate")
      .every((run) => run.observedTaskFingerprint === manifest.taskFingerprint)
  );

  // The anonymous comparator is never opened until the candidate has passed
  // every deterministic critical gate. A failed gate remains a rejection
  // receipt rather than consuming or laundering judge evidence.
  expect(candidateReadyForBlindJudge(candidate)).toBe(true);

  const anonymousArms = {
    A: mappingReveal.A === "candidate" ? candidate : incumbent,
    B: mappingReveal.B === "candidate" ? candidate : incumbent
  };
  const winnerLabel = anonymousArms.A.score > anonymousArms.B.score ? "A" :
    anonymousArms.B.score > anonymousArms.A.score ? "B" : null;
  const blindStatus = winnerLabel ? "valid" : "tie";
  const revealedWinner = winnerLabel ? mappingReveal[winnerLabel] : "tie";
  const blindComparison = {
    protocolVersion: 1,
    orderCommitmentSha256,
    status: blindStatus,
    winnerLabel,
    revealedWinner,
    mappingReveal,
    judge: {
      kind: "deterministic",
      provider: "patchcourt-local",
      model: "observable-outcome-comparator-v1",
      responseId: sha256(
        canonicalJson({
          A: { score: anonymousArms.A.score, gates: anonymousArms.A.gates.map(({ id, passed }) => ({ id, passed })) },
          B: { score: anonymousArms.B.score, gates: anonymousArms.B.gates.map(({ id, passed }) => ({ id, passed })) }
        })
      ),
      reasoningEffort: null
    },
    validationRepair: buildJudgeValidationRepair(),
    invocationCount: 1,
    invalidReason: null,
    evaluatedAt: capturedAt
  };
  const comparison = decidePromotion(incumbent, candidate, blindComparison);
  expect(comparison.decision).toBe("promote");

  const stamp = capturedAt.replace(/[-:.TZ]/g, "").slice(0, 14);
  const receiptWithoutIntegrity = {
    schemaVersion: 1,
    receiptId: `receipt-pc01-${stamp}`,
    runId: `pc01-${stamp}`,
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
      candidateSha256: manifest.candidateSnapshotDigest,
      patchSha256: manifest.patchDigest,
      factsSha256: manifest.facts.digest
    },
    execution: {
      mode: "offline-demo",
      criticProvider: "patchcourt:browser-metrics-v1",
      patchProvider: "patchcourt:owned-fixture-reference-candidate-v1",
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
    lineage: { previousReceiptSha256: null }
  };
  const receipt = {
    ...receiptWithoutIntegrity,
    integrity: {
      algorithm: "sha256-canonical-json-v1",
      payloadSha256: sha256(canonicalJson(receiptWithoutIntegrity))
    }
  };

  await validateReceiptSchema(receipt);
  await writeFile(join(EVIDENCE_DIR, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(
    join(EVIDENCE_DIR, "SUMMARY.md"),
    `# PC01 browser evidence\n\n` +
      `- Run: \`${receipt.runId}\`\n` +
      `- Task fingerprint: \`${receipt.taskFingerprint}\`\n` +
      `- Incumbent: **${incumbent.score}/100**\n` +
      `- Candidate: **${candidate.score}/100**\n` +
      `- Decision-evidence lift: **+${comparison.decisionEvidenceDelta}/4**\n` +
      `- External/effect requests: **${candidate.metrics.externalRequestCount}/${candidate.metrics.effectRequestCount}**\n` +
      `- Synthetic facts digest: \`${manifest.facts.digest}\`\n` +
      `- Execution: **${receipt.execution.mode}** (${receipt.execution.criticProvider}; ${receipt.execution.patchProvider}; ${receipt.execution.judgeProvider})\n` +
      `- Critic provenance: **${receipt.criticProvenance.entries.length} critics**, digest \`${receipt.criticProvenance.digest}\`\n` +
      `- Decision: **${comparison.decision.toUpperCase()}**\n` +
      `- Blind comparator: ${blindComparison.judge.provider}/${blindComparison.judge.model} (${blindComparison.status}, ${blindComparison.invocationCount} invocation)\n\n` +
      `The incumbent's seeded raw provider material, incomplete decision evidence, and mobile overflow were reproduced in the browser. The candidate completed the identical task at both viewports with all critical gates passing. See \`receipt.json\` for artifact hashes and gate observations.\n`
  );
});
