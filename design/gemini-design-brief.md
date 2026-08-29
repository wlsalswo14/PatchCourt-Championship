# PatchCourt — Gemini 3.6 Flash design brief

You are the design authority for a Korean AI product named **PatchCourt**. Produce a complete, implementation-ready product UI specification and a runnable single-file HTML/CSS/JS concept. This is a real hackathon demo, not a marketing landing page.

## Product thesis

AI can create code quickly, but someone must prove that a patch actually improves the user outcome without regressions. PatchCourt puts AI-generated patches on trial. A browser agent reenacts a concrete user mission, collects screenshot/DOM/network evidence, a prosecutor and defender argue only from cited evidence, the system applies one atomic patch, replays the exact mission, performs a blind before/after comparison, and promotes the patch only when all gates pass. Failed patches remain as an auditable lineage.

## Audience and demo

- Korean AI Championship judges and online voters.
- The value must be obvious in 10 seconds and the full 60-second demo must have a dramatic payoff.
- Frozen championship journey: `BU01 / 브랜드-크리에이터 제안 여정`.
- Exact user path: brand operator login → Creator Directory → search market `US` → open `John Smith` → judge audience, verified channel, market fit, and next action → edit offer amount → reach send-ready state.
- Incumbent defects must be grounded in the owned fixture: a raw OAuth identifier is exposed, the profile shows `0 followers` / `TBD` instead of decision-useful trust evidence, and the main mobile action may be obstructed.
- Candidate patch direction: remove or mask the raw identifier, surface inspectable trust evidence for audience / verified channel / US market fit / next action, and keep the main mobile action accessible. Do not invent a checkout flow.
- No made-up numeric quality score is allowed. Until the real replay measures a value, show deterministic gate outcomes (`통과`, `실패`, or `측정 대기`) and observable evidence only.
- Promotion result may be `CHAMPION` only after the frozen journey and all critical gates actually pass, with a signed receipt hash.

## Required product surfaces

1. **Run dashboard** — candidate URL + user mission input, a visible six-stage run rail (`캡처 → 재현 → 변론 → 패치 → 재심 → 승격`), live evidence/event stream, primary CTA to start/replay a demo, progress and failure states.
2. **Evidence court** — a dense but readable evidence-first workspace. It must show the failing browser frame, numbered evidence pins, prosecutor/defender arguments with explicit citations, the issue verdict, and an inspectable event trail. Avoid generic card-grid dashboard composition.
3. **Before / after blind comparison** — same mission, two anonymous variants A/B, key screenshots, score delta, per-gate results, and a reveal action. Before reveal, do not identify which is patched. After reveal, show patched version and reason for promotion.
4. **Champion receipt** — a highly memorable ceremonial but credible completion state, suitable as the final 60-second demo frame. Include verdict, mission, exact gate results, timestamp, model/run identifier, source commit, receipt hash, and actions for JSON copy/download. It should feel like an immutable evidence receipt, not a confetti success modal.
5. **Mobile 390×844** — intentional responsive dashboard/evidence experience, not desktop squeezed into a phone. Preserve the primary action and critical verdict/evidence while allowing secondary detail to collapse.

## Information architecture and exact Korean copy

