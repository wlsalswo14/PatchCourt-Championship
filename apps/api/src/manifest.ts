import {
  ContractError,
  contentHash,
  normalizeTaskText,
  sha256,
  type CriticalInvariantContract,
  type FrozenTaskContract,
} from "@patchcourt/core";

import { DEFAULT_VIEWPORTS, TASK_CONTRACT_VERSION } from "./constants.js";
import { TargetPolicy } from "./target-policy.js";

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_DATA_PATH = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

export type ManifestActionKind = "click" | "fill" | "assertVisible" | "assertEditable";

export interface ManifestAction {
  kind: ManifestActionKind;
  selector: string;
  value?: string;
}

export interface ManifestStep {
  id: string;
  instruction: string;
  actions: ManifestAction[];
  capture: boolean;
}

export interface DemoManifest {
  schemaVersion: 1;
  appId: string;
  owned: true;
  safety: {
    loopbackOnly: boolean;
    realCredentialsAccepted: false;
    privateDataAccepted: false;
    externalEffects: false;
    mustClearPaths: string[];
  };
  sourceSnapshotDigest: string;
  candidateSnapshotDigest: string;
  patchDigest: string;
  facts: {
    path: string;
    digest: string;
    kind: "synthetic-public-fixture";
    fields: string[];
  };
  variants: { incumbent: string; candidate: string };
  task: { id: string; title: string; steps: ManifestStep[] };
  taskFingerprint: string;
  criticalInvariants: CriticalInvariantContract[];
}

export interface VerifiedFactsPacket {
  schemaVersion: 1;
  appId: string;
  subjectId: string;
  verifiedAt: string;
  provenance: { synthetic: true; owned: true; private: false };
  facts: Array<{ id: string; field: string; value: string | number; unit?: string }>;
}

export interface DemoPatchManifest {
  schemaVersion: 1;
  appId: string;
  kind: string;
  claimBoundary: string;
  source: string;
  candidate: string;
  changes: Array<{ locus: string; intent: string }>;
  forbiddenEffects: string[];
  rawDigest: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new ContractError(`manifest ${name} must be text`);
}

function validateAction(value: unknown): ManifestAction {
  if (!isRecord(value)) throw new ContractError("manifest action must be an object");
  if (!["click", "fill", "assertVisible", "assertEditable"].includes(String(value.kind))) throw new ContractError("manifest action kind is unsupported");
  assertString(value.selector, "action.selector");
  if (!value.selector.startsWith("[data-")) throw new ContractError("manifest automation selectors must use fixture data attributes");
  if (value.kind === "fill") assertString(value.value, "action.value");
  return { kind: value.kind as ManifestActionKind, selector: value.selector, ...(typeof value.value === "string" ? { value: value.value } : {}) };
}

