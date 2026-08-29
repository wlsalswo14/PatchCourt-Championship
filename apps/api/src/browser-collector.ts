import { chromium, type Browser, type Page } from "playwright";

import {
  ContractError,
  redactText,
  sha256,
  type EvidenceArtifact,
  type EvidenceCollector,
  type JourneyEvidence,
  type JourneyStep,
  type ObservationContext,
} from "@patchcourt/core";

import { ArtifactStore } from "./artifact-store.js";
import { ManifestClient, type DemoManifest, type ManifestAction } from "./manifest.js";

interface ViewportMetrics {
  taskComplete: boolean;
  decisionEvidenceCount: number;
  internalIdentifierCount: number;
  externalRequestCount: number;
  effectRequestCount: number;
  accessiblePrimaryControls: boolean;
  horizontalOverflowPixels: number;
  consoleErrorCount: number;
  offerEditable: boolean;
  draftOnly: boolean;
  responsivePrimaryAction: boolean;
}

async function executeAction(page: Page, action: ManifestAction): Promise<void> {
  const locator = page.locator(action.selector).first();
  if (action.kind === "click") {
    await locator.click({ timeout: 5_000 });
    return;
  }
  if (action.kind === "fill") {
    await locator.fill(action.value ?? "", { timeout: 5_000 });
    return;
  }
  if (action.kind === "assertVisible") {
    if (!(await locator.isVisible({ timeout: 5_000 }))) throw new ContractError(`expected visible fixture control: ${action.selector}`);
    return;
  }
  if (!(await locator.isEditable({ timeout: 5_000 }))) throw new ContractError(`expected editable fixture control: ${action.selector}`);
}

