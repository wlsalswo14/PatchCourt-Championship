# PC01 browser proof

The flow under test is: `/incumbent|candidate` → brand demo login → Creator
Directory → search `US` → John Smith → inspect four decision signals → edit fee
to `1500` → prepare an explicitly unsent draft.

The Browser plugin is not available in this session, so the required rendered
validation uses regular Playwright. The suite exercises the same task at 1280×720
and 390×844, records screenshots plus sanitized DOM/console/network evidence,
hashes every artifact, validates the receipt schema, and applies the promotion
policy.

```powershell
cd tests/e2e
npm install
npx playwright install chromium
npm test
npm run evidence:update
node ..\..\benchmark\verify-receipt.mjs ..\..\docs\evidence\latest\receipt.json
node ..\..\benchmark\verify-receipt.mjs ..\..\docs\evidence\rejection\receipt.json
```

`npm test` always writes generated promotion/rejection receipts beneath
`.artifacts/test-results/evidence/`. It removes any inherited authoritative-update
environment variables, hashes `docs/evidence/latest/` and
`docs/evidence/rejection/` before and after Playwright, and fails if either tree
changes. The proof is written to
`.artifacts/test-results/authoritative-immutability.json`.
The path-contract tests also reject every configured destination outside that
test-results root, except the two exact authoritative directories when the
update capability is present.

`npm run evidence:update` is the sole supported writer for the two authoritative
evidence directories. Its cross-platform Node runner supplies the guarded paths
to both browser specs, validates their schemas, and invokes the independent
benchmark verifier for each regenerated receipt before reporting `updated:true`.

The test owns `127.0.0.1:42873`, refuses to reuse an existing server, and rejects
non-loopback Host headers. The product/demo port can remain independent. The
browser run fails if any request leaves the fixture origin or if the manifest
fingerprint/digests change between arms.

## Actual product integration

Run the isolated API lifecycle proof and then let the owned integration runner
allocate its own fresh loopback ports:

```powershell
npm run test:api-lifecycle
npm run test:integration:owned
```

`test:api-lifecycle` owns random loopback ports and a verified operating-system
temporary runtime. It cancels a run while subscribed to named SSE events,
restarts the API on the same runtime, verifies byte-equivalent recovered state,
and then removes only that verified temporary directory.

`test:integration:owned` starts fresh random-port fixture, API, live-capable web,
and public replay-only web processes, records their PIDs/start times and digest
preflight, then exercises the actual React UI at desktop and mobile sizes. It
checks Unicode rendering, horizontal overflow, touch targets, console/network
health, accessibility snapshots, neutral pre-reveal arm URLs and DOM, the order
commitment, live-pending isolation, compressed 60-second replay, canonical live
receipt hashing, the demo receipt endpoint, unchanged task/source/facts digests,
and a public-static build with zero `/api` requests and a disabled live CTA.
Actual outputs are written to `docs/evidence/integration/`; Vite filesystem
module URLs are normalized to `artifact://local-vite-module` before telemetry is
persisted, so local workstation paths cannot enter the public evidence.
