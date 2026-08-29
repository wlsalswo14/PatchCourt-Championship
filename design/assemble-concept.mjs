import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const rawPath = resolve(
  root,
  "design/raw/gemini-3.6-flash-prototype.html",
);
const outputPath = resolve(root, "design/concept.html");
let html = await readFile(rawPath, "utf8");

const factualSubstitutions = [
  ["CHAMPION VERIFIED", "VERDICT PREVIEW"],
  ["usr_live_9920384711_raw_token", "브라우저 증거 캡처 후 표시"],
  ["구독자: 0명 | 검증 여부: TBD", "결함 관찰값: 실제 리플레이에서 바인딩"],
  ["ID: usr_live_9920384711", "ID: 실제 리플레이에서 바인딩"],
  ["Followers: 0", "Audience: 실제 리플레이에서 바인딩"],
  ["Verified: TBD", "Verified: 실제 리플레이에서 바인딩"],
  ["ID: usr_live_****_711", "ID: 비식별 상태를 실제 리플레이에서 검증"],
  ["Followers: 142.5K (US Fit)", "Audience: 실제 리플레이에서 바인딩"],
  ["Verified: Official Partner", "Verified: 실제 리플레이에서 바인딩"],
  [">CHAMPION</", ">VERDICT PENDING</"],
  [
    "이 패치는 같은 여정을 통과했고, 새로운 회귀를 만들지 않았습니다.",
    "실제 리플레이와 모든 임계 게이트가 끝나면 이 영수증이 발급됩니다.",
  ],
  [
    "RECEIPT HASH: sha256:8f9a2b1c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0",
    "RECEIPT HASH: 실제 리플레이 완료 후 표시",
  ],
  [
    "COMMIT: 04d82f1a (patched_trust_mask_bu01)",
    "PATCH DIGEST: 실제 리플레이 완료 후 표시",
  ],
  [
    "TIMESTAMP: <span id=\"receipt-timestamp\">2025-05-20T10:00:00Z</span>",
    "ISSUED AT: <span id=\"receipt-timestamp\">실제 리플레이 완료 후 표시</span>",
  ],
  [
    "승격 결정: 모든 게이트 통과 (CHAMPION)",
    "판결 대기: 실제 리플레이 영수증 필요",
  ],
  ["usr_live_****_711", "비식별 상태 검증 대기"],
  [
    "구독자: 142.5K | 검증 여부: Official Partner",
    "신뢰 근거: 실제 리플레이에서 바인딩",
  ],
  [
    "변종 B (PATCHED - CHAMPION)",
    "변종 B (정체 공개 · 판결 대기)",
  ],
  ["verdict: \"CHAMPION\"", "verdict: \"PENDING\""],
  [
    "hash: \"sha256:8f9a2b1c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0\"",
    "hash: null",
  ],
  ["commit: \"04d82f1a\"", "commit: null"],
  [
    "gates: { task: \"PASS\", trust: \"PASS\", accessibility: \"PASS\", privacy: \"PASS\", regression: \"PASS\" }",
    "gates: { status: \"PENDING_REAL_REPLAY\" }",
  ],
  [
    "document.getElementById('receipt-timestamp').textContent = new Date().toISOString();",
    "document.getElementById('receipt-timestamp').textContent = '실제 리플레이 완료 후 표시';",
  ],
];

for (const [from, to] of factualSubstitutions) {
  html = html.replaceAll(from, to);
}

html = html
  .replaceAll('badge-status badge-pass">통과', 'badge-status badge-pending">측정 대기')
  .replaceAll('badge-status badge-fail"', 'badge-status badge-pending"')
  .replaceAll(">실패</span>", ">측정 대기</span>")
  .replace(
    "document.getElementById('var-b').classList.add('champion');",
    "document.getElementById('var-b').classList.remove('champion');",
  )
  .replace(
    "document.getElementById('tag-b').style.background = 'var(--accent-judge-bg)';",
    "document.getElementById('tag-b').style.background = 'var(--bg-subtle)';",
  )
  .replace(
    "document.getElementById('tag-b').style.color = 'var(--accent-judge)';",
    "document.getElementById('tag-b').style.color = 'var(--text-secondary)';",
  );

const forbidden = ["142.5K", "8f9a2b1c", "04d82f1a", "2025-05-20"];
for (const value of forbidden) {
  if (html.includes(value)) {
    throw new Error(`Unsupported factual seed remained in concept: ${value}`);
  }
}

await writeFile(outputPath, html, "utf8");
console.log(
  JSON.stringify({
    source: "gemini-3.6-flash-prototype.html",
    output: "concept.html",
    factualSubstitutionCount: factualSubstitutions.length,
    designChanges: 0,
  }),
);
