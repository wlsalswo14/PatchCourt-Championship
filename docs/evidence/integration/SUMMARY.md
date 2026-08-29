# PatchCourt actual UI integration evidence

- Chromium: desktop 1280×720 and mobile 390×844
- Live run: `pc01-244db672-3ce7-4681-b68f-fd6003cce39c`
- Canonical receipt: `receipt-576ed3afc9820aacf3e7b125`
- Execution: **offline-demo** (patchcourt:three-role-metric-critics-v1; patchcourt:prebuilt-reference-candidate-v1; patchcourt:paired-outcome-v1)
- Critic provenance: `e59a2c56ff1abe95f8912995c084461fe5765df53cc8b3f22aeb6aba60e180d5`
- Task fingerprint: `49b3dd5a1edf7a6b2c77e9c49c4f999c34b3e040093203508e1bdffa87a352ef`
- Facts packet: `c1fc28e2027abda3b717cc971f3865d0e6686ea9b82c9b38bcbd099c1787fb90`
- Payload SHA-256: `8c1f78478f4392e00a9aea36586fbda48a5cd57b91bcf610cb27f05cf8b5e60a`
- 60-second scenario replay: **5062ms compressed**, UI timeline 00:00–01:00
- Public static mode: **0 /api requests**, live CTA disabled, replay CTA primary
- Persisted telemetry: **4 files, 0 raw `/@fs/` or local absolute paths, 4 sanitized artifact URIs**
- Browser runner: regular Playwright (Browser plugin unavailable)

The actual React UI and API were exercised together. Pre-reveal arms used neutral URLs and DOM, live pending views exposed no recorded scores/findings, the demo endpoint returned a schema-valid canonical receipt, and the manifest task/facts/source digests remained unchanged.
