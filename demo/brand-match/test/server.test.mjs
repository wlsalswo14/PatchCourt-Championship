import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildManifest, hostIsAllowed, stableJson } from "../server.mjs";

const DEMO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("loopback allowlist rejects public and deceptive hosts", () => {
  assert.equal(hostIsAllowed("127.0.0.1:4173"), true);
  assert.equal(hostIsAllowed("localhost:4173"), true);
  assert.equal(hostIsAllowed("example.com"), false);
  assert.equal(hostIsAllowed("localhost.example.com"), false);
  assert.equal(hostIsAllowed("127.0.0.1.example.com"), false);
});

test("stable task serialization is independent of object insertion order", () => {
  assert.equal(stableJson({ b: 2, a: 1 }), stableJson({ a: 1, b: 2 }));
});

test("manifest seals the exact task and distinct source variants", async () => {
  const manifest = await buildManifest();
  const expectedTaskFingerprint = createHash("sha256")
    .update(stableJson(manifest.task))
    .digest("hex");
  assert.equal(manifest.taskFingerprint, expectedTaskFingerprint);
  assert.match(manifest.sourceSnapshotDigest, /^[a-f0-9]{64}$/);
  assert.match(manifest.candidateSnapshotDigest, /^[a-f0-9]{64}$/);
  assert.match(manifest.patchDigest, /^[a-f0-9]{64}$/);
  assert.match(manifest.facts.digest, /^[a-f0-9]{64}$/);
  assert.notEqual(manifest.sourceSnapshotDigest, manifest.candidateSnapshotDigest);
  assert.equal(manifest.owned, true);
  assert.equal(manifest.safety.loopbackOnly, true);
  assert.deepEqual(manifest.safety.mustClearPaths, ["trust.providerDebug"]);
});

test("manifest clear authority is minimal and matches the seeded privacy defect", async () => {
  const manifest = await buildManifest();
  const incumbent = JSON.parse(await readFile(resolve(DEMO_ROOT, "data", "incumbent.json"), "utf8"));
  const candidate = JSON.parse(await readFile(resolve(DEMO_ROOT, "data", "candidate.json"), "utf8"));
  assert.deepEqual(manifest.safety.mustClearPaths, ["trust.providerDebug"]);
  assert.match(incumbent.trust.providerDebug, /profile_id|oauth/i);
  assert.equal(candidate.trust.providerDebug, "");
  assert.notEqual(candidate.trust.marketFitDetail, "");
});

test("verified facts are raw-byte sealed, synthetic, owned, and non-private", async () => {
  const manifest = await buildManifest();
  const factsBytes = await readFile(resolve(DEMO_ROOT, "data", "verified-facts.json"));
  const facts = JSON.parse(factsBytes.toString("utf8"));
  const digest = createHash("sha256").update(factsBytes).digest("hex");
  assert.equal(manifest.facts.digest, digest);
  assert.equal(manifest.facts.path, "/__patchcourt/verified-facts.json");
  assert.equal(manifest.facts.kind, "synthetic-public-fixture");
  assert.deepEqual(facts.provenance, {
    synthetic: true,
    owned: true,
    private: false
  });
  assert.deepEqual(
    facts.facts.map(({ field }) => field),
    manifest.facts.fields
  );
  assert.doesNotMatch(
    factsBytes.toString("utf8"),
    /https?:\/\/|profile_id|oauth|token|cookie|secret|credential|email|phone/i
  );
});
