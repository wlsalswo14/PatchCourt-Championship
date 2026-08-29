import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ContractError,
  contentHash,
  redactText,
  sha256,
  type BlindJudge,
  type BlindJudgeInput,
  type BlindJudgeResult,
  type BlindJudgeVerdict,
  type CandidatePatcher,
  type CriticFindingInput,
  type ProductCritic,
} from "@patchcourt/core";

import { ArtifactStore } from "./artifact-store.js";
import { GEMINI_DESIGN_MODEL } from "./constants.js";
import { ManifestClient, type VerifiedFactsPacket } from "./manifest.js";
import { TargetPolicy } from "./target-policy.js";

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiResult<T> {
  value: T;
  responseId: string | null;
  /** SHA-256 of the model's JSON content text; the content itself is never persisted. */
  contentSha256?: string;
}

interface CandidateGrounding {
  path: string;
  factIds: string[];
}

interface CandidateRepairContext {
  rejectedPaths: string[];
  forbiddenTokens: string[];
  allowedTokensByPath: Record<string, string[]>;
}

class CandidateValidationError extends ContractError {
  constructor(message: string, readonly repair: CandidateRepairContext) {
    super(message);
  }
}

const NEUTRAL_UI_WORDS = new Set(`
  a about action after aligned alignment all an and are as at available because before brand by can
  checked clear collaborate collaboration conversation could decision discuss discussing draft evidence exact fee
  first fit for from grounded has have heading if in into is it its keeps local look make may message next no
  not now of offer on only open operator or prepare prepared public recommend recommended remains required review
  safe same separate should so strong support supported task that the their this through to unsent use user users
  value visible was we were while will with without would your
`.trim().split(/\s+/));

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractText(value: unknown): { text: string; responseId: string | null; modelVersion: string | null } {
  if (!record(value) || !Array.isArray(value.candidates)) throw new ContractError("Gemini returned no candidate");
  const candidate = value.candidates[0];
  if (!record(candidate) || !record(candidate.content) || !Array.isArray(candidate.content.parts)) throw new ContractError("Gemini returned no content parts");
  if (candidate.finishReason !== "STOP") throw new ContractError("Gemini response did not finish cleanly");
  const text = candidate.content.parts
    .filter(record)
    .map((part) => typeof part.text === "string" ? part.text : "")
    .join("")
    .trim();
  if (!text) throw new ContractError("Gemini returned an empty JSON response");
  return {
    text,
    responseId: typeof value.responseId === "string" ? value.responseId : null,
    modelVersion: typeof value.modelVersion === "string" ? value.modelVersion : null,
  };
}

export class GeminiJsonClient {
  readonly model: string;
  readonly #apiKey: string;

  constructor(options: { apiKey?: string; model?: string } = {}) {
    this.#apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? GeminiJsonClient.#keyFromSecretFile();
    this.model = options.model ?? GEMINI_DESIGN_MODEL;
    if (!this.#apiKey) throw new ContractError("live-gemini mode requires GEMINI_API_KEY");
    if (!/^[a-z0-9._-]+$/i.test(this.model)) throw new ContractError("Gemini model name is invalid");
  }

  static #keyFromSecretFile(): string {
    const file = process.env.PATCHCOURT_SECRET_FILE?.trim();
    if (!file) return "";
    let text: string;
    try {
      text = readFileSync(resolve(file), "utf8").trim();
    } catch {
      throw new ContractError("PATCHCOURT_SECRET_FILE could not be read");
    }
    if (!text) return "";
    if (text.startsWith("{")) {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        if (typeof parsed.GEMINI_API_KEY === "string") return parsed.GEMINI_API_KEY.trim();
        return typeof parsed.GEMMA_API_KEY === "string" ? parsed.GEMMA_API_KEY.trim() : "";
      } catch {
        throw new ContractError("PATCHCOURT_SECRET_FILE JSON is invalid");
      }
    }
    const dotenvLine = text.split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /^(?:GEMINI_API_KEY|GEMMA_API_KEY)\s*=/.test(line));
    if (dotenvLine) {
      const value = dotenvLine.slice(dotenvLine.indexOf("=") + 1).trim();
      return value.replace(/^(['"])(.*)\1$/, "$2").trim();
    }
    if (/^[^\s=]+$/.test(text)) return text;
    throw new ContractError("PATCHCOURT_SECRET_FILE has no supported Gemini key field");
  }

  async generate<T>(input: { system: string; parts: GeminiPart[]; temperature?: number }): Promise<GeminiResult<T>> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const requestBody = JSON.stringify({
      systemInstruction: { parts: [{ text: redactText(input.system) }] },
      contents: [{ role: "user", parts: input.parts.map((part) => part.text ? { text: redactText(part.text) } : part) }],
      generationConfig: {
        temperature: input.temperature ?? 0.15,
        responseMimeType: "application/json",
      },
    });
    let response: Response | undefined;
    const retryDelaysMs = [15_000, 35_000];
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.#apiKey,
        },
        redirect: "error",
        signal: AbortSignal.timeout(90_000),
        body: requestBody,
      });
      if (response.ok) break;
      const retryable = response.status === 429 || response.status === 503;
      const delay = retryDelaysMs[attempt];
      if (!retryable || delay === undefined) throw new ContractError(`Gemini request failed with status ${response.status}`);
      await response.body?.cancel().catch(() => undefined);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
    }
    if (!response?.ok) throw new ContractError("Gemini request failed after bounded retry");
    const raw = await response.text();
    if (raw.length > 4_000_000) throw new ContractError("Gemini response exceeded the size limit");
    let envelope: unknown;
    try {
      envelope = JSON.parse(raw);
    } catch {
      throw new ContractError("Gemini transport response was not JSON");
    }
    const { text, responseId, modelVersion } = extractText(envelope);
    try {
      return {
        value: JSON.parse(text) as T,
        responseId: responseId ?? (modelVersion ? `model:${modelVersion}` : null),
        contentSha256: sha256(text),
      };
    } catch {
      throw new ContractError("Gemini content did not satisfy JSON mode");
    }
  }
}

