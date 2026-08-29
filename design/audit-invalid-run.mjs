import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const MODEL = "models/gemini-3.6-flash";
const API_MODEL = "gemini-3.6-flash";
const SECRET_NAME = "GEMMA_API_KEY";
const root = resolve(import.meta.dirname, "..");
const secretFile = process.env.PATCHCOURT_SECRET_FILE;
const secretLine = secretFile
  ? (await readFile(secretFile, "utf8")).split(/\r?\n/u).find((line) => line.startsWith(`${SECRET_NAME}=`))
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

const prompt = `You are Gemini 3.6 Flash, the binding PatchCourt visual design authority. Design one bounded terminal INVALID RUN state within the existing cool paper-white #F8F9FA, ink #111827, 1px ruled-border, sharp-corner court/docket UI.

Truth constraints:
- INVALID is neither promotion nor rejection. Never say candidate rejected, never call either arm a winner, never call this a canonical promotion/rejection receipt.
- A provider/infrastructure/contract failure ended the run before a valid verdict. Blind comparison and promotion were not completed. Incumbent remains unchanged by default.
- Show opaque run ID, internal terminal receipt ID if present, status=invalid, sanitized failure code/stage/message, and execution provenance if available.
- Do not show recorded scores, findings, artifacts, 13/13 gates, hashes from another run, or A/B assets.
- Actions: retry locally, return to verified replay. No JSON canonical-receipt copy/download claim.
- 390x844 mobile, 44px targets, no overflow, screen-reader announcement.
- Preserve existing palette. You may choose only ink, cobalt, vermilion, green, and their existing soft tints; explain the semantic accent. No amber/purple/emoji/gradient.

Return valid JSON only under 3000 characters with: verdict, semanticAccent, exactKoreanCopy, hero, truthRows, prohibitedClaims, actions, mobileRules, accessibilityChecks, acceptanceChecklist.`;

const body = JSON.stringify({
  contents: [{ role: "user", parts: [{ text: prompt }] }],
  generationConfig: {
    temperature: 0.2,
    maxOutputTokens: 3_000,
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
        headers: { "content-type": "application/json; charset=utf-8", "x-goog-api-key": apiKey },
        body,
        signal: AbortSignal.timeout(90_000),
      },
    );
    if (candidate.ok) {
      response = candidate;
      break;
    }
    if (candidate.status !== 429 && candidate.status !== 503) {
      throw new Error(`Gemini invalid run audit failed with HTTP ${candidate.status}`);
    }
  } catch (error) {
    if (error?.name !== "TimeoutError") throw error;
  }
}
if (!response) throw new Error(`Gemini invalid run audit exhausted ${attemptCount} local credentials`);
const envelope = await response.json();
const text = envelope?.candidates?.[0]?.content?.parts?.[0]?.text;
if (!text) throw new Error("Gemini invalid run audit returned no text");
const parsed = JSON.parse(text);
if (!parsed.exactKoreanCopy || !parsed.prohibitedClaims || !parsed.truthRows) {
  throw new Error("Gemini invalid run audit is missing required truth decisions");
}
await writeFile(resolve(root, "design/invalid-run.json"), `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
const finishedAt = new Date();
const metadata = {
  model: MODEL,
  mode: "terminal-invalid-run",
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  requestCharacters: prompt.length,
  responseCharacters: text.length,
  finishReason: envelope?.candidates?.[0]?.finishReason ?? "UNKNOWN",
  outputFile: "../invalid-run.json",
  attemptCount,
};
await writeFile(resolve(root, "design/raw/generation-invalid-run-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ model: MODEL, ...metadata }));
