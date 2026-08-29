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
  secretLine
    ?.slice(SECRET_NAME.length + 1)
    .trim()
    .replace(/^['"]|['"]$/gu, ""),
  process.env.OUROBOROS_GEMINI_API_KEY_PRIMUX,
  process.env.OUROBOROS_GEMINI_API_KEY_PIEPINEAPPLE,
  process.env.OUROBOROS_GEMINI_API_KEY_MINJAEJIN,
  process.env.OUROBOROS_GEMINI_API_KEY_WLSALSWO14,
  process.env.OUROBOROS_GEMINI_API_KEY_BTEAM,
].filter(Boolean);
if (apiKeys.length === 0) throw new Error("A local Gemini credential is required");

const prompt = `You are Gemini 3.6 Flash, the binding PatchCourt visual design authority. Perform a narrow mobile-only repair audit of the observed 390x844 render from your own concept.

Observed failures:
1. Four Korean navigation labels wrap one character per line and consume the header.
2. The six-stage run rail is clipped after stage 3 and gives no scroll or remaining-step affordance.

Preserve the desktop design, Korean copy, cool paper-white #F8F9FA canvas, #111827 ink, 1px ruled borders, sharp 0–4px radii, Pretendard/system typography, exact navigation order, six stage order, and 44px touch targets. Do not redesign content below the rail. No hamburger that hides the primary product views, no emoji, no new marketing copy, and no invented outcome.

Return valid JSON only with: verdict, repairedHeaderGeometry, repairedNavigation (exact labels, dimensions, selected/focus states), repairedRunRail (counter, overflow/fade/scroll-snap behavior, dimensions, selected centering), exactCssRules, reactBehavior, accessibilityChecks, acceptanceChecklist. Be implementation exact and under 3500 characters.`;

const startedAt = new Date();
const requestBody = JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 3_500,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel: "minimal" },
      },
    });
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
      throw new Error(`Gemini mobile audit failed with HTTP ${candidate.status}`);
    }
  } catch (error) {
    if (error?.name !== "TimeoutError") throw error;
  }
}
if (!response) {
  throw new Error(`Gemini mobile audit exhausted ${attemptCount} local credentials`);
}
const envelope = await response.json();
const text = envelope?.candidates?.[0]?.content?.parts?.[0]?.text;
if (!text) throw new Error("Gemini mobile audit returned no text");
const parsed = JSON.parse(text);
if (!parsed.repairedNavigation || !parsed.repairedRunRail) {
  throw new Error("Gemini mobile audit is missing required repair decisions");
}
await writeFile(
  resolve(root, "design/mobile-repair.json"),
  `${JSON.stringify(parsed, null, 2)}\n`,
  "utf8",
);
const finishedAt = new Date();
const metadata = {
  model: MODEL,
  mode: "mobile-concept-repair",
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  requestCharacters: prompt.length,
  responseCharacters: text.length,
  finishReason: envelope?.candidates?.[0]?.finishReason ?? "UNKNOWN",
  outputFile: "../mobile-repair.json",
  attemptCount,
};
await writeFile(
  resolve(root, "design/raw/generation-mobile-repair-metadata.json"),
  `${JSON.stringify(metadata, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify({ model: MODEL, ...metadata }));