async function screenshotParts(artifacts: ArtifactStore, ids: string[], prefix: string): Promise<GeminiPart[]> {
  const parts: GeminiPart[] = [];
  for (const id of ids.slice(0, 4)) {
    if (!id.endsWith(".png")) continue;
    const stored = await artifacts.read(id);
    parts.push({ text: `${prefix} evidence frame ${Math.floor(parts.length / 2) + 1}` });
    parts.push({ inlineData: { mimeType: "image/png", data: stored.bytes.toString("base64") } });
  }
  return parts;
}

export function selectBlindScreenshotIds(ids: string[]): string[] {
  const preferred = ids.filter((id) => /-(?:inspect|confirm)-screenshot-/i.test(id) && id.endsWith(".png"));
  return preferred.slice(0, 4);
}

export function blindScreenshotShape(ids: string[]): string[] {
  return selectBlindScreenshotIds(ids).map((id) => {
    const match = id.match(/-(desktop|mobile)-(inspect|confirm)-screenshot-/i);
    if (!match) throw new ContractError("blind screenshot id lacks a sealed step/viewport shape");
    return `${match[1]?.toLowerCase()}:${match[2]?.toLowerCase()}`;
  }).sort();
}

export class GeminiProductCritic implements ProductCritic {
  readonly id: string;

  constructor(
    readonly client: GeminiJsonClient,
    readonly artifacts: ArtifactStore,
    readonly role: { id: string; focus: string; screenshotSteps: string[] } = {
      id: "product-outcome",
      focus: "task success, decision usefulness, and authored visual hierarchy",
      screenshotSteps: ["profile", "inspect", "offer"],
    },
  ) {
    this.id = `gemini-${role.id}-critic:${client.model}`;
  }

  async review(context: Parameters<ProductCritic["review"]>[0]): Promise<CriticFindingInput[]> {
    const screenshotIds = context.incumbent.artifacts
      .filter((artifact) => artifact.kind === "screenshot" && this.role.screenshotSteps.includes(artifact.stepId))
      .map((artifact) => artifact.id);
    const result = await this.client.generate<{ findings?: CriticFindingInput[] }>({
      system: `You are PatchCourt's ${this.role.id} evidence-bound critic. Your focus is ${this.role.focus}. Return only JSON. Never infer facts not visible in the supplied screenshots or metrics. A finding is actionable only with exact evidence artifact IDs, falsifiable observations, reproduction, impact, expected behavior, one allowlisted patch locus, proposed direction, executable acceptance checks, and regression risks.`,
      parts: [
        { text: JSON.stringify({
          task: context.task,
          metrics: context.incumbent.metrics,
          evidence: context.incumbent.artifacts.map(({ id, kind, stepId, viewport, observation }) => ({ id, kind, stepId, viewport, observation })),
          allowedDomains: ["design", "usability", "functionality", "security", "privacy", "accessibility"],
          allowedSeverities: ["critical", "high", "medium", "low"],
          allowedPatchLoci: context.snapshot.allowlistedFiles,
          output: { findings: [{ criticId: this.id, domain: "usability", severity: "high", title: "...", evidence: [{ artifactId: "exact id", observation: "..." }], reproduction: ["..."], userImpact: "...", expectedBehavior: "...", patchLocus: "allowed path", proposedDirection: "...", acceptanceChecks: ["..."], regressionRisks: ["..."] }] },
        }) },
        ...(await screenshotParts(this.artifacts, screenshotIds, "incumbent")),
      ],
    });
    return Array.isArray(result.value.findings)
      ? result.value.findings.map((finding) => ({ ...finding, criticId: this.id }))
      : [];
  }
}