function validateManifest(value: unknown, target: URL): DemoManifest {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.owned !== true) throw new ContractError("target does not expose an owned PatchCourt manifest");
  assertString(value.appId, "appId");
  if (!isRecord(value.safety) || value.safety.realCredentialsAccepted !== false || value.safety.privateDataAccepted !== false || value.safety.externalEffects !== false) {
    throw new ContractError("owned target safety contract is incomplete");
  }
  if (!Array.isArray(value.safety.mustClearPaths)
    || !value.safety.mustClearPaths.every((path) => typeof path === "string" && SAFE_DATA_PATH.test(path))
    || new Set(value.safety.mustClearPaths).size !== value.safety.mustClearPaths.length) {
    throw new ContractError("manifest safety.mustClearPaths must contain unique relative data paths");
  }
  if (!isRecord(value.variants)) throw new ContractError("manifest variants are required");
  assertString(value.variants.incumbent, "variants.incumbent");
  assertString(value.variants.candidate, "variants.candidate");
  for (const path of [value.variants.incumbent, value.variants.candidate]) {
    const resolved = new URL(path, target.origin);
    if (resolved.origin !== target.origin) throw new ContractError("manifest variant escaped the owned origin");
  }
  for (const key of ["sourceSnapshotDigest", "candidateSnapshotDigest", "patchDigest", "taskFingerprint"] as const) {
    if (typeof value[key] !== "string" || !SHA256.test(value[key])) throw new ContractError(`manifest ${key} must be SHA-256`);
  }
  if (!isRecord(value.facts)) throw new ContractError("manifest verified facts contract is required");
  assertString(value.facts.path, "facts.path");
  if (new URL(value.facts.path, target.origin).origin !== target.origin) throw new ContractError("verified facts path escaped the owned origin");
  if (typeof value.facts.digest !== "string" || !SHA256.test(value.facts.digest)) throw new ContractError("verified facts digest must be SHA-256");
  if (value.facts.kind !== "synthetic-public-fixture" || !Array.isArray(value.facts.fields) || !value.facts.fields.every((field) => typeof field === "string" && field.length > 0)) {
    throw new ContractError("verified facts metadata is invalid");
  }
  if (!isRecord(value.task) || !Array.isArray(value.task.steps)) throw new ContractError("manifest task steps are required");
  assertString(value.task.id, "task.id");
  assertString(value.task.title, "task.title");
  const steps = value.task.steps.map((step) => {
    if (!isRecord(step)) throw new ContractError("manifest task step must be an object");
    assertString(step.id, "task.step.id");
    assertString(step.instruction, "task.step.instruction");
    if (!Array.isArray(step.actions) || step.actions.length === 0) throw new ContractError(`manifest task step has no automation: ${step.id}`);
    return { id: step.id, instruction: step.instruction, actions: step.actions.map(validateAction), capture: step.capture === true };
  });
  if (!Array.isArray(value.criticalInvariants) || value.criticalInvariants.length === 0) throw new ContractError("manifest critical invariants are required");
  const allowedCategories = new Set(["functionality", "accessibility", "security", "privacy", "responsive"]);
  const criticalInvariants = value.criticalInvariants.map((item) => {
    if (!isRecord(item)) throw new ContractError("manifest invariant must be an object");
    assertString(item.id, "invariant.id");
    assertString(item.category, "invariant.category");
    assertString(item.description, "invariant.description");
    if (!allowedCategories.has(item.category)) throw new ContractError(`manifest invariant category is unsupported: ${item.category}`);
    return { id: item.id, category: item.category, description: item.description } as CriticalInvariantContract;
  });
  const recomputedTaskFingerprint = contentHash({ id: value.task.id, title: value.task.title, steps });
  if (recomputedTaskFingerprint !== value.taskFingerprint) throw new ContractError("manifest task fingerprint does not match its canonical task body");
  return {
    schemaVersion: 1,
    appId: value.appId,
    owned: true,
    safety: {
      loopbackOnly: value.safety.loopbackOnly === true,
      realCredentialsAccepted: false,
      privateDataAccepted: false,
      externalEffects: false,
      mustClearPaths: [...value.safety.mustClearPaths] as string[],
    },
    sourceSnapshotDigest: value.sourceSnapshotDigest as string,
    candidateSnapshotDigest: value.candidateSnapshotDigest as string,
    patchDigest: value.patchDigest as string,
    facts: {
      path: value.facts.path,
      digest: value.facts.digest,
      kind: "synthetic-public-fixture",
      fields: value.facts.fields as string[],
    },
    variants: { incumbent: value.variants.incumbent, candidate: value.variants.candidate },
    task: { id: value.task.id, title: value.task.title, steps },
    taskFingerprint: value.taskFingerprint as string,
    criticalInvariants,
  };
}

async function boundedJson(url: URL): Promise<unknown> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(8_000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new ContractError(`owned target contract request failed: ${response.status}`);
  const text = await response.text();
  if (text.length > 1_000_000) throw new ContractError("owned target contract exceeded the size limit");
  try {
    return JSON.parse(text);
  } catch {
    throw new ContractError("owned target contract is not valid JSON");
  }
}

export class ManifestClient {
  constructor(readonly policy = new TargetPolicy()) {}

  async load(targetUrl: string): Promise<DemoManifest> {
    const target = this.policy.assertAllowed(targetUrl);
    const value = await boundedJson(new URL("/__patchcourt/manifest.json", target.origin));
    const manifest = validateManifest(value, target);
    if (manifest.safety.loopbackOnly && !this.policy.isLoopback(targetUrl)) throw new ContractError("loopback-only fixture cannot run on a remote origin");
    return manifest;
  }

