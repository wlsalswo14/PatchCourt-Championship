import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const MODEL = "models/gemini-3.6-flash";
const API_MODEL = "gemini-3.6-flash";
const SECRET_NAME = "GEMMA_API_KEY";
const root = resolve(import.meta.dirname, "..");
const secretFile = process.env.PATCHCOURT_SECRET_FILE;
const secretLine = secretFile
  ? (await readFile(secretFile, "utf8"))
      .split(/\r?\n/u)
      .find((line) => line.startsWith(`${SECRET_NAME}=`))
  : undefined;
const apiKeys = [
  secretLine?.slice(SECRET_NAME.length + 1).trim().replace(/^['"]|['"]$/gu, ""),
  process.env.OUROBOROS_GEMINI_API_KEY_PRIMUX,
  process.env.OUROBOROS_GEMINI_API_KEY_PIEPINEAPPLE,
  process.env.OUROBOROS_GEMINI_API_KEY_MINJAEJIN,
  process.env.OUROBOROS_GEMINI_API_KEY_WLSALSWO14,
  process.env.OUROBOROS_GEMINI_API_KEY_BTEAM,
].filter(Boolean);
if (apiKeys.length === 0) throw new Error("A local Gemini credential is required");

const prompt = `You are Gemini 3.6 Flash, the binding PatchCourt visual design authority. Extend your existing court/docket design with one bounded canonical rejection receipt state.

Existing immutable design: cool paper-white #F8F9FA, ink #111827, 1px ruled borders, sharp 0–4px corners, Pretendard/system type, JetBrains Mono hashes, prosecution vermilion #DC2626, defense cobalt #2563EB, earned champion green only for promotion. Open ruled docket, not bento, glass, gradients, purple, emoji, or marketing art.

Truth contract to represent exactly:
- comparison.decision = reject; incumbent is retained, candidate is never called champion.
- One or more critical candidate gates can fail. Show the failed gate IDs and observations prominently.
- A clean short-circuit has blindComparison.status=invalid, invocationCount=0, invalidReason='not_called:critical_gate_failed:<gate>'. Explain that no model judge was invoked because deterministic safety gates failed first.
- Show receipt ID, task fingerprint, incumbent/candidate/patch/facts/payload SHA-256 lineage and execution provenance.
- Copy/download/retry actions remain.
- Mobile 390x844 must preserve 44px targets and no horizontal overflow.

Return valid JSON only, under 3500 characters, with: verdict, visualDeltaFromChampion, exactKoreanCopy, hero, summaryFields, failedGateTreatment, blindShortCircuitTreatment, lineageRows, actions, mobileRules, accessibilityChecks, acceptanceChecklist. Do not invent any score, hash, gate, provider, model, or run fact; use field placeholders. Exact copy must clearly say candidate rejected and incumbent retained.`;

const requestBody = JSON.stringify({
  contents: [{ role: "user", parts: [{ text: prompt }] }],
  generationConfig: {
    temperature: 0.2,
    maxOutputTokens: 3_500,
    responseMimeType: "application/json",
    thinkingConfig: { thinkingLevel: "minimal" },
  },
});
const startedAt = new Date();
let response;
let attemptCount = 0;
for (const apiKey of apiKeys) {
  attemptCount += 1;
  try {
    const candidate = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${API_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-goog-api-key": apiKey,
        },
        body: requestBody,
        signal: AbortSignal.timeout(90_000),
      },
    );
    if (candidate.ok) {
      response = candidate;
      break;
    }
    if (candidate.status !== 429 && candidate.status !== 503) {
      throw new Error(`Gemini rejection receipt audit failed with HTTP ${candidate.status}`);
    }
  } catch (error) {
    if (error?.name !== "TimeoutError") throw error;
  }
}
if (!response) throw new Error(`Gemini rejection audit exhausted ${attemptCount} local credentials`);
const envelope = await response.json();
const text = envelope?.candidates?.[0]?.content?.parts?.[0]?.text;
if (!text) throw new Error("Gemini rejection audit returned no text");
const parsed = JSON.parse(text);
if (!parsed.exactKoreanCopy || !parsed.failedGateTreatment || !parsed.blindShortCircuitTreatment) {
  throw new Error("Gemini rejection audit is missing required decisions");
}
await writeFile(resolve(root, "design/rejection-receipt.json"), `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
const finishedAt = new Date();
const metadata = {
  model: MODEL,
  mode: "canonical-rejection-receipt",
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  requestCharacters: prompt.length,
  responseCharacters: text.length,
  finishReason: envelope?.candidates?.[0]?.finishReason ?? "UNKNOWN",
  outputFile: "../rejection-receipt.json",
  attemptCount,
};
await writeFile(
  resolve(root, "design/raw/generation-rejection-receipt-metadata.json"),
  `${JSON.stringify(metadata, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify({ model: MODEL, ...metadata }));
