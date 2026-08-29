# PC01 — creator discovery to safe offer draft

Status: frozen before the championship implementation is judged
Product: project-owned `demo/brand-match` fixture
Claim boundary: one real browser journey, not general web-site repair

## User and job

A brand operator signs into a demo account, searches the creator directory for
the US market, opens John Smith, determines whether the creator is credible and
relevant, edits the proposed fee, and prepares (but does not send) an offer.

## Exact browser task

Run the same instructions against both `/incumbent` and `/candidate`:

1. Open the app at 1280×720.
2. Sign in with the existing brand demo account.
3. Open **Creator Directory**.
4. Search for `US`.
5. Open **John Smith**.
6. Determine the audience, verified channel, US-market fit, and next action from
   rendered product evidence only.
7. Open the offer composer, change the fee to `$1,500`, and prepare the draft.
8. Confirm that the product says the offer is a draft and has not been sent.
9. Repeat the evidence inspection and offer action at 390×844.

The evaluator must not read fixture source to answer step 6. Browser-visible
evidence is the product outcome.

## Seeded incumbent defects to verify, not assume

The fixture intentionally contains possible seed defects derived from BU01:

- a `0 followers` result;
- raw OAuth/provider profile material;
- a `TBD` audience field;
- a primary mobile offer action that may overflow its container.

They count as findings only after browser evidence captures the exact rendered
text, DOM state, viewport measurement, or screenshot. PatchCourt must never
invent a defect because it appears in this contract.

## Critical acceptance gates

| Gate | Observable acceptance check |
|---|---|
| `owned_local_target` | Manifest says `owned: true`; target resolves only to loopback. |
| `same_task_fingerprint` | Both arms use the byte-identical frozen task fingerprint. |
| `brand_demo_login` | Demo login reaches the signed-in home without page/console errors. |
| `directory_search` | Searching `US` returns John Smith. |
| `profile_open` | John Smith's profile opens and preserves the search context. |
| `decision_evidence_complete` | Audience, verified channel, market-fit rationale, and next action are explicitly visible. |
| `offer_fields_editable` | Offer fee accepts `1500`; message and fee remain editable. |
| `draft_not_sent` | The primary action creates an explicit local draft and records zero non-GET/HEAD effect requests. |
| `no_internal_identifier_exposure` | No opaque OAuth ID, provider API URL, token, cookie, secret, or local path is rendered. |
| `accessible_primary_controls` | Login, navigation, search, profile, fee, and draft actions have accessible names. |
| `responsive_primary_action` | At 390×844 there is no document overflow or clipped primary action. |
| `console_and_network_clean` | No relevant page/console errors and no request leaves the fixture origin. |
| `artifact_integrity` | Every evidence artifact exists and matches its recorded SHA-256. |

Any failed critical candidate gate rejects the candidate regardless of score.

## Objective outcome score

The deterministic score reports five separable dimensions rather than hiding a
failure in one blended model opinion:

- task completion: 30;
- decision-evidence completeness: 25;
- privacy and local-only security: 20;
- accessibility and responsive usability: 15;
- functional/runtime integrity: 10.

The score is supporting evidence, not the promotion rule. A candidate promotes
only when it passes every critical gate, completes the same task, has a strictly
higher score, improves decision-evidence completeness, does not regress task
completion, editability, draft safety, console health, or local-only networking,
and wins a valid anonymous A/B comparison. The A/B order is SHA-256 committed
before judging and revealed afterward. A judge tie keeps the incumbent. A
truncated, unparsable, arithmetically inconsistent, identity-leaking, or otherwise
invalid judge response is recorded as invalid evidence and cannot promote either
arm; it must never be reported as a score win. A single mapping-free format
repair may make one additional provider call. The receipt must seal the rejected
response hash and invalid field names without storing raw model output; no-repair,
repaired, and deterministic short-circuit paths require exactly 1, 2, and 0 judge
calls respectively.

## Safety boundary

- Only `http://127.0.0.1` or `http://localhost` fixture origins are accepted.
- No public URL, third-party site, production account, private data, or real
  credential may enter this benchmark.
- The offer action is an in-memory draft operation. There is no email, payment,
  webhook, creator contact, or external API integration.
- Concrete candidate facts and verification claims may come only from the owned
  synthetic packet at the manifest-sealed `facts.path`. Its raw UTF-8 bytes must
  match `facts.digest`; the packet declares `synthetic: true`, `owned: true`, and
  `private: false`. The incumbent UI, benchmark wording, and model memory are not
  factual sources for synthesis.
- Source values may be force-cleared only at manifest-declared
  `safety.mustClearPaths`. PC01 authorizes exactly `trust.providerDebug`; other
  unsafe source strings must be repaired with grounded values rather than erased
  wholesale.
- Browser requests that leave the fixture origin fail the run.
- Active security probes are limited to this project-owned fixture.

## Evidence and lineage

Each run records screenshots, sanitized DOM summaries, console/network logs,
source and patch digests, per-gate observations, outcome metrics, anonymous A/B
order commitment and reveal, judge model/provider/response metadata, the promotion
decision, the execution mode plus critic/patch/judge providers and runtime model,
per-critic proposed/accepted/rejected counts with an accepted-ID digest, and the
preceding receipt hash. Offline receipts must declare `model: null`; live
Gemini receipts must name the model used. A rejected candidate remains in the
lineage. Evidence may be regenerated only as a new receipt; history is not
overwritten.
