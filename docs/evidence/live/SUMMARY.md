# Sanitized live Gemini evidence

- Run: `pc01-edaaca75-c913-4a20-8885-4b58e87163fe`
- Verdict: **promote**; blind comparison **valid**
- Execution: **live-gemini** / `gemini-3.6-flash`
- Browser artifacts byte-reverified: **44**
- Grounding artifacts byte-reverified: **1**
- Candidate deterministic gates: **13/13 PASS**
- Critic provenance entries: **6**
- Judge calls: **1**; repair: **none**
- Task fingerprint: `49b3dd5a1edf7a6b2c77e9c49c4f999c34b3e040093203508e1bdffa87a352ef`
- Facts SHA-256: `c1fc28e2027abda3b717cc971f3865d0e6686ea9b82c9b38bcbd099c1787fb90`
- Canonical payload SHA-256: `ccc30b9916a6ef1198efc5c22470c2963a4180c35b014715ea1c5747bd8599ab`

The API service reopened the persisted run without a provider key and re-hashed every sealed browser and grounding artifact before returning the canonical receipt. No raw provider response, secret-like value, or absolute runtime path was copied into public evidence.