function sameStringShape(template: unknown, candidate: unknown, path = "root"): void {
  if (typeof template === "string") {
    if (typeof candidate !== "string" || candidate.length > 2_000) throw new ContractError(`Gemini candidate changed the data contract at ${path}`);
    if (candidate !== redactText(candidate) || /https?:\/\/|(?:profile_id|token|secret|credential)\s*=/i.test(candidate)) {
      throw new ContractError(`Gemini candidate introduced forbidden sensitive or URL-like content at ${path}`);
    }
    return;
  }
  if (!record(template) || !record(candidate)) throw new ContractError(`Gemini candidate changed the object contract at ${path}`);
  const expected = Object.keys(template).sort();
  const actual = Object.keys(candidate).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new ContractError(`Gemini candidate changed keys at ${path}`);
  for (const key of expected) sameStringShape(template[key], candidate[key], `${path}.${key}`);
}

function lexicalTokens(value: unknown): string[] {
  return String(value).normalize("NFKC").toLocaleLowerCase().match(/@[a-z0-9._-]+|[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) ?? [];
}

function publicSourceStrings(value: unknown, path = "root"): string[] {
  if (typeof value === "string") {
    if (/(?:providerdebug|credential|token|secret)/i.test(path) || /oauth|profile_id|https?:\/\/|connection\s*=|score_rule/i.test(value)) return [];
    return [value];
  }
  if (!record(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => publicSourceStrings(child, `${path}.${key}`));
}

function sanitizedPromptData(value: unknown, path = "root"): unknown {
  if (typeof value === "string") {
    if (/(?:providerdebug|credential|token|secret)/i.test(path) || /oauth|profile_id|https?:\/\/|connection\s*=|score_rule/i.test(value)) return "[REDACTED_INTERNAL_VALUE]";
    return value;
  }
  if (!record(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitizedPromptData(child, `${path}.${key}`)]));
}

function stringShape(value: unknown): unknown {
  if (typeof value === "string") return "<short-string>";
  if (!record(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, stringShape(child)]));
}

function clearSensitiveSourceLeaves(
  source: unknown,
  candidate: unknown,
  mustClearPaths: ReadonlySet<string>,
  path = "root",
): { value: unknown; clearedPaths: string[]; repairRequiredPaths: string[] } {
  if (typeof source === "string" && typeof candidate === "string") {
    const relativePath = path.startsWith("root.") ? path.slice("root.".length) : path;
    const protectedPath = mustClearPaths.has(relativePath);
    const candidateSensitive = /oauth|profile_id|https?:\/\/|connection\s*=|score_rule/i.test(candidate);
    if (protectedPath) return { value: "", clearedPaths: [path], repairRequiredPaths: [] };
    if (candidateSensitive) return { value: "", clearedPaths: [path], repairRequiredPaths: [path] };
    return { value: candidate, clearedPaths: [], repairRequiredPaths: [] };
  }
  if (!record(source) || !record(candidate)) return { value: candidate, clearedPaths: [], repairRequiredPaths: [] };
  const clearedPaths: string[] = [];
  const repairRequiredPaths: string[] = [];
  const value = Object.fromEntries(Object.keys(source).map((key) => {
    const cleared = clearSensitiveSourceLeaves(source[key], candidate[key], mustClearPaths, `${path}.${key}`);
    clearedPaths.push(...cleared.clearedPaths);
    repairRequiredPaths.push(...cleared.repairRequiredPaths);
    return [key, cleared.value];
  }));
  return { value, clearedPaths, repairRequiredPaths };
}

function changedStringLeaves(before: unknown, after: unknown, path = "root"): Array<{ path: string; value: string }> {
  if (typeof before === "string" && typeof after === "string") return before === after ? [] : [{ path, value: after }];
  if (!record(before) || !record(after)) return [];
  return Object.keys(before).flatMap((key) => changedStringLeaves(before[key], after[key], `${path}.${key}`));
}

function stringLeafPaths(value: unknown, path = "root"): string[] {
  if (typeof value === "string") return [path];
  if (!record(value)) return [];
  return Object.keys(value).flatMap((key) => stringLeafPaths(value[key], `${path}.${key}`));
}

