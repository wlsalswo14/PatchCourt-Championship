# PatchCourt Championship Architecture

## Product claim

PatchCourt does not claim that an AI patch is good because it compiled, passed a
model review, or accumulated more tests. It claims only that a candidate may
replace the incumbent when the exact frozen user task improves and every critical
functional, accessibility, privacy, and security invariant still passes.

The championship journey is intentionally narrow:

```text
sign in to owned demo
  -> open Creator Directory
  -> search US
  -> inspect John Smith
  -> understand audience, verified channel, market fit, and next action
  -> edit an offer amount and prepare to send
```

Desktop and 390 x 844 mobile runs start from identical fixture snapshots.

## Runtime state machine

```text
created
  -> snapshotting
  -> observing_incumbent
  -> criticizing
  -> compiling_feedback
  -> patching_candidate
  -> observing_candidate
  -> deterministic_gates
  -> blind_comparison
  -> promoted | rejected | invalid
```

Terminal meanings:

- `promoted`: candidate wins the frozen user task and all critical gates pass.
- `rejected`: evidence is valid, but the candidate loses, ties, or regresses.
- `invalid`: infrastructure, model, browser, schema, or evidence failure prevents a
  product comparison. Invalid is never silently converted into a win or loss.

The UI treats `invalid` as a non-verdict: no scores, A/B images, critical-gate
claim, or champion/rejection label is rendered. The incumbent remains unchanged.

## Components

### Web application

- Creates a court run from the fixed task and owned target.
- Streams state transitions and sanitized evidence events.
- Shows the incumbent observation before any proposed change.
- Presents critic findings only when their evidence contract validates.
- Replays anonymous incumbent/candidate evidence side by side.
- Shows deterministic gates before the blinded preference.
- Renders the final hash-chained receipt and rejected lineage.

### API and orchestrator

- Owns run state, append-only events, cancellation, and terminality.
- Starts independent work concurrently but serializes the heavy browser/model phase.
- Rejects targets outside the configured loopback/owned allowlist.
- Redacts credentials, cookies, authorization headers, query secrets, local absolute
  paths, and raw private payloads before evidence persistence.
- Keeps incumbent and candidate observations structurally identical.

### Browser actor

- Uses Playwright because no Browser plugin is available in this session.
- Executes a versioned task script at desktop and mobile viewports.
- Captures screenshots, accessibility facts, task assertions, console errors, and
  bounded sanitized network facts.
- Never explores arbitrary public targets or performs open-ended active attacks.

### Evidence compiler

The live docket combines three deterministic metric sentinels with three Gemini
roles. Provider identity is never flattened: the terminal receipt preserves every
invoked critic, including zero-finding calls, with proposed/accepted/rejected counts
and recomputable canonical digests.

A critic finding is accepted only with:

```text
id, domain, severity, user impact,
evidence artifact + falsifiable observation,
reproduction steps, expected behavior,
patch locus, proposed direction,
acceptance checks, regression risks
```

The compiler rejects vague feedback, unknown evidence references, unsupported
severity, duplicate IDs, and findings with no executable acceptance check.

### Candidate patcher

- Receives the frozen task, a bounded source manifest, and the compiled brief.
- Receives a digest-bound synthetic public fact packet as the sole authority for
  new factual claims. The model does not discover creator facts.
- May edit only an explicit allowlist in an isolated candidate copy.
- Produces a machine-readable patch manifest and source hashes.
- Produces an exact changed-leaf-to-fact-ID grounding map. Candidate bytes and the
  grounding map are stored as separate content-addressed artifacts and both are
  bound into the patch and terminal receipt.
- May make at most one validation-guided repair. The rejected response body is not
  stored; only its digest and bounded contract errors survive in the grounding trace.
- Clears only manifest-declared `mustClearPaths`; a sensitive incumbent value does
  not erase a safe, fact-grounded candidate replacement.
- Cannot edit task contracts, browser assertions, judges, gates, receipts, or the
  incumbent snapshot.

### Truth boundary

The target manifest seals the raw-byte SHA-256 of `verified-facts.json`, its public
field allowlist, and synthetic/owned/non-private provenance. Snapshot, patch,
candidate collection, and receipt generation independently re-read and verify that
digest to prevent time-of-check/time-of-use substitution. Numeric claims, verification
claims, and changed lexical content that cannot be traced to the incumbent, frozen
task, neutral UI vocabulary, or cited fact IDs invalidate the live patch.

### Deterministic gatekeeper

Critical gates run before preference judgment:

- login and target navigation complete;
- directory search returns the expected fixture through normal product behavior;
- profile opens without runtime failure;
- offer message and amount remain editable;
- authenticated offer action remains present;
- mobile primary actions are visible and operable;
- no secret/internal identifier exposure;
- no horizontal overflow, uncaught page error, or broken critical asset.

A candidate failing one critical gate cannot be promoted regardless of visual score.

### Blind comparison

The judge receives anonymous A/B evidence in randomized order, the fixed user job,
and symmetric gate facts. It does not receive arm names, source code, prompt history,
critic prose, token count, or test count. A tie keeps the incumbent.

The blind verdict has one bounded JSON repair. When the first response has a valid
winner but an invalid shape, that winner is locked and the second call may only
complete the format. When the winner itself is invalid, the second call rejudges the
same neutral evidence. The receipt records the exact provider invocation count,
repair mode, invalid fields, rejected-response digest, and repair-proof digest.

### Receipt ledger

Every event and terminal receipt includes a canonical payload hash and the previous
receipt hash. The terminal receipt binds:

- task contract version;
- incumbent and candidate source hashes;
- verified-facts and claim-grounding artifact hashes;
- evidence bundle hashes;
- deterministic gate results;
- anonymous comparison result and order reveal;
- blind-judge invocation and bounded validation-repair proof;
- final decision and reason;
- model name and sanitized usage metadata;
- timestamp and previous receipt hash.

The hash chain provides tamper evidence, not blockchain theater: it exists so a
demo cannot quietly replace a failed artifact after judgment.

## API surface

The first vertical slice uses these contracts:

- `GET /api/health`
- `GET /api/capabilities`
- `POST /api/runs`
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/events`
- `POST /api/runs/:runId/cancel`
- `GET /api/runs/:runId/receipt`
- `GET /api/demo-runs/:slug`

The UI may render a recorded, cryptographically bound replay for a fast public demo,
but it must label replay versus live execution and expose the original receipt.

## Breakthrough hypothesis

The novel unit is not a critic agent or a coding agent. It is a
**counterfactual user-outcome ledger**: incumbent and candidate are forced through
the same task, evidence is bound before preference judgment, critical gates outrank
aesthetic preference, and only the winning counterfactual becomes the next
incumbent. This turns AI-generated patches from persuasive suggestions into
falsifiable release candidates.
