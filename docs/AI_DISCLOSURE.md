# AI tool disclosure

## Tools used to build PatchCourt

- **OpenAI Codex**: repository planning, architecture, implementation, code review, test orchestration, browser QA, documentation, and deployment preparation.
- **Google Gemini 3.6 Flash**: binding visual design specification, renderable concept, candidate-fixture screenshot audit, mobile-layout repair decision, and the optional live PatchCourt runtime described below.
- **Playwright**: deterministic browser execution and evidence capture. Playwright is automation, not a model.

## AI inside the product

PatchCourt exposes two explicitly labeled execution modes.

### Verified replay mode

This is the public-safe fallback. It replays checked-in artifacts from fresh isolated Chromium runs and uses deterministic reference critics, a bounded reference candidate, deterministic gates, and a paired comparator. It does **not** claim that a model generated the recorded patch. Its purpose is to keep the full product story inspectable without shipping a credential to the browser.

### Live Gemini mode

This local/server mode uses `gemini-3.6-flash` for three evidence-grounded critic roles, value-only candidate synthesis from a sealed synthetic fact packet, and multimodal blind A/B judgment. Three deterministic metric sentinels run alongside the three model roles; they are disclosed separately and never presented as AI opinions. The canonical receipt lists every invoked critic—including zero-finding critics—with proposed, accepted, and rejected counts and binds that list with independent digests.

Every changed candidate leaf must cite exact fact IDs (or prove it is a neutral presentation/safety edit); the grounding map is stored as a content-addressed artifact. A failed candidate contract receives at most one bounded repair attempt. The blind judge also has at most one JSON-contract repair: a valid first winner is locked for format completion, while an invalid winner permits one full rejudge against the same anonymous evidence. Actual provider invocation counts and repair metadata are sealed. Rejected raw model text is neither logged nor persisted—only its digest and structured validation reasons are retained. Model output cannot bypass deterministic ownership, task-fingerprint, artifact-integrity, fact-grounding, effect-boundary, accessibility, responsive, console, network, or regression gates.

The three critic roles are:

1. task outcome and design hierarchy;
2. accessibility and privacy;
3. adversarial functional/security regression.

The critics receive symmetric browser evidence and explicit artifact IDs. Findings without valid artifact references, an allowlisted patch locus, reproduction, acceptance checks, and regression risks are excluded from the implementation brief.

Provider or evidence failure is a separate `invalid` terminal state, not a rejection. The UI renders a non-verdict report with the sanitized stage and failure code, keeps incumbent state unchanged, and does not expose comparison scores, arm images, or promotion language.

## Design provenance

The design authority is `models/gemini-3.6-flash`. Generation metadata records model name, timestamps, duration, finish reason, and token counts where returned. This includes the core visual specification, responsive repair, fixture review, rejection receipt, and non-verdict invalid-state audit. Partial responses are retained only as invalid provenance and are never used as production authority. Production factual values are substituted only from verified receipts; visual decisions remain traceable in `design/fidelity-ledger.md`.

## Credential and data boundary

- No model credential is committed, rendered, stored in a receipt, or placed in a request URL.
- Provider requests use an `x-goog-api-key` header from a server-side environment/owner-readable secret file.
- The championship target is a synthetic owned fixture. PatchCourt does not accept real credentials, production accounts, private user data, or third-party confidential data.
- The public deployment uses verified replay mode; live mode requires an operator-provided server secret.

## Claim boundary

The promotion receipt proves what happened in the recorded browser run. It does not prove that the synthetic creator facts describe a real person, that PatchCourt has permission to test arbitrary public sites, or that an offline reference candidate was generated live. Those claims are deliberately excluded.