  async patch(targetUrl: string): Promise<DemoPatchManifest> {
    const target = this.policy.assertAllowed(targetUrl);
    const response = await fetch(new URL("/__patchcourt/patch.json", target.origin), { redirect: "error", signal: AbortSignal.timeout(8_000), headers: { Accept: "application/json" } });
    if (!response.ok) throw new ContractError(`owned target patch request failed: ${response.status}`);
    const text = await response.text();
    if (text.length > 1_000_000) throw new ContractError("owned target patch contract exceeded the size limit");
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new ContractError("owned target patch contract is not valid JSON"); }
    if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.changes)) throw new ContractError("patch manifest is invalid");
    for (const key of ["appId", "kind", "claimBoundary", "source", "candidate"] as const) assertString(value[key], `patch.${key}`);
    return { ...(value as unknown as Omit<DemoPatchManifest, "rawDigest">), rawDigest: sha256(text) };
  }

  async verifiedFacts(targetUrl: string, manifest?: DemoManifest): Promise<{ packet: VerifiedFactsPacket; rawDigest: string }> {
    const target = this.policy.assertAllowed(targetUrl);
    const sealedManifest = manifest ?? await this.load(targetUrl);
    const factsUrl = new URL(sealedManifest.facts.path, target.origin);
    if (factsUrl.origin !== target.origin) throw new ContractError("verified facts request escaped the owned origin");
    const response = await fetch(factsUrl, { redirect: "error", signal: AbortSignal.timeout(8_000), headers: { Accept: "application/json" } });
    if (!response.ok) throw new ContractError(`verified facts request failed: ${response.status}`);
    const text = await response.text();
    if (text.length > 1_000_000) throw new ContractError("verified facts packet exceeded the size limit");
    const rawDigest = sha256(text);
    if (rawDigest !== sealedManifest.facts.digest) throw new ContractError("verified facts bytes differ from their sealed digest");
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new ContractError("verified facts packet is not valid JSON"); }
    if (!isRecord(value) || value.schemaVersion !== 1 || value.appId !== sealedManifest.appId || !isRecord(value.provenance) || value.provenance.synthetic !== true || value.provenance.owned !== true || value.provenance.private !== false || !Array.isArray(value.facts)) {
      throw new ContractError("verified facts provenance contract is invalid");
    }
    assertString(value.subjectId, "verifiedFacts.subjectId");
    assertString(value.verifiedAt, "verifiedFacts.verifiedAt");
    const facts = value.facts.map((fact) => {
      if (!isRecord(fact)) throw new ContractError("verified fact must be an object");
      assertString(fact.id, "verifiedFact.id");
      assertString(fact.field, "verifiedFact.field");
      if (typeof fact.value !== "string" && typeof fact.value !== "number") throw new ContractError("verified fact value must be public text or number");
      if (!sealedManifest.facts.fields.includes(fact.field)) throw new ContractError(`verified fact field was not sealed in manifest: ${fact.field}`);
      return { id: fact.id, field: fact.field, value: fact.value, ...(typeof fact.unit === "string" ? { unit: fact.unit } : {}) };
    });
    return {
      packet: {
        schemaVersion: 1,
        appId: value.appId,
        subjectId: value.subjectId,
        verifiedAt: value.verifiedAt,
        provenance: { synthetic: true, owned: true, private: false },
        facts,
      },
      rawDigest,
    };
  }
}

export function authoritativeTask(userTask: string, manifest: DemoManifest): FrozenTaskContract {
  return {
    version: TASK_CONTRACT_VERSION,
    userTask: normalizeTaskText(userTask),
    fingerprint: manifest.taskFingerprint,
    steps: manifest.task.steps.map(({ id, instruction }) => ({ id, instruction })),
    viewports: DEFAULT_VIEWPORTS,
    criticalInvariants: manifest.criticalInvariants,
  };
}

export function manifestDigest(manifest: DemoManifest): string {
  return contentHash(manifest);
}