- Brand: `PATCHCOURT`
- Primary navigation: `재판`, `증거`, `비교`, `영수증`
- Workspace label: `BU01 / 브랜드-크리에이터 제안 여정`
- Dashboard heading: `좋아졌다는 말 대신, 증거를 남깁니다.`
- Dashboard supporting text: `같은 사용자 여정을 다시 실행하고, 회귀가 없을 때만 패치를 승격합니다.`
- Candidate URL label/value: `검증할 주소` / `http://localhost:4174`
- Mission label/value: `사용자 미션` / `브랜드로 로그인하고 US 크리에이터 John Smith를 검토한 뒤 제안 금액을 수정해 전송 준비 상태로 만드세요.`
- Main CTA: `증거 재판 시작`
- Secondary CTA: `60초 데모 재생`
- Live title: `실시간 재판 기록`
- Court heading: `결함은 주장으로 채택되기 전에 증명되어야 합니다.`
- Prosecutor: `검사 AI`
- Defender: `변호 AI`
- Judge: `판결 엔진`
- Verdict: `원시 OAuth 식별자가 노출되고, 제안 판단에 필요한 신뢰 근거가 비어 있음`
- Evidence reference format: `증거 E-01`, `증거 E-02`, etc.
- Blind comparison heading: `같은 여정에서 더 나은 쪽을 먼저 고릅니다.`
- Reveal CTA: `패치 정체 공개`
- Receipt heading: `CHAMPION`
- Receipt supporting line: `이 패치는 같은 여정을 통과했고, 새로운 회귀를 만들지 않았습니다.`
- Gate labels: `과업 완수`, `신뢰 근거`, `접근성`, `개인정보`, `회귀`
- Receipt actions: `영수증 복사`, `JSON 내려받기`, `다시 재판하기`

You may add terse Korean labels only where necessary for product comprehension. Do not add a hero eyebrow, decorative badges, fake customers, fake business metrics, pricing, testimonials, or a marketing feature grid.

## Art direction constraints

- One distinctive idea: **digital evidence docket meets contemporary Korean editorial design**. Not literal gavels, columns, scales of justice, robes, courthouse clip art, cyberpunk, neon sci-fi, glassmorphism, or purple gradients.
- Prefer paper-white or exact cool-neutral background, deep ink text, one hot vermilion prosecution accent, one restrained cobalt system accent, and a precise green only for an earned pass/champion state. State exact color tokens.
- Use strong typographic hierarchy and tabular numerals. Recommend free web fonts with Korean coverage and fallbacks.
- Use open rails, ruled evidence sheets, tables, browser frames, margin annotations, and a single strong ceremonial receipt frame. Avoid nested cards and generic rounded bento tiles.
- Icons must be a coherent thin/medium outline family. No emoji or text glyph arrows.
- Motion should clarify stage changes, evidence pin focus, blind reveal, and champion seal. Include reduced-motion behavior.
- Accessibility: WCAG AA contrast, visible focus, keyboard navigation, minimum 44px touch targets.

## Implementation constraints

- React + Vite, CSS, code-native text and controls, no raster screenshot used as the UI.
- No paid assets. No dependency-heavy charting library. CSS/SVG is acceptable for UI diagrams and evidence annotations.
- The prototype must be runnable as one standalone HTML file with inline CSS and JS and switch among the four desktop surfaces plus a mobile simulation selector.
- The production implementation will use a local mock adapter now and swap to a real API contract later.

## Required JSON response

Return valid JSON only, with these top-level keys:

- `designRationale`: short rationale and the single visual idea.
- `designSystem`: exact tokens for colors, typography, spacing, radii, borders, shadows, motion, container widths, icon rules.
- `copyInventory`: all visible copy grouped by surface; preserve the supplied strings exactly.
- `screenSpecs`: one object each for `dashboard`, `court`, `comparison`, `receipt`, and `mobile`, including 1440×960 or 390×844 layout geometry, hierarchy, components, states, responsive rules, and interaction notes.
- `componentFamilies`: reusable React component families and variants.
- `workflow`: deterministic 60-second interaction/storyboard with timestamps.
- `accessibility`: implementation checklist.
- `htmlPrototype`: a complete standalone HTML document as one JSON string. It must visually render all required screens, default to the dashboard, provide working navigation, a working `60초 데모 재생` that advances through stages, a comparison reveal action, and a receipt state. Use only inline CSS/JS and no external image dependencies. Korean text must be readable.
- `acceptanceChecklist`: at least 20 concrete visual/interaction checks.

The result is the source of truth. Be opinionated, specific, compact, and implementation-feasible.
