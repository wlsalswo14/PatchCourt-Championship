# PatchCourt runbook

## Prerequisites

- Node.js 22+
- Chromium installed for Playwright (`npx playwright install chromium`)
- Three terminals for the owned fixture, API, and web application

Install dependencies once:

```powershell
npm ci
npm ci --prefix tests/e2e
npx playwright install chromium
```

## Verified offline mode

Terminal 1 — fresh owned synthetic fixture:

```powershell
$env:PATCHCOURT_DEMO_PORT = "4173"
npm run demo:start
```

Before starting a court run, confirm that the fresh manifest contains a non-empty
`facts.digest`:

```powershell
(Invoke-RestMethod http://127.0.0.1:4173/__patchcourt/manifest.json).facts.digest
```

Terminal 2 — API with deterministic reference adapters:

```powershell
$env:PATCHCOURT_EXECUTION_MODE = "offline-demo"
npm run dev:api
```

Terminal 3 — React product (its development proxy forwards `/api` to port 8787):

```powershell
npm run dev:web
```

Open <http://127.0.0.1:4175>. “증거 재판 시작” executes the owned fixture;
“60초 데모 시나리오 압축 재생” uses the checked-in, hash-verified receipt.

## Live Gemini 3.6 Flash mode

Keep the fixture and web terminals above. Create an owner-readable external file
outside this repository with one of these fields:

```dotenv
GEMINI_API_KEY=replace-locally
```

or `GEMMA_API_KEY`. Then start the API without placing the value in the command,
URL, source tree, or browser environment:

```powershell
$env:PATCHCOURT_SECRET_FILE = "C:\path\to\owner-readable.env"
$env:PATCHCOURT_EXECUTION_MODE = "live-gemini"
$env:PATCHCOURT_GEMINI_MODEL = "gemini-3.6-flash"
npm run dev:api
```

Live mode performs three concurrent evidence-grounded critic calls, one value-only
candidate synthesis call, exact browser replay, deterministic gates, and—only if
all critical gates pass—one anonymous multimodal A/B judgment.

## Verification

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
npm --workspace @patchcourt/web run test:e2e
npm --workspace @patchcourt/web run test:e2e:live-states
node benchmark/verify-receipt.mjs docs/evidence/latest/receipt.json
node benchmark/verify-receipt.mjs docs/evidence/rejection/receipt.json
```

`npm run test:e2e` writes to ignored `.artifacts` storage and fails if either
checked-in evidence tree changes. To deliberately replace the canonical promotion
and rejection bundles, run `npm run evidence:update`; it is the only guarded writer,
and it verifies both regenerated receipts before returning. Then review the visual
artifacts and run `npm --workspace @patchcourt/web run sync:replay` before commit.
Curated UI screenshots are similarly capability-gated: use
`npm --workspace @patchcourt/web run test:e2e:capture` and
`test:e2e:live-states:capture` only for an intentional visual refresh. Default web
tests write to ignored Playwright output and leave `design/final` unchanged.

The clean promotion and clean rejection must both verify. A candidate that fails a
critical gate must have blind-judge invocation count `0` and retain the incumbent.

## Stale-process recovery

Never enable server reuse for evidence generation. If port 4173 is already owned by
an unknown process, do not terminate it blindly. Start a fresh fixture on a new port
and explicitly allow that exact origin for the API process:

```powershell
$env:PATCHCOURT_DEMO_PORT = "4273"
# fixture terminal: npm run demo:start

$env:PATCHCOURT_OWNED_ORIGINS = "http://127.0.0.1:4273"
# API terminal: npm run dev:api
```

Use the new target URL in the run request and verify its manifest fingerprint and
facts digest before both incumbent and candidate arms.

## Public deployment

The public GitHub Pages build intentionally ships no credential and runs the
verified-replay experience. `.github/workflows/pages.yml` verifies the authoritative
receipt before building and deploying `apps/web/dist`. Live Gemini execution remains
a server-side operator mode.
