# PC01 clean rejection evidence

- Run: `pc01-rejection-20260829165222`
- Candidate score: **85/100** (incumbent 40/100)
- Broken critical gate: **responsive_primary_action** (78px)
- External requests: **0**
- Effect requests: **0**
- Synthetic facts digest: `c1fc28e2027abda3b717cc971f3865d0e6686ea9b82c9b38bcbd099c1787fb90`
- Execution: **offline-demo** (patchcourt:browser-metrics-v1; patchcourt:owned-fixture-rejection-css-v1; patchcourt:deterministic-blind-scorecard-v1)
- Critic provenance: **3 critics**, digest `e02eb16a9b680b004b52cded5b5b9763e42d5388a1192648b7955c1aa70e18d6`
- Blind comparator invocations: **0**
- Decision: **REJECT — incumbent retained**

The isolated candidate remained decision-useful and completed the task, but a local CSS mutation overflowed the 390×844 primary action. Deterministic gates stopped evaluation before anonymous judging; no external effect was attempted.
