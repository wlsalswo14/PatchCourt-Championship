# Security and rights boundary

## Submission ownership

- This repository is new and independent. Source from the private Verdigris Labs
  snapshot is not copied wholesale.
- Reused ideas and schemas must be reimplemented generally, with provenance noted.
- Before public submission, the owner must confirm authority over the PatchCourt
  name, the selected demo fixture, and any retained visual/text assets.
- No SCI team model, AI-Hub-derived adapter, third-party session artifact, private
  benchmark gold, or production database belongs in this submission.

## Model credentials

- API keys are read only from process environment or an owner-readable external
  secret file.
- Keys never enter `.env.example`, browser bundles, HTTP responses, prompts,
  screenshots, receipts, structured logs, or git.
- The design record stores provider, model name, timestamp, prompt hash, and
  sanitized response; it does not store credentials or request headers.
- Keys pasted into chat should be rotated after the build because chat disclosure
  must be treated as credential exposure.

## Target safety

- Default allowed origins are loopback addresses for the owned demo application.
- Target URLs are normalized and resolved before launch. Userinfo, non-HTTP(S)
  schemes, unexpected ports, redirects outside the allowlist, and private-network
  expansion outside configured loopback targets are rejected.
- Browser contexts are ephemeral. Authentication uses deterministic demo accounts,
  never real customer credentials.
- Active security probes run only against isolated copies created for this project.

## Evidence minimization

- Persist task-scoped screenshots and bounded accessibility/console/network facts.
- Strip cookies, authorization headers, query credentials, local paths, stack
  traces, full response bodies, and unrelated page content.
- Evidence artifacts are content-addressed and immutable after sealing.
- Public demo runs use synthetic people, brands, metrics, and offers.

## Patch boundary

- Candidate edits are restricted to an explicit source allowlist.
- Contracts, tests, evaluators, task fixtures, receipt code, and incumbent sources
  are protected.
- The patch process runs with no production credentials and no unrestricted external
  network access.
- A rejected candidate is retained only as sanitized source diff and receipt metadata.
