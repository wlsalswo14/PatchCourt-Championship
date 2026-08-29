# Competition fit

Source checked on 2026-08-30: <https://event.wanted.co.kr/ai-championship/2026>

## Current official constraints

- Theme: open topic; use AI to solve a real problem or create new value.
- Submission: deploy a working service and provide its URL, the problem, how AI is used, and the AI tools used.
- Preliminary judging: planning quality, feasibility, scalability, and appropriateness of AI use. Internal judging is 80% and public voting is 20%.
- Final judging: planning quality, scalability, technical quality, and presentation delivery.
- Registration closes 2026-09-18 23:59:59 KST and project submission closes 2026-09-20 23:59:59 KST. The contest API represents these boundaries as the following midnight.
- The deployed service must remain reachable during judging.
- Existing self-authored projects and open source are allowed, subject to rights and license compliance.
- The submission must not expose personal data, company secrets, or third-party confidential information.

## PatchCourt response

| Criterion | Product proof |
| --- | --- |
| Planning quality | A frozen real-user journey, counterfactual outcome ledger, explicit failure taxonomy, and strict promotion policy turn the vague claim "the UI improved" into an auditable decision. |
| Feasibility | An owned loopback demo, real Playwright replay, evidence-addressed critics, bounded patches, deterministic gates, blind A/B comparison, and hash-linked receipts form one executable vertical slice. |
| Scalability | Browser, critic, patcher, receipt, and repository ports isolate provider and target-app concerns; task contracts and adapters make additional owned apps and journeys additive. |
| Appropriate AI use | AI is used only where semantic judgment and implementation synthesis are needed. Deterministic safety, integrity, accessibility, and regression gates stay outside model discretion. |
| Technical quality | Secret-safe provider access, loopback enforcement, exact task fingerprints, artifact hashes, blinded order commitments, reproducible rejection behavior, and browser evidence are externally inspectable. |
| Presentation | The primary screen is designed as a 60-second court proceeding: charge, evidence, patch, exact replay, blind verdict, and champion receipt. |

## Submission gate

PatchCourt is not submission-ready until all of the following are true:

1. A public deployment is reachable without local setup.
2. The demo mode runs without accepting real credentials or private data.
3. At least one clean promotion and one clean rejection receipt are bundled.
4. The submitted AI-tool disclosure matches the providers actually used.
5. A cold browser can understand and replay the 60-second story.
