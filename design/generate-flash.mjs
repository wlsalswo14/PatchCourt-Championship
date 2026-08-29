import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const MODEL = "models/gemini-3.6-flash";
const API_MODEL = "gemini-3.6-flash";
const SECRET_NAME = "GEMMA_API_KEY";
const mode = process.argv[2];
const root = resolve(import.meta.dirname, "..");
const rawDir = resolve(import.meta.dirname, "raw");

if (mode !== "spec" && mode !== "prototype") {
  throw new Error("Usage: node design/generate-flash.mjs <spec|prototype>");
}

const secretFile = process.env.PATCHCOURT_SECRET_FILE;
if (!secretFile) {
  throw new Error("PATCHCOURT_SECRET_FILE is required");
}

const secretText = await readFile(secretFile, "utf8");
const secretLine = secretText
  .split(/\r?\n/u)
  .find((line) => line.startsWith(`${SECRET_NAME}=`));
const apiKey = secretLine
  ?.slice(SECRET_NAME.length + 1)
  .trim()
  .replace(/^['"]|['"]$/gu, "");

if (!apiKey) {
  throw new Error(`${SECRET_NAME} is missing from the local secret file`);
}

const brief = await readFile(resolve(root, "design/gemini-design-brief.md"), "utf8");
const specPath = resolve(rawDir, "gemini-3.6-flash-design-spec.json");

const specInstruction = `

This is pass 1 of 2. Return valid JSON only. For this pass, omit htmlPrototype entirely and return exactly these top-level keys: designRationale, designSystem, copyInventory, screenSpecs, componentFamilies, workflow, accessibility, acceptanceChecklist. Preserve BU01. Never output made-up numeric quality scores. Be compact enough to fit the response budget.`;

const prototypeInstruction = (spec) => `You are continuing the exact PatchCourt design you authored in pass 1.
Return only a complete standalone HTML document beginning with <!doctype html> and ending with </html>. Do not use Markdown fences and do not append notes. Use inline CSS and JS and no external image or library dependency.

Keep the entire response below 32,000 characters. Render one selected screen at a time and reuse compact CSS component classes. Do not include base64, long SVG paths, comments, reset styles, repeated inline styles, or repetitive seeded rows. Keep JavaScript under 60 lines. The purpose is a precise visual concept, not production source.

The HTML must implement working navigation among 재판, 증거, 비교, 영수증; a working 60초 데모 재생 control that visibly progresses through the frozen BU01 stages; evidence focus; blind comparison reveal; receipt copy/download feedback; and an intentional mobile layout. Default to 재판. Preserve the supplied Korean copy and never add fake numeric scores or a checkout journey.

DESIGN BRIEF:
${brief}

YOUR PASS 1 DESIGN SPEC:
${spec}`;

const prompt =
  mode === "spec"
    ? `${brief}${specInstruction}`
    : prototypeInstruction(await readFile(specPath, "utf8"));
const maxOutputTokens = mode === "spec" ? 12_000 : 18_000;
const body = {
  contents: [{ role: "user", parts: [{ text: prompt }] }],
  generationConfig: {
    temperature: mode === "spec" ? 0.68 : 0.35,
    topP: 0.9,
    maxOutputTokens,
    responseMimeType: mode === "spec" ? "application/json" : "text/plain",
    thinkingConfig: { thinkingLevel: "minimal" },
  },
};

const startedAt = new Date();
const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${API_MODEL}:generateContent`,
  {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(240_000),
  },
);

if (!response.ok) {
  throw new Error(`Gemini request failed with HTTP ${response.status}`);
}

const envelope = await response.json();
const text = envelope?.candidates?.[0]?.content?.parts?.[0]?.text;
if (!text) {
  throw new Error("Gemini returned no text content");
}

let prototypeText = text.trim();
if (mode === "prototype" && prototypeText.startsWith("```")) {
  prototypeText = prototypeText
    .replace(/^```(?:html)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();
}
const parsed = mode === "spec" ? JSON.parse(text) : null;
if (mode === "spec" && parsed.htmlPrototype) {
  throw new Error("Spec response unexpectedly included htmlPrototype");
}
if (
  mode === "prototype" &&
  (!prototypeText.toLowerCase().startsWith("<!doctype html") ||
    !prototypeText.toLowerCase().endsWith("</html>"))
) {
  await mkdir(rawDir, { recursive: true });
  const partialPath = resolve(
    rawDir,
    `gemini-3.6-flash-prototype-partial-${Date.now()}.html`,
  );
  await writeFile(
    partialPath,
    `${prototypeText}\n`,
    "utf8",
  );
  await writeFile(
    resolve(rawDir, `generation-prototype-partial-${Date.now()}.json`),
    `${JSON.stringify(
      {
        model: MODEL,
        mode,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        requestCharacters: prompt.length,
        responseCharacters: prototypeText.length,
        finishReason: envelope?.candidates?.[0]?.finishReason ?? "UNKNOWN",
        outputFile: basename(partialPath),
        valid: false,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  throw new Error(
    `Prototype response is incomplete; finish=${envelope?.candidates?.[0]?.finishReason ?? "UNKNOWN"}; chars=${prototypeText.length}`,
  );
}

await mkdir(rawDir, { recursive: true });
const outputPath =
  mode === "spec"
    ? specPath
    : resolve(rawDir, "gemini-3.6-flash-prototype.html");
await writeFile(
  outputPath,
  mode === "spec" ? `${JSON.stringify(parsed, null, 2)}\n` : `${prototypeText}\n`,
  "utf8",
);

const finishedAt = new Date();
const metadata = {
  model: MODEL,
  mode,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  requestCharacters: prompt.length,
  responseCharacters: text.length,
  finishReason: envelope?.candidates?.[0]?.finishReason ?? "UNKNOWN",
  promptTokens: envelope?.usageMetadata?.promptTokenCount ?? null,
  outputTokens: envelope?.usageMetadata?.candidatesTokenCount ?? null,
  outputFile: basename(outputPath),
};
await writeFile(
  resolve(rawDir, `generation-${mode}-metadata.json`),
  `${JSON.stringify(metadata, null, 2)}\n`,
  "utf8",
);

console.log(
  JSON.stringify({
    model: MODEL,
    mode,
    finishReason: metadata.finishReason,
    durationMs: metadata.durationMs,
    requestCharacters: metadata.requestCharacters,
    responseCharacters: metadata.responseCharacters,
    outputFile: metadata.outputFile,
  }),
);
