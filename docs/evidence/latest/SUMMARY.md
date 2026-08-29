# PC01 browser evidence

- Run: `pc01-20260829165215`
- Task fingerprint: `49b3dd5a1edf7a6b2c77e9c49c4f999c34b3e040093203508e1bdffa87a352ef`
- Incumbent: **40/100**
- Candidate: **100/100**
- Decision-evidence lift: **+4/4**
- External/effect requests: **0/0**
- Synthetic facts digest: `c1fc28e2027abda3b717cc971f3865d0e6686ea9b82c9b38bcbd099c1787fb90`
- Execution: **offline-demo** (patchcourt:browser-metrics-v1; patchcourt:owned-fixture-reference-candidate-v1; patchcourt:deterministic-blind-scorecard-v1)
- Critic provenance: **3 critics**, digest `e02eb16a9b680b004b52cded5b5b9763e42d5388a1192648b7955c1aa70e18d6`
- Decision: **PROMOTE**
- Blind comparator: patchcourt-local/observable-outcome-comparator-v1 (valid, 1 invocation)

The incumbent's seeded raw provider material, incomplete decision evidence, and mobile overflow were reproduced in the browser. The candidate completed the identical task at both viewports with all critical gates passing. See `receipt.json` for artifact hashes and gate observations.
