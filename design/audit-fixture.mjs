import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const MODEL = "models/gemini-3.6-flash";
const API_MODEL = "gemini-3.6-flash";
const SECRET_NAME = "GEMMA_API_KEY";
const root = resolve(import.meta.dirname, "..");
const secretFile = process.env.PATCHCOURT_SECRET_FILE;
if (!secretFile) throw new Error("PATCHCOURT_SECRET_FILE is required");

const secretLine = (await readFile(secretFile, "utf8"))
  .split(/\r?\n/u)
  .find((line) => line.startsWith(`${SECRET_NAME}=`));
const apiKey = secretLine
  ?.slice(SECRET_NAME.length + 1)
  .trim()
  .replace(/^['"]|['"]$/gu, "");
if (!apiKey) throw new Error(`${SECRET_NAME} is missing from the local secret file`);

const [designSpec, html, css, js, mobileImage, desktopImage] = await Promise.all([
  readFile(resolve(root, "design/raw/gemini-3.6-flash-design-spec.json"), "utf8"),
  readFile(resolve(root, "demo/brand-match/public/index.html"), "utf8"),
  readFile(resolve(root, "demo/brand-match/public/styles.css"), "utf8"),
  readFile(resolve(root, "demo/brand-match/public/app.js"), "utf8"),
  readFile(resolve(root, "docs/evidence/latest/candidate-mobile-draft.png")),
  readFile(resolve(root, "docs/evidence/latest/candidate-desktop-draft.png")),
]);

const prompt = `You are Gemini 3.6 Flash, the binding visual design authority for the project-owned PatchCourt PC01 creator-match fixture. Audit only the candidate UI shown in the two screenshots and source below.

Frozen user path: brand demo login -> Creator Directory -> search US -> John Smith -> understand audience, verified channel, US market fit, and next action -> change fee to 1500 -> prepare an explicitly unsent local draft at desktop 1280x720 and mobile 390x844.

Hard constraints:
- Preserve all fixture semantics, browser locators, task order, local-only behavior, and evidence copy. Do not invent or change any metric or claim.
- Preserve every intentional incumbent data defect. Candidate-only visual fixes may be expressed with body[data-variant="candidate"] selectors or minimal focus JS.
- The current mobile screenshot visibly leaks the skip link inside the page after the success interaction. Define exact success-focus behavior: focus the role=status or its heading after render; the skip link may enter the viewport only when directly keyboard-focused at the true page top.
- The primary candidate action and unsent draft state must remain visible and operable at 390x844 without horizontal overflow.
- Keep the fixture visually distinct as a warm product surface, but make its evidence hierarchy compatible with PatchCourt's digital-evidence-docket system. Do not restyle it into the PatchCourt shell.
- No generic bento expansion, glassmorphism, purple gradient, emoji, fake badge, or decorative metric.

Return valid JSON only with: verdict, approvedTokens, strengths, mismatches (each with severity, screenshotEvidence, exactSelector, exactInstruction), focusContract, mobileLayoutContract, candidateOnlyPatchPlan, doNotChange, acceptanceChecklist. Make instructions executable and selector-specific.

PATCHCOURT DESIGN SPEC:
${designSpec}

FIXTURE INDEX.HTML:
${html}

FIXTURE STYLES.CSS:
${css}

FIXTURE APP.JS:
${js}`;

const startedAt = new Date();
const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${API_MODEL}:generateContent`,
  {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/png",
                data: mobileImage.toString("base64"),
              },
            },
            {
              inlineData: {
                mimeType: "image/png",
                data: desktopImage.toString("base64"),
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.28,
        topP: 0.9,
        maxOutputTokens: 9_000,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel: "minimal" },
      },
    }),
    signal: AbortSignal.timeout(240_000),
  },
);
if (!response.ok) throw new Error(`Gemini fixture audit failed with HTTP ${response.status}`);

const envelope = await response.json();
const text = envelope?.candidates?.[0]?.content?.parts?.[0]?.text;
if (!text) throw new Error("Gemini fixture audit returned no text");
const parsed = JSON.parse(text);
if (!Array.isArray(parsed.acceptanceChecklist) || !parsed.focusContract) {
  throw new Error("Gemini fixture audit is missing required sections");
}

await writeFile(
  resolve(root, "design/fixture-review.json"),
  `${JSON.stringify(parsed, null, 2)}\n`,
  "utf8",
);
const finishedAt = new Date();
const metadata = {
  model: MODEL,
  mode: "fixture-audit",
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  requestCharacters: prompt.length,
  responseCharacters: text.length,
  imageInputs: [
    "candidate-mobile-draft.png",
    "candidate-desktop-draft.png",
  ],
  finishReason: envelope?.candidates?.[0]?.finishReason ?? "UNKNOWN",
  promptTokens: envelope?.usageMetadata?.promptTokenCount ?? null,
  outputTokens: envelope?.usageMetadata?.candidatesTokenCount ?? null,
  outputFile: "../fixture-review.json",
};
await writeFile(
  resolve(root, "design/raw/generation-fixture-audit-metadata.json"),
  `${JSON.stringify(metadata, null, 2)}\n`,
  "utf8",
);
console.log(
  JSON.stringify({
    model: MODEL,
    finishReason: metadata.finishReason,
    durationMs: metadata.durationMs,
    responseCharacters: metadata.responseCharacters,
    mismatchCount: parsed.mismatches?.length ?? 0,
  }),
);
