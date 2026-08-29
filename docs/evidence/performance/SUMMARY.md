# PatchCourt production performance evidence

## Result

Lighthouse 13.4.1 audited the credential-free public production build at desktop
and simulated mobile settings. All four audited categories score **100** in both
runs.

| Metric | Desktop | Simulated mobile | Good threshold |
| --- | ---: | ---: | ---: |
| Performance | 100 | 100 | Lighthouse 90–100 |
| Accessibility | 100 | 100 | 100 target |
| Best Practices | 100 | 100 | 100 target |
| SEO | 100 | 100 | 100 target |
| FCP | 337 ms | 1,357 ms | ≤ 1,800 ms |
| LCP | 337 ms | 1,357 ms | ≤ 2,500 ms |
| TBT | 0 ms | 0 ms | ≤ 200 ms |
| CLS | 0.00016 | 0 | ≤ 0.1 |

The public landing load made four same-origin requests (document, JS, CSS, and
SVG favicon), transferred 90,551 bytes, made no API or third-party request, logged
no console error, and had zero render-blocking estimated savings.

## Interaction sample

A 390×844 Playwright Chromium lab pass exercised comparison navigation, blind
mapping reveal, and receipt navigation. The maximum Event Timing duration was
**96 ms** and horizontal overflow was **0 px**. This is an interaction regression
sample, not field INP; Lighthouse cannot measure INP without real user input.

## Audit-driven fixes

The first desktop pass found three concrete issues and directly changed production:

1. active 9 px event-index text was 4.41:1; the approved small red token now gives
   5.915:1 while preserving the original border color;
2. a missing favicon generated a console 404; a relative, nested-host-safe SVG
   favicon now returns 200;
3. a missing `robots.txt` fell through to SPA HTML; an exact allow-all file now
   returns valid plain text.

The post-fix reports have no runtime error or run warning and independently validate
all category scores, metrics, console, contrast, and robots audits. On this Windows
host the Lighthouse CLI's Chrome launcher reported a temporary-directory cleanup
`EPERM` only after each complete JSON report was written; report integrity and
contents were validated separately.

## Artifacts and method

- `lighthouse-desktop.json` — SHA-256
  `1c746b59291eb5d5f808449c0e7ed86f18b4ec6c2a0cf9d5f7eb08389325c84e`
- `lighthouse-mobile.json` — SHA-256
  `f7e6956fcbf00c208927c7193ed44e474330023b4997906afa07fa8414db55ef`
- `interaction-lab.json` — representative trusted pointer interactions

The required Chrome DevTools MCP was not configured in this session, so the
`web-perf` skill's DevTools trace path was stopped. The documented fallback uses a
fresh Vite production preview, Lighthouse CLI, Playwright Event Timing, existing
accessibility snapshots, network telemetry, and source/bundle analysis.

Official interpretation references:

- <https://web.dev/articles/vitals>
- <https://developer.chrome.com/docs/lighthouse/performance/performance-scoring>
