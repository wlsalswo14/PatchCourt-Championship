# PatchCourt submission draft

> This draft is a claim contract. Every statement below must be backed by the final deployment or a checked-in artifact before submission.

## One-line pitch

AI가 고친 UI를 감으로 배포하지 않습니다. PatchCourt는 동일한 사용자 여정을 실제 브라우저에서 재판해, 증거로 이긴 패치만 승격합니다.

## Problem

생성형 AI는 UI 코드를 빠르게 바꾸지만, 그 변경이 사용자의 일을 실제로 더 잘 끝내게 했는지는 증명하지 못합니다. 보기 좋은 스크린샷이나 모델의 자기평가는 기능 회귀, 개인정보 노출, 모바일 깨짐, 잘못된 자동 실행을 놓칠 수 있습니다. 팀은 결국 빠른 생성과 느린 검증 사이에서 병목을 겪습니다.

## Solution

PatchCourt는 개선 요청을 하나의 동결된 사용자 과제로 바꾸고 다음 절차를 실행합니다.

1. 소유권과 안전 경계를 확인하고 소스와 과제 fingerprint를 봉인합니다.
2. incumbent에서 같은 과제를 desktop/mobile 실제 브라우저로 수행하고 스크린샷, DOM, 접근성, 콘솔, 네트워크 증거를 해시합니다.
3. 서로 다른 역할의 AI critic이 오직 해당 증거를 인용해 원자적 결함을 제기합니다.
4. 허용된 파일 경계 안에서만 candidate patch를 만듭니다.
5. candidate에 정확히 같은 과제를 다시 수행합니다.
6. 기능, 보안, 개인정보, 접근성, 반응형 필수 게이트를 먼저 판정합니다.
7. 게이트를 통과한 경우에만 A/B 정체를 가린 비교를 수행합니다.
8. 더 나은 사용자 결과가 엄격히 증명된 경우에만 candidate를 champion으로 승격하고, 전 과정을 검증 가능한 receipt로 남깁니다.

## Breakthrough

핵심은 `counterfactual user-outcome ledger`입니다. 일반적인 AI 코딩 도구가 “무엇을 바꿨는가”를 기록한다면 PatchCourt는 “같은 사용자가 같은 일을 했을 때 무엇이 달라졌는가”를 해시 연결된 증거로 기록합니다. 따라서 더 그럴듯한 코드가 아니라 더 나은 결과가 배포 단위가 됩니다.

## Championship task

PC01/BU01은 브랜드 담당자가 Creator Directory에서 `US`를 검색하고 `John Smith`를 열어 audience, verified channel, market fit, next action을 판단한 뒤 제안 금액을 `$1,500`으로 수정하고, 외부 전송 없이 draft만 준비하는 여정입니다. 동일 과제를 1280x720과 390x844에서 재생합니다.

## How AI is used

- Gemini 3.6 Flash: visual direction and implementation-ready design specification.
- Evidence-grounded critics: design/usability, accessibility/privacy, and task-success perspectives. Unsupported findings are rejected before patching.
- Patch synthesis: accepted atomic findings and protected behaviors are converted into a bounded candidate change.
- Blind semantic judge: anonymous A/B evidence is compared only after deterministic critical gates pass.
- Codex: repository implementation, integration, tests, browser verification, and deployment workflow.

Deterministic checks remain outside model discretion: ownership, loopback/public-target policy, exact replay fingerprint, artifact hashes, effect-free draft behavior, console/network health, responsive overflow, protected files, and promotion arithmetic.

## Technology

React, TypeScript, Vite, Node.js, Playwright, JSON Schema, SHA-256 canonical receipts, Gemini 3.6 Flash, and Codex.

## Who needs it

- AI 제품팀: 생성 속도는 빨라졌지만 회귀 검증과 승인 병목이 커진 팀
- 디자인 시스템/프론트엔드 플랫폼 팀: 리뷰 의견을 재현 가능한 acceptance check로 바꾸려는 팀
- 에이전트 플랫폼 운영자: “모델이 좋아 보인다고 했다”가 아니라 실제 사용자 결과로 배포 권한을 통제하려는 팀

PatchCourt는 코드 생성기를 대체하지 않습니다. 어떤 생성기 뒤에도 붙일 수 있는 evidence-and-release control plane입니다.

