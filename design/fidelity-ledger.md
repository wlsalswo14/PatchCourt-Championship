# PatchCourt design fidelity ledger

## Authority

- Design model: `models/gemini-3.6-flash`
- Structured spec: `raw/gemini-3.6-flash-design-spec.json`
- Standalone prototype: `raw/gemini-3.6-flash-prototype.html`
- Production concept: `concept.html`

## Raw → concept deviations

| Area | Raw evidence | Concept / production decision | Classification |
|---|---|---|---|
| Candidate audience | Raw prototype invented `142.5K` | Replace with replay-bound placeholder until a current validated PC01 receipt exists | Factual substitution only; no visual redesign |
| Receipt identifiers | Raw prototype invented a hash, commit, and timestamp | Replace with replay-bound placeholders; bind only API/validated receipt values | Factual substitution only; no visual redesign |
| Gate outcomes | Raw prototype predeclared pass/fail and champion | Render `측정 대기` until the deterministic gate report and receipt are present | Factual substitution only; no visual redesign |
| OAuth evidence | Raw prototype included a fabricated opaque identifier | Render a bounded evidence placeholder; production reads sanitized artifact observations only | Security-safe factual substitution; no visual redesign |
| Receipt seal | Raw prototype used a champion seal before a current receipt existed | Keep the same receipt geometry but use `VERDICT PENDING`; switch to `CHAMPION` only from a promoted receipt | State correction; no visual redesign |
| Muted small text | Flash specified `#9CA3AF`; the first production pass used `#8B95A4`, only `3.03:1` on white | Use `#667085`, which is `4.98:1` on white and remains at least `4.52:1` on the approved subtle surfaces | Objective WCAG AA correction; no layout redesign |

## Fixture audit

- Flash audit output: `fixture-review.json`
- Critical mismatch: the skip link appeared in the content after draft success.
- Required fix: candidate skip link remains offscreen except when directly keyboard-focused; successful draft submission focuses `[data-testid="draft-status"]`.
- Incumbent seeded defects, data values, task order, test IDs, and local-only draft behavior are protected.

### Applied and reverified

- Status: **applied** by the fixture owner and independently inspected.
- Visual evidence: `docs/evidence/latest/candidate-mobile-draft.png` no longer shows the skip link in content.
- Focus evidence: `candidate-mobile-accessibility.json` records `activeTestId: draft-status`, `skipLinkFocused: false`, and an offscreen skip-link rectangle at `-1201..-1200px`.
- Responsive evidence: the primary action is `324×44px`, matches its peer control width, and horizontal overflow is `0px` at `390×844`.
- Current replay receipt: `receipt-pc01-20260829165215`; payload `1f1d1b0d437fb483a5b39b5add9a9f33e7725298a28fbc618d15d6fd2cb6bf11`; task fingerprint `49b3dd5a1edf7a6b2c77e9c49c4f999c34b3e040093203508e1bdffa87a352ef`; facts packet `c1fc28e2027abda3b717cc971f3865d0e6686ea9b82c9b38bcbd099c1787fb90`; candidate critical gates `13/13`; failed candidate gates `0`.
- Current clean rejection receipt: `receipt-pc01-rejection-20260829165222`; payload `4b33f1dc7922eab724c96b28397ee3e035b06799bbf022aaac231be8853dcb08`; failed critical gate `responsive_primary_action`; blind invocation count `0`; incumbent retained.

## Pending implementation comparison

The final React screenshots must be checked against `concept.html` for:

1. paper-white / ink / vermilion / cobalt / earned-green palette;
2. open ruled docket layout instead of nested card grids;
3. six-stage progress rail and exact Korean navigation;
4. browser evidence frame with numbered pins and citation coupling;
5. anonymous A/B identity before reveal;
6. receipt geometry and hash lineage typography;
7. 390×844 single-column information priority;
8. visible focus and 44px mobile controls.

## Mobile-only repair authority

- Flash output: `mobile-repair.json`
- Model / finish: `models/gemini-3.6-flash` / `STOP`
- Accepted geometry: a 56px brand header plus a separate 44px horizontally scrolling navigation rail; every Korean label stays on one line.
- Accepted progress behavior: one-line `현재 / 06 단계` counter, horizontal scroll, scroll snap, a 24px right fade, and automatic centering of the active step.
- Copy precedence: the repair pass proposed unrelated generic legal labels. The earlier full-app Flash spec remains authoritative for product copy, so production preserves `재판 · 증거 · 비교 · 영수증` and `캡처 · 재현 · 변론 · 패치 · 재심 · 승격` while applying only the later pass's mobile geometry and interaction repair.

## Canonical rejection receipt authority

- Flash output: `rejection-receipt.json`
- Model / finish: `models/gemini-3.6-flash` / `STOP`
- Accepted state: `Candidate Rejected` and `Incumbent Retained` are the primary verdict; failed critical gates and their observations precede the blind-comparison short-circuit; `invocationCount: 0` and the exact `invalidReason` remain visible; execution and SHA-256 lineage stay copyable.
- Objective WCAG correction: Flash specified `#DC2626` for small text on `#FEF2F2`, whose computed contrast is approximately `4.415:1`, below WCAG AA's `4.5:1` threshold. Production preserves `#DC2626` for decorative borders but uses the darker vermilion `#B91C1C` for small rejection text. This is an accessibility correction, not a visual redesign.

## Terminal invalid-run authority

- Flash output: `invalid-run.json`
- Model / finish: `models/gemini-3.6-flash` / `STOP`
- Accepted state: neutral ink on `#F1F5F9`; exact title `판결불가 및 실행 무효 리포트`; explicitly no promotion, rejection, A/B winner, canonical receipt, borrowed score, gate, or evidence claim; incumbent remains unchanged; retry and verified-replay actions only.
- Factual substitutions: the Flash raw output invented example run/receipt IDs, cluster/node details, stage, provider code, and error text. Production keeps the exact visual hierarchy and state copy but binds those rows only to the current `receipt_ready` event and sanitized `GET /api/runs/:id` summary. This is a truth-bound factual substitution, not a visual redesign.

## Canonical judge validation-repair provenance

- The canonical receipt contract added `blindComparison.validationRepair` after the visual authority passes completed. Production preserves the Flash receipt geometry and adds only compact execution provenance: direct versus bounded repair, provider invocation count, invalid-field count, and the recomputable repair digest.
- Rejected model response content and judge rationale are never rendered. Only the SHA-256 seal and safe aggregate metadata participate in runtime verification and downloadable canonical JSON.
- State boundary: pre-gate invalid uses `none / 0`, valid or tie without repair uses `none / 1`, and a single bounded repair uses `format-completion|full-rejudge / 2`; all other combinations are rejected before rendering.
