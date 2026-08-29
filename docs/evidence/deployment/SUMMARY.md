# Public deployment evidence

PatchCourt's credential-free verified replay was exercised against the actual
GitHub Pages origin on 2026-08-30 KST. This was an external-origin Chromium run,
not a Vite preview or a mocked page.

- Public URL: <https://wlsalswo14.github.io/PatchCourt-Championship/>
- Source commit under test: `6d020fb5f147f1704d5ecb5050a08d44d6bdbcad`
- Gated deployment: [GitHub Actions run 33267949024](https://github.com/wlsalswo14/PatchCourt-Championship/actions/runs/33267949024)
- Deployment chain: `verify -> build-pages -> deploy-pages`, all successful
- Machine-readable result: [`verification.json`](verification.json)

## Direct-origin browser contract

| Profile | Document | Requests / cross-origin / `/api/` | Overflow before / after | Console / page / request / HTTP errors | Promotion | Rejection |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1440×960 desktop | 200 | 6 / 0 / 0 | 0 / 0 px | 0 / 0 / 0 / 0 | verified | verified |
| 390×844 mobile | 200 | 6 / 0 / 0 | 0 / 0 px | 0 / 0 / 0 / 0 | verified | verified |

The journey loaded and decoded the evidence image, confirmed that neutral A/B
image URLs did not expose `incumbent` or `candidate` before reveal, opened the
mapping, inspected the champion receipt and `VERIFIED REPLAY` provenance, then
opened the deliberate rejection and confirmed blind-judge invocation count `0`.
Both navigations ended at the exact configured HTTPS URL without a redirect.

The direct public screenshots are byte-identical to the checked-in visual proof:

| Public capture | Checked-in proof | SHA-256 |
| --- | --- | --- |
| desktop | [`design/final/dashboard-desktop.png`](../../../design/final/dashboard-desktop.png) | `9e1ec2a26eb8c293c160bee735cec66f12ca7393b1e837613eb03087bcd7c039` |
| mobile | [`design/final/dashboard-mobile.png`](../../../design/final/dashboard-mobile.png) | `4bd2da63b09d6f8c3d40f5acb498c07a541bacd9812a5305ee07e8ce710ac915` |

Re-run the public contract after a Pages deployment:

```powershell
$env:PATCHCOURT_PUBLIC_URL = "https://wlsalswo14.github.io/PatchCourt-Championship/"
npm run test:deployment
```

The reusable verifier is [`tests/e2e/verify-public-deployment.mjs`](../../../tests/e2e/verify-public-deployment.mjs).
It enforces the screenshot hashes above. At startup it removes the two known prior
captures and overwrites `verification.json` with `running`; on failure it writes a
`failed` report and a best-effort failure screenshot. A deliberate owned 404 probe
was used to confirm that an old passing report or green screenshot cannot survive a
failed rerun. Raw artifacts default to ignored `tests/e2e/test-results/deployment`,
so ordinary verification cannot mutate this curated evidence bundle.