## Technical differentiators

1. **Counterfactual user-outcome ledger** — 동일 task fingerprint, 동일 viewport, 대칭 artifact shape로 incumbent/candidate를 비교합니다.
2. **Sealed fact grounding** — raw-byte facts digest와 changed-leaf→fact-ID map으로 근거 없는 factual leaf가 accepted candidate나 promotion receipt에 진입하지 못하게 합니다.
3. **Hybrid critic provenance** — deterministic metric sentinel 3개와 Gemini 역할 critic 3개를 구분하고, 0건 반환 호출까지 제안/채택/기각 수로 영수증에 남깁니다.
4. **Gate-first blind judgment** — 13개 critical gate 중 하나라도 실패하면 judge invocation은 0입니다. 통과 후에도 arm order를 먼저 commit한 뒤 익명 A/B만 보여줍니다.
5. **Bounded validation repair** — candidate와 judge 모두 계약 오류를 한 번만 수선할 수 있습니다. rejected raw는 저장하지 않고 SHA와 안전한 오류 필드만 봉인합니다.
6. **Three terminal truths** — 개선 실패는 `rejected`, 실행/증거 불능은 `invalid`, 엄격한 결과 개선만 `promoted`입니다.

## Verified live breakthrough

Gemini 3.6 Flash live run `pc01-edaaca75-c913-4a20-8885-4b58e87163fe`는 다음 전 과정을 실제로 완주했습니다.

- desktop/mobile incumbent + candidate browser artifacts: 44
- compiled evidence-grounded findings: 7
- sealed critic provenance entries: 6
- bounded candidate synthesis: schema-validated and fact-grounded
- sealed verified-facts and leaf grounding: verified
- deterministic critical gates: 13 / 13 pass
- blind model judgment: 1 provider call, first response valid
- canonical decision: `promote`

## Feasibility and scale

현재 vertical slice는 한 개의 소유 synthetic 앱과 한 개의 고정 task를 깊게 검증합니다. 확장은 다음 port 경계로 이루어집니다.

- target manifest adapter: 소유 앱·task steps·critical invariants·patch boundary 추가
- browser actor: 같은 evidence schema를 유지한 채 앱별 action driver 추가
- critic/patch/judge provider: core state machine을 바꾸지 않고 모델 교체
- artifact store/run repository: 로컬 파일에서 object storage/DB로 교체
- task suite: run 단위 병렬화, 앱 단위 queue와 비용/시간 budget 적용

모델 호출은 semantic critique, synthesis, blind preference에만 사용하고, 나머지 보안·무결성·회귀 판단은 결정론적으로 유지하므로 비용과 신뢰 경계를 분리할 수 있습니다.

## Public demo truth boundary

공개 정적 배포는 credential-free verified replay입니다. canonical receipt SHA를 브라우저에서 다시 계산한 뒤 promotion과 deliberate rejection을 탐색할 수 있고, 정적 모드에서는 API probe를 0회로 유지하며 live CTA를 명시적으로 비활성화합니다. 실제 Gemini mode는 키를 브라우저에 보내지 않는 operator-side API에서만 실행됩니다.

## Presenter-led 60-second walkthrough

The button labeled `60초 데모 시나리오 압축 재생` compresses the logical
00:00–01:00 court timeline into roughly five seconds. The presenter controls the
following one-minute explanation around the actual screens:

- 00–08s: Explain the problem and the public verified-replay boundary: no credential and zero live provider/API calls.
- 08–22s: Open Evidence Court and inspect the three browser-grounded evidence pins and their acceptance checks.
- 22–38s: Show the sealed A/B comparison, order commitment, 13 critical gates, and manually reveal the committed mapping.
- 38–52s: Open the Champion receipt and verify PC01 40→100, 13/13 gates, provider provenance, and SHA-256 lineage.
- 52–60s: Open the deliberate rejection: one responsive gate fails, judge invocation remains 0, and the incumbent is retained.

## Proof bundle required before submission

- Public deployment URL and health check
- Clean promotion receipt
- Clean rejection receipt where the incumbent remains protected
- Desktop and mobile screenshots for both variants
- Console, network, DOM, accessibility, and trace evidence
- Model/provider metadata without credentials
- Receipt schema validation and tamper test
- Cold-start 60-second walkthrough