async function pageMetrics(page: Page, externalRequests: Set<string>, effectRequests: Set<string>, consoleErrors: string[]): Promise<ViewportMetrics> {
  const facts = await page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>("[data-evidence-key]")];
    const unusable = /\b(?:tbd|not available|oauth|connection\s*=|score_rule|default template)\b|==/i;
    const decisionEvidenceCount = cards.filter((card) => {
      const text = card.innerText.trim();
      return text.length >= 24 && !unusable.test(text);
    }).length;
    const controls = [...document.querySelectorAll<HTMLElement>("button, input, textarea, a[href]")]
      .filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && element.getBoundingClientRect().width > 0;
      });
    const hasAccessibleName = (element: HTMLElement) => {
      const labelledBy = element.getAttribute("aria-labelledby");
      const labelledText = labelledBy?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ") ?? "";
      const id = element.getAttribute("id");
      const explicitLabel = id ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`)?.innerText ?? "" : "";
      return Boolean((element.getAttribute("aria-label") || labelledText || explicitLabel || element.innerText || element.getAttribute("placeholder") || "").trim());
    };
    const amount = document.querySelector<HTMLInputElement>("[data-testid='offer-amount']");
    const message = document.querySelector<HTMLTextAreaElement>("[data-testid='offer-message']");
    const draftStatus = document.querySelector<HTMLElement>("[data-testid='draft-status']");
    const draftStyle = draftStatus ? getComputedStyle(draftStatus) : null;
    const primaryAction = document.querySelector<HTMLButtonElement>("[data-testid='prepare-offer']");
    const primaryStyle = primaryAction ? getComputedStyle(primaryAction) : null;
    const primaryRect = primaryAction?.getBoundingClientRect();
    const primaryActionVisible = Boolean(
      primaryAction &&
      primaryStyle?.display !== "none" &&
      primaryStyle?.visibility !== "hidden" &&
      primaryStyle?.pointerEvents !== "none" &&
      !primaryAction.disabled &&
      primaryRect &&
      primaryRect.width > 0 &&
      primaryRect.height > 0,
    );
    const primaryActionInViewport = Boolean(
      primaryRect &&
      primaryRect.left >= 0 &&
      primaryRect.top >= 0 &&
      primaryRect.right <= window.innerWidth &&
      primaryRect.bottom <= window.innerHeight,
    );
    const primaryActionTargetSized = Boolean(primaryRect && primaryRect.width >= 44 && primaryRect.height >= 44);
    return {
      decisionEvidenceCount,
      internalIdentifierCount: document.querySelectorAll("[data-testid='provider-debug']").length,
      accessiblePrimaryControls: controls.every(hasAccessibleName),
      horizontalOverflowPixels: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      offerEditable: Boolean(amount && message && !amount.disabled && !message.disabled && !amount.readOnly && !message.readOnly),
      draftStatusVisible: Boolean(
        draftStatus &&
        draftStyle?.display !== "none" &&
        draftStyle?.visibility !== "hidden" &&
        draftStatus.getBoundingClientRect().width > 0 &&
        draftStatus.getBoundingClientRect().height > 0,
      ),
      responsivePrimaryAction: primaryActionVisible && primaryActionInViewport && (window.innerWidth > 480 || primaryActionTargetSized),
    };
  });
  return {
    taskComplete: false,
    ...facts,
    externalRequestCount: externalRequests.size,
    effectRequestCount: effectRequests.size,
    consoleErrorCount: consoleErrors.length,
    draftOnly: facts.draftStatusVisible && effectRequests.size === 0,
  };
}

export class PlaywrightEvidenceCollector implements EvidenceCollector {
  constructor(
    readonly manifests: ManifestClient,
    readonly artifacts: ArtifactStore,
  ) {}

  async collect(context: ObservationContext): Promise<JourneyEvidence> {
    const manifest = await this.manifests.load(context.targetUrl);
    this.#assertTaskContract(context, manifest);
    const facts = await this.manifests.verifiedFacts(context.targetUrl, manifest);
    if (manifest.sourceSnapshotDigest !== context.snapshot.digest || manifest.patchDigest !== context.snapshot.patchDigest || manifest.candidateSnapshotDigest !== context.snapshot.candidateDigest || facts.rawDigest !== context.snapshot.verifiedFactsDigest) {
      throw new ContractError("owned fixture manifest changed after source snapshot sealing");
    }
    const startedAt = new Date().toISOString();
    const evidence: EvidenceArtifact[] = [];
    const stepResults = new Map(context.task.steps.map((step) => [step.id, {
      id: step.id,
      instruction: step.instruction,
      status: "passed" as JourneyStep["status"],
      observation: "Exact frozen step replayed at every viewport",
      evidenceIds: [] as string[],
    }]));
    const viewportMetrics: ViewportMetrics[] = [];
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      for (const viewport of context.task.viewports) {
        const browserContext = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          serviceWorkers: "block",
          colorScheme: "light",
          reducedMotion: "reduce",
        });
        const page = await browserContext.newPage();
        const externalRequests = new Set<string>();
        const effectRequests = new Set<string>();
        const consoleErrors: string[] = [];
        const targetOrigin = new URL(context.targetUrl).origin;
        await browserContext.route("**/*", async (route) => {
          const requestUrl = new URL(route.request().url());
          const method = route.request().method().toUpperCase();
          if (method !== "GET" && method !== "HEAD") {
            effectRequests.add(`${method} ${requestUrl.pathname}`);
            await route.abort("blockedbyclient");
            return;
          }
          if (requestUrl.origin !== targetOrigin) {
            externalRequests.add(requestUrl.origin);
            await route.abort("blockedbyclient");
            return;
          }
          if (context.variant === "candidate" && context.patch?.runtimeArtifactId && requestUrl.pathname === "/__patchcourt/data.json") {
            const runtime = await this.artifacts.read(context.patch.runtimeArtifactId);
            if (!context.patch.runtimeArtifactSha256 || sha256(runtime.bytes) !== context.patch.runtimeArtifactSha256) {
              throw new ContractError("runtime candidate artifact digest does not match sealed patch metadata");
            }
            if (!context.patch.groundingArtifactId || !context.patch.groundingArtifactSha256 || context.patch.verifiedFactsDigest !== context.snapshot.verifiedFactsDigest) {
              throw new ContractError("runtime candidate is missing its sealed factual-grounding proof");
            }
            const grounding = await this.artifacts.read(context.patch.groundingArtifactId);
            if (sha256(grounding.bytes) !== context.patch.groundingArtifactSha256) {
              throw new ContractError("runtime candidate grounding artifact digest does not match sealed patch metadata");
            }
            await route.fulfill({ status: 200, contentType: "application/json", body: runtime.bytes });
            return;
          }
          await route.continue();
        });
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(redactText(message.text()).slice(0, 300));
        });
        page.on("pageerror", (error) => consoleErrors.push(redactText(error.message).slice(0, 300)));
        const variantPath = manifest.variants[context.variant];
        await page.goto(new URL(variantPath, targetOrigin).toString(), { waitUntil: "networkidle", timeout: 15_000 });

        for (const manifestStep of manifest.task.steps) {
          const result = stepResults.get(manifestStep.id);
          if (!result) throw new ContractError(`manifest step is outside frozen contract: ${manifestStep.id}`);
          let failure: string | undefined;
          try {
            for (const action of manifestStep.actions) await executeAction(page, action);
          } catch (error) {
            failure = redactText(error instanceof Error ? error.message : "unknown browser action failure").slice(0, 240);
            result.status = "failed";
            result.observation = failure;
          }
          const bytes = await page.screenshot({ type: "png", fullPage: false });
          const stored = await this.artifacts.put({
            runId: context.runId,
            variant: context.variant,
            viewport: viewport.name,
            stepId: manifestStep.id,
            kind: "screenshot",
            extension: "png",
            bytes,
          });
          const artifact: EvidenceArtifact = {
            ...stored,
            kind: "screenshot",
            label: `${manifestStep.instruction} · ${viewport.name}`,
            stepId: manifestStep.id,
            variant: context.variant,
            viewport: viewport.name,
            capturedAt: new Date().toISOString(),
            observation: failure ? `Step failed: ${failure}` : `Step completed at ${viewport.width}×${viewport.height}`,
          };
          evidence.push(artifact);
          result.evidenceIds.push(artifact.id);
        }

        const metrics = await pageMetrics(page, externalRequests, effectRequests, consoleErrors);
        metrics.taskComplete = [...stepResults.values()].every((step) => step.status === "passed");
        viewportMetrics.push(metrics);
        const auditStep = context.task.steps.at(-1);
        if (!auditStep) throw new ContractError("frozen task has no terminal step");
        for (const [kind, body] of [
          ["accessibility", { accessiblePrimaryControls: metrics.accessiblePrimaryControls }],
          ["console", { errorCount: consoleErrors.length, errors: consoleErrors }],
          ["network", { externalRequestCount: externalRequests.size, effectRequestCount: effectRequests.size, blockedOrigins: [...externalRequests].sort(), blockedEffects: [...effectRequests].sort() }],
          ["trace", {
            taskFingerprint: context.task.fingerprint,
            manifestDigest: context.snapshot.manifestDigest,
            sourceSnapshotDigest: context.snapshot.digest,
            candidateSnapshotDigest: context.snapshot.candidateDigest ?? null,
            patchDigest: context.snapshot.patchDigest ?? null,
            verifiedFactsDigest: context.snapshot.verifiedFactsDigest ?? null,
            viewport: viewport.name,
          }],
        ] as const) {
          const bytes = Buffer.from(JSON.stringify(body));
          const stored = await this.artifacts.put({
            runId: context.runId,
            variant: context.variant,
            viewport: viewport.name,
            stepId: auditStep.id,
            kind,
            extension: "json",
            bytes,
          });
          const artifact: EvidenceArtifact = {
            ...stored,
            kind,
            label: `${kind} facts · ${viewport.name}`,
            stepId: auditStep.id,
            variant: context.variant,
            viewport: viewport.name,
            capturedAt: new Date().toISOString(),
            observation: `${kind} facts captured without raw private payloads`,
          };
          evidence.push(artifact);
          stepResults.get(auditStep.id)?.evidenceIds.push(artifact.id);
        }
        await browserContext.close();
      }
    } finally {
      await browser?.close();
    }

    const aggregate = {
      taskComplete: viewportMetrics.every((item) => item.taskComplete),
      decisionEvidenceCount: Math.min(...viewportMetrics.map((item) => item.decisionEvidenceCount)),
      decisionEvidenceTarget: 4,
      internalIdentifierCount: Math.max(...viewportMetrics.map((item) => item.internalIdentifierCount)),
      externalRequestCount: viewportMetrics.reduce((sum, item) => sum + item.externalRequestCount, 0),
      effectRequestCount: viewportMetrics.reduce((sum, item) => sum + item.effectRequestCount, 0),
      accessiblePrimaryControls: viewportMetrics.every((item) => item.accessiblePrimaryControls),
      horizontalOverflowPixels: Math.max(...viewportMetrics.map((item) => item.horizontalOverflowPixels)),
      consoleErrorCount: viewportMetrics.reduce((sum, item) => sum + item.consoleErrorCount, 0),
      offerEditable: viewportMetrics.every((item) => item.offerEditable),
      draftOnly: viewportMetrics.every((item) => item.draftOnly),
      responsivePrimaryAction: viewportMetrics.every((item) => item.responsivePrimaryAction),
    };
    return {
      variant: context.variant,
      targetUrl: new URL(manifest.variants[context.variant], new URL(context.targetUrl).origin).toString(),
      taskFingerprint: context.task.fingerprint,
      taskSucceeded: aggregate.taskComplete,
      steps: [...stepResults.values()],
      artifacts: evidence,
      metrics: aggregate,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  #assertTaskContract(context: ObservationContext, manifest: DemoManifest): void {
    if (context.task.fingerprint !== manifest.taskFingerprint) throw new ContractError("local task fingerprint does not match the owned manifest");
    const manifestSteps = manifest.task.steps.map(({ id, instruction }) => ({ id, instruction }));
    const frozenSteps = context.task.steps.map(({ id, instruction }) => ({ id, instruction }));
    if (JSON.stringify(manifestSteps) !== JSON.stringify(frozenSteps)) throw new ContractError("local task text differs from the sealed manifest task");
  }
}