function tokenAllowed(token: string, allowed: Set<string>): boolean {
  const segments = token.toLocaleLowerCase().split(/[-']/).filter(Boolean);
  return segments.every((segment) => {
    if (/\d/.test(segment) || allowed.has(segment) || NEUTRAL_UI_WORDS.has(segment)) return true;
    const stems = segment.length > 4 ? [segment.replace(/(?:ing|ed|ly|es|s)$/, "")] : [];
    return stems.some((stem) => stem.length >= 3 && (allowed.has(stem) || NEUTRAL_UI_WORDS.has(stem)));
  });
}

function safePatchSummary(before: unknown, after: unknown, path = "root"): string[] {
  if (typeof before === "string" && typeof after === "string") {
    if (before === after) return [];
    const safeBefore = /(?:providerDebug|credential|token|secret)/i.test(path) || /oauth|profile_id|https?:\/\//i.test(before)
      ? "[REDACTED_INTERNAL_VALUE]"
      : redactText(before);
    return [`~ ${path}: ${JSON.stringify(safeBefore)} -> ${JSON.stringify(after)}`];
  }
  if (!record(before) || !record(after)) return [];
  return Object.keys(before).flatMap((key) => safePatchSummary(before[key], after[key], `${path}.${key}`));
}

function numericClaims(value: unknown): number[] {
  const text = JSON.stringify(value);
  return [...text.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?[kK]?/g)].map((match) => {
    const raw = match[0].replaceAll(",", "");
    const multiplier = /k$/i.test(raw) ? 1_000 : 1;
    return Number.parseFloat(raw.replace(/k$/i, "")) * multiplier;
  }).filter(Number.isFinite);
}

export function validateFactualClaims(
  candidate: unknown,
  incumbent: unknown,
  facts: VerifiedFactsPacket,
  userTask: string,
  grounding: CandidateGrounding[],
): CandidateGrounding[] {
  const allowedNumbers = numericClaims({ incumbent, facts, userTask });
  for (const claim of numericClaims(candidate)) {
    if (!allowedNumbers.some((allowed) => Math.abs(allowed - claim) < 0.000_001)) {
      throw new CandidateValidationError("Gemini candidate introduced an unsealed numeric claim", {
        rejectedPaths: ["unknown-numeric-path"],
        forbiddenTokens: [String(claim)],
        allowedTokensByPath: { "*": allowedNumbers.map(String).sort() },
      });
    }
  }
  const serializedCandidate = JSON.stringify(candidate).toLocaleLowerCase();
  const serializedFacts = JSON.stringify(facts).toLocaleLowerCase();
  if (/\b(?:verified|ownership checked|evidence checked)\b/.test(serializedCandidate) && !/\bverified\b/.test(serializedFacts)) {
    throw new ContractError("Gemini candidate introduced an unsealed verification claim");
  }
  const factById = new Map(facts.facts.map((fact) => [fact.id, fact]));
  const changed = changedStringLeaves(incumbent, candidate);
  const changedPaths = new Set(changed.map((leaf) => leaf.path));
  const candidatePaths = new Set(stringLeafPaths(candidate));
  const groundingByPath = new Map<string, CandidateGrounding>();
  for (const entry of grounding) {
    if (!record(entry) || typeof entry.path !== "string" || !Array.isArray(entry.factIds) || !entry.factIds.every((id) => typeof id === "string")) {
      throw new ContractError("Gemini candidate grounding contract is invalid");
    }
    const canonicalPath = entry.path === "root" || entry.path.startsWith("root.") ? entry.path : `root.${entry.path}`;
    if (groundingByPath.has(canonicalPath)) throw new ContractError(`Gemini candidate grounding path is duplicated: ${canonicalPath}`);
    if (!candidatePaths.has(canonicalPath)) throw new ContractError(`Gemini candidate grounding references an unknown data path: ${canonicalPath}`);
    for (const id of entry.factIds) if (!factById.has(id)) throw new ContractError(`Gemini candidate grounding references an unknown sealed fact: ${id}`);
    groundingByPath.set(canonicalPath, { path: canonicalPath, factIds: [...new Set(entry.factIds)].sort() });
  }
  const baseTokens = new Set(lexicalTokens([...publicSourceStrings(incumbent), userTask].join(" ")));
  for (const leaf of changed) {
    const entry = groundingByPath.get(leaf.path);
    if (!entry) throw new ContractError(`Gemini candidate changed an ungrounded path: ${leaf.path}`);
    if (/\b(?:tbd|oauth(?:2)?|connection\s*=|score_rule|profile_id|default template)\b|https?:\/\//i.test(leaf.value)) {
      throw new ContractError(`Gemini candidate retained forbidden implementation language at ${leaf.path}`);
    }
    const selectedFacts = entry.factIds.map((id) => factById.get(id));
    const allowedTokens = new Set(baseTokens);
    for (const token of lexicalTokens(JSON.stringify(selectedFacts))) allowedTokens.add(token);
    const renderedTokens = leaf.value.normalize("NFKC").match(/@[A-Za-z0-9._-]+|[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) ?? [];
    for (const [index, renderedToken] of renderedTokens.entries()) {
      const namedClaim = renderedToken.startsWith("@") || (/^[\p{Lu}]/u.test(renderedToken) && index > 0) || /^[A-Z]{2,}(?:[-'][A-Za-z]+)?$/.test(renderedToken);
      if (namedClaim && !tokenAllowed(renderedToken, allowedTokens)) {
        throw new CandidateValidationError(`Gemini candidate introduced an unsealed public claim token at ${leaf.path}`, {
          rejectedPaths: [leaf.path],
          forbiddenTokens: [renderedToken],
          allowedTokensByPath: { [leaf.path]: [...allowedTokens].sort() },
        });
      }
    }
  }
  if ([...changedPaths].some((path) => !groundingByPath.has(path))) throw new ContractError("Gemini candidate grounding does not cover every changed value");
  return [...groundingByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function fixtureJson(target: URL, variant: "incumbent" | "candidate"): Promise<unknown> {
  const response = await fetch(new URL(`/__patchcourt/data.json?variant=${variant}`, target.origin), { redirect: "error", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new ContractError(`owned fixture data request failed: ${response.status}`);
  const text = await response.text();
  if (text.length > 1_000_000) throw new ContractError("owned fixture data exceeded the size limit");
  return JSON.parse(text) as unknown;
}

export class GeminiCandidatePatcher implements CandidatePatcher {
  constructor(
    readonly client: GeminiJsonClient,
    readonly manifests: ManifestClient,
    readonly artifacts: ArtifactStore,
    readonly policy = new TargetPolicy(),
  ) {}

  async apply(context: Parameters<CandidatePatcher["apply"]>[0]) {
    const target = this.policy.assertAllowed(context.targetUrl);
    const [manifest, patchManifest, incumbentData] = await Promise.all([
      this.manifests.load(context.targetUrl),
      this.manifests.patch(context.targetUrl),
      fixtureJson(target, "incumbent"),
    ]);
    const verifiedFacts = await this.manifests.verifiedFacts(context.targetUrl, manifest);
    if (manifest.sourceSnapshotDigest !== context.snapshot.digest || manifest.candidateSnapshotDigest !== context.snapshot.candidateDigest || manifest.patchDigest !== context.snapshot.patchDigest || patchManifest.rawDigest !== manifest.patchDigest || verifiedFacts.rawDigest !== context.snapshot.verifiedFactsDigest) {
      throw new ContractError("owned fixture changed after snapshot sealing");
    }
    const sourceStringPaths = new Set(stringLeafPaths(incumbentData).map((path) => path.slice("root.".length)));
    const unresolvedMustClearPaths = manifest.safety.mustClearPaths.filter((path) => !sourceStringPaths.has(path));
    if (unresolvedMustClearPaths.length > 0) {
      throw new ContractError(`manifest safety.mustClearPaths did not resolve to source string leaves: ${unresolvedMustClearPaths.join(",")}`);
    }
    const mustClearPaths = new Set(manifest.safety.mustClearPaths);
    const rejectedSynthesisDigests: string[] = [];
    let repairContext: CandidateRepairContext | undefined;
    let accepted: {
      candidateData: unknown;
      grounding: CandidateGrounding[];
      responseId: string | null;
      attemptCount: number;
    } | undefined;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = await this.client.generate<{ candidateData?: unknown; grounding?: CandidateGrounding[] }>({
        system: "You are PatchCourt's safe candidate patch synthesizer. Return only JSON. Modify values only; preserve every object key and nesting. The sealed synthetic verifiedFactsPacket is the sole authority for new factual enrichment. You may reorganize those facts, but must not invent numbers, verification, audience, identity, geography, platform, demographic cohort labels, brand names, or campaign claims. Every changed string path must have exactly one grounding entry with the sealed fact IDs it uses (or an empty factIds list for a purely presentational/safety edit). Use only words already present in sanitizedIncumbentData, frozenTask, referenced facts, or allowedNeutralUiWords. Every mustClearPath is an authoritative manifest safety rule and its candidate value must be an empty string. Do not add scripts, URLs, credentials, or external effects. If validationRepair is supplied, remove every forbidden token and use only the allowed tokens for each rejected path.",
        parts: [{ text: JSON.stringify({
          frozenTask: context.task,
          atomicBrief: context.brief,
          sanitizedIncumbentData: sanitizedPromptData(incumbentData),
          exactShape: stringShape(incumbentData),
          verifiedFactsDigest: verifiedFacts.rawDigest,
          verifiedFactsPacket: verifiedFacts.packet,
          allowedNeutralUiWords: [...NEUTRAL_UI_WORDS].sort(),
          mustClearPaths: manifest.safety.mustClearPaths,
          validationRepair: repairContext ?? null,
          previousRejectedCandidateSha256: rejectedSynthesisDigests.at(-1) ?? null,
          outputContract: {
            candidateData: "same exact keys/nesting; every leaf remains a short string",
            grounding: [{ path: "root.dot.path.for.every.changed.string", factIds: ["zero or more exact verifiedFactsPacket fact IDs"] }],
          },
        }) }],
      });
      try {
        const safetyCleared = clearSensitiveSourceLeaves(incumbentData, result.value.candidateData, mustClearPaths);
        const candidateData = safetyCleared.value;
        if (safetyCleared.repairRequiredPaths.length > 0) {
          throw new CandidateValidationError("Gemini candidate retained sensitive implementation language in a public evidence field", {
            rejectedPaths: safetyCleared.repairRequiredPaths,
            forbiddenTokens: ["[SENSITIVE_IMPLEMENTATION_LANGUAGE]"],
            allowedTokensByPath: Object.fromEntries(safetyCleared.repairRequiredPaths.map((path) => [path, lexicalTokens(JSON.stringify(verifiedFacts.packet))])),
          });
        }
        sameStringShape(incumbentData, candidateData);
        if (!Array.isArray(result.value.grounding)) throw new ContractError("Gemini candidate omitted its sealed-fact grounding map");
        const groundedPaths = new Set(result.value.grounding
          .filter((entry) => record(entry) && typeof entry.path === "string")
          .map((entry) => entry.path === "root" || entry.path.startsWith("root.") ? entry.path : `root.${entry.path}`));
        const groundingInput = [
          ...result.value.grounding,
          ...safetyCleared.clearedPaths.filter((path) => !groundedPaths.has(path)).map((path) => ({ path, factIds: [] })),
        ];
        const grounding = validateFactualClaims(candidateData, incumbentData, verifiedFacts.packet, context.task.userTask, groundingInput);
        accepted = { candidateData, grounding, responseId: result.responseId, attemptCount: attempt };
        break;
      } catch (error) {
        if (!(error instanceof ContractError)) throw error;
        rejectedSynthesisDigests.push(result.contentSha256 ?? contentHash(result.value));
        if (attempt === 2) {
          throw new ContractError(`${error.message}; synthesisAttempts=2; rejectedCandidateDigests=${rejectedSynthesisDigests.join(",")}`);
        }
        repairContext = error instanceof CandidateValidationError
          ? error.repair
          : { rejectedPaths: [], forbiddenTokens: [], allowedTokensByPath: {} };
      }
    }
    if (!accepted) throw new ContractError("Gemini candidate synthesis ended without an accepted value-only patch");
    const candidateData = accepted.candidateData;
    const validatedGrounding = accepted.grounding;
    const candidateBytes = Buffer.from(JSON.stringify(candidateData, null, 2));
    const stored = await this.artifacts.put({
      runId: context.runId,
      variant: "candidate",
      viewport: "runtime",
      stepId: "patch",
      kind: "candidate-data",
      extension: "json",
      bytes: candidateBytes,
    });
    const groundingBytes = Buffer.from(JSON.stringify({
      schemaVersion: 1,
      verifiedFactsDigest: verifiedFacts.rawDigest,
      synthesisValidation: {
        outcome: "accepted",
        attemptCount: accepted.attemptCount,
        rejectedCandidateDigests: rejectedSynthesisDigests,
      },
      safetyPolicy: {
        mustClearPaths: manifest.safety.mustClearPaths,
      },
      mappings: validatedGrounding,
    }, null, 2));
    const groundingStored = await this.artifacts.put({
      runId: context.runId,
      variant: "candidate",
      viewport: "runtime",
      stepId: "patch-grounding",
      kind: "trace",
      extension: "json",
      bytes: groundingBytes,
    });
    const diff = [
      `--- ${patchManifest.source}`,
      `+++ ${patchManifest.candidate}`,
      "@@ Gemini value-only candidate @@",
      ...safePatchSummary(incumbentData, candidateData),
      "",
    ].join("\n");
    return {
      id: `patch-${sha256(diff).slice(0, 16)}`,
      title: "Gemini evidence-bound candidate patch",
      status: "applied" as const,
      baseDigest: context.snapshot.digest,
      candidateDigest: contentHash({ source: manifest.sourceSnapshotDigest, payloadSha256: stored.sha256, manifest: context.snapshot.manifestDigest, verifiedFactsDigest: verifiedFacts.rawDigest, groundingSha256: groundingStored.sha256 }),
      diffDigest: sha256(diff),
      diff,
      files: [patchManifest.candidate],
      rationale: "Gemini reorganized only sealed owned synthetic facts into a value-only candidate; every changed value passed deterministic grounding validation and sensitive source leaves were cleared.",
      appliedAt: new Date().toISOString(),
      provider: { name: "google", model: this.client.model, requestId: accepted.responseId ?? undefined, mode: "live" as const },
      synthesisAttemptCount: accepted.attemptCount,
      rejectedSynthesisDigests,
      runtimeArtifactId: stored.id,
      runtimeArtifactSha256: stored.sha256,
      groundingArtifactId: groundingStored.id,
      groundingArtifactSha256: groundingStored.sha256,
      verifiedFactsDigest: verifiedFacts.rawDigest,
      claimBoundary: "Live Gemini reorganized a sealed owned synthetic fact packet into a value-only isolated candidate; deterministic safety clearing removed sensitive source leaves. It did not discover facts, use private data, or mutate a checked-in/public target.",
    };
  }
}

export function liveGeminiCritics(client: GeminiJsonClient, artifacts: ArtifactStore): ProductCritic[] {
  return [
    new GeminiProductCritic(client, artifacts, {
      id: "task-outcome-design",
      focus: "completion of the frozen brand journey, creator decision usefulness, and visual hierarchy",
      screenshotSteps: ["directory", "profile", "inspect"],
    }),
    new GeminiProductCritic(client, artifacts, {
      id: "accessibility-privacy",
      focus: "accessible operation, responsive layout, privacy, and removal of internal implementation metadata",
      screenshotSteps: ["inspect", "offer", "confirm"],
    }),
    new GeminiProductCritic(client, artifacts, {
      id: "adversarial-regression",
      focus: "falsifying the proposed improvement through functional, security, and unsafe side-effect risks",
      screenshotSteps: ["login", "offer", "confirm"],
    }),
  ];
}

const BLIND_DIMENSIONS = [
  "taskSuccessClarity",
  "decisionUsefulness",
  "authoredVisualQuality",
  "accessibilityResponsive",
  "functionalRegression",
  "securityPrivacy",
] as const;

const codeUnitCompare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

interface AcceptedBlindJudgeJson {
  winner: "A" | "B" | "tie";
  confidence: number;
  rationale: string[];
  dimensionDeltas: BlindJudgeVerdict["dimensionDeltas"];
}

function validateBlindJudgeJson(value: unknown): {
  accepted?: AcceptedBlindJudgeJson;
  validWinner?: "A" | "B" | "tie";
  invalidFields: string[];
} {
  const invalid = new Set<string>();
  if (!record(value)) return { invalidFields: ["response"] };
  const expectedKeys = ["confidence", "dimensionDeltas", "rationale", "winner"];
  if (JSON.stringify(Object.keys(value).sort(codeUnitCompare)) !== JSON.stringify(expectedKeys)) invalid.add("response");
  const validWinner = typeof value.winner === "string" && ["A", "B", "tie"].includes(value.winner)
    ? value.winner as "A" | "B" | "tie"
    : undefined;
  if (!validWinner) invalid.add("winner");
  const confidence = value.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) invalid.add("confidence");
  const rationale = Array.isArray(value.rationale)
    ? value.rationale.filter((item): item is string => typeof item === "string" && item.trim().length > 0 && item.length <= 500)
    : [];
  if (!Array.isArray(value.rationale) || rationale.length !== value.rationale.length || rationale.length < 1 || rationale.length > 8) invalid.add("rationale");
  const dimensionDeltas: BlindJudgeVerdict["dimensionDeltas"] = {};
  if (!record(value.dimensionDeltas)
    || JSON.stringify(Object.keys(value.dimensionDeltas).sort(codeUnitCompare)) !== JSON.stringify([...BLIND_DIMENSIONS].sort(codeUnitCompare))) {
    invalid.add("dimensionDeltas");
  } else {
    for (const dimension of BLIND_DIMENSIONS) {
      const delta = value.dimensionDeltas[dimension];
      if (typeof delta !== "number" || !Number.isFinite(delta) || delta < -100 || delta > 100) {
        invalid.add(`dimensionDeltas.${dimension}`);
      } else {
        dimensionDeltas[dimension] = delta;
      }
    }
  }
  const invalidFields = [...invalid].sort(codeUnitCompare);
  if (invalidFields.length > 0 || !validWinner || typeof confidence !== "number") return { validWinner, invalidFields };
  return {
    validWinner,
    invalidFields,
    accepted: { winner: validWinner, confidence, rationale: rationale.map((item) => item.trim()), dimensionDeltas },
  };
}

function blindValidationRepair(
  mode: "none" | "format-completion" | "full-rejudge",
  rejectedResponseSha256: string | null,
  invalidFields: string[],
) {
  const payload = { mode, rejectedResponseSha256, invalidFields: [...invalidFields].sort(codeUnitCompare) };
  return { ...payload, digest: contentHash(payload) };
}

export class GeminiBlindJudge implements BlindJudge {
  constructor(readonly client: GeminiJsonClient, readonly artifacts: ArtifactStore) {}

  async judge(input: BlindJudgeInput): Promise<BlindJudgeResult> {
    const [armA, armB] = input.arms;
    if (JSON.stringify(blindScreenshotShape(armA.evidenceIds)) !== JSON.stringify(blindScreenshotShape(armB.evidenceIds))) {
      throw new ContractError("anonymous A/B screenshot packets are not structurally symmetric");
    }
    const exactShape = {
      winner: "A | B | tie",
      confidence: 0,
      rationale: ["one or more concise evidence-grounded strings"],
      dimensionDeltas: Object.fromEntries(BLIND_DIMENSIONS.map((dimension) => [dimension, 0])),
    };
    const evidenceParts: GeminiPart[] = [
      { text: JSON.stringify({
        userTask: input.userTask,
        taskFingerprint: input.taskFingerprint,
        exactOutputShape: exactShape,
        dimensionDeltaDefinition: "Every dimension is required and is numeric B minus A in the closed range -100..100",
        arms: input.arms.map(({ evidenceIds, ...arm }) => ({ ...arm, evidenceFrameCount: selectBlindScreenshotIds(evidenceIds).length })),
      }) },
      ...(await screenshotParts(this.artifacts, selectBlindScreenshotIds(armA.evidenceIds), "anonymous arm A")),
      ...(await screenshotParts(this.artifacts, selectBlindScreenshotIds(armB.evidenceIds), "anonymous arm B")),
    ];
    const system = "You are a blinded PatchCourt product judge. Arm identities are deliberately absent. Judge only the fixed user outcome and symmetric observable evidence. Critical deterministic gates already passed. Return exactly four JSON keys: winner (A, B, or tie), confidence (number 0..1), rationale (a nonempty array of concise strings), and dimensionDeltas (all six exact numeric B-minus-A dimensions). Do not return prose outside JSON or any extra keys.";
    const first = await this.client.generate<unknown>({ system, parts: evidenceParts, temperature: 0 });
    const firstValidation = validateBlindJudgeJson(first.value);
    let accepted = firstValidation.accepted;
    let result = first;
    let providerInvocationCount = 1;
    let validationRepair = blindValidationRepair("none", null, []);
    if (!accepted) {
      const rejectedResponseSha256 = first.contentSha256 ?? contentHash(first.value);
      const mode = firstValidation.validWinner ? "format-completion" as const : "full-rejudge" as const;
      const lockedWinner = firstValidation.validWinner ?? null;
      const repairSystem = mode === "format-completion"
        ? `${system} This is format completion, not a new judgment. Preserve lockedWinner exactly and only repair missing or invalid JSON fields.`
        : `${system} The prior winner field was invalid. Rejudge the same neutral anonymous A/B evidence once without assuming any prior conclusion.`;
      const repair = await this.client.generate<unknown>({
        system: repairSystem,
        parts: [
          { text: JSON.stringify({
            validationRepair: {
              mode,
              invalidFields: firstValidation.invalidFields,
              rejectedResponseSha256,
              lockedWinner,
              exactOutputShape: exactShape,
            },
          }) },
          ...evidenceParts,
        ],
        temperature: 0,
      });
      const repairValidation = validateBlindJudgeJson(repair.value);
      if (lockedWinner && repairValidation.accepted?.winner !== lockedWinner && !repairValidation.invalidFields.includes("winner")) {
        repairValidation.invalidFields.push("winner");
        repairValidation.invalidFields.sort(codeUnitCompare);
        repairValidation.accepted = undefined;
      }
      if (!repairValidation.accepted) {
        const secondDigest = repair.contentSha256 ?? contentHash(repair.value);
        throw new ContractError(`Gemini blind judge failed bounded JSON repair; judgeInvocations=2; invalidFields=${repairValidation.invalidFields.join(",")}; rejectedResponseDigests=${rejectedResponseSha256},${secondDigest}`);
      }
      accepted = repairValidation.accepted;
      result = repair;
      providerInvocationCount = 2;
      validationRepair = blindValidationRepair(mode, rejectedResponseSha256, firstValidation.invalidFields);
    }
    return {
      winner: accepted.winner,
      confidence: accepted.confidence,
      rationale: accepted.rationale.map((item) => redactText(item)),
      dimensionDeltas: accepted.dimensionDeltas,
      judge: { kind: "model", provider: "google", model: this.client.model, responseId: result.responseId },
      providerInvocationCount,
      validationRepair,
    };
  }
}
