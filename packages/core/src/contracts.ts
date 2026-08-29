import { ContractError } from "./errors.js";
import { contentHash, sha256 } from "./hash.js";
import type {
  FrozenTaskContract,
  PatchCandidate,
  RunRequest,
  SourceSnapshot,
} from "./types.js";

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_RELATIVE_PATH = /^(?![A-Za-z]:)(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[^\0]+$/;
const PROTECTED_PATH = /(?:^|\/)(?:\.git|\.env(?:\.|$)|node_modules|tasks?|benchmarks?|tests?\/e2e|receipts?|judges?|gates?)(?:\/|$)/i;

export function normalizeTaskText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function fingerprintTask(userTask: string, version = "pc-task-v1"): string {
  return contentHash({ version, userTask: normalizeTaskText(userTask) });
}

export function validateRunRequest(request: RunRequest): void {
  if (normalizeTaskText(request.userTask).length < 12) throw new ContractError("userTask must describe an executable user outcome");
  let target: URL;
  try {
    target = new URL(request.targetUrl);
  } catch {
    throw new ContractError("targetUrl must be an absolute http(s) URL");
  }
  if (!new Set(["http:", "https:"]).has(target.protocol)) throw new ContractError("targetUrl must use http or https");
  if (target.username || target.password) throw new ContractError("targetUrl cannot contain credentials");
  for (const key of target.searchParams.keys()) {
    if (/(?:key|token|secret|signature|auth|cookie)/i.test(key)) throw new ContractError("targetUrl cannot contain credential-like query parameters");
  }
}

export function createFrozenTask(request: RunRequest, defaults?: Partial<FrozenTaskContract>): FrozenTaskContract {
  const version = request.taskContractVersion ?? defaults?.version ?? "pc-task-v1";
  const userTask = normalizeTaskText(request.userTask);
  return {
    version,
    userTask,
    fingerprint: fingerprintTask(userTask, version),
    steps: defaults?.steps ?? [{ id: "user-outcome", instruction: userTask }],
    viewports: defaults?.viewports ?? [
      { name: "desktop", width: 1280, height: 720 },
      { name: "mobile", width: 390, height: 844 },
    ],
    criticalInvariants: defaults?.criticalInvariants ?? [],
  };
}

export function validateFrozenTaskOverride(task: FrozenTaskContract, request: RunRequest): void {
  if (task.userTask !== normalizeTaskText(request.userTask)) throw new ContractError("authoritative task text does not match the submitted task");
  if (request.taskContractVersion && task.version !== request.taskContractVersion) throw new ContractError("requested task contract version does not match the authoritative task");
  if (!SHA256.test(task.fingerprint)) throw new ContractError("authoritative task fingerprint must be SHA-256");
  if (!task.version.trim() || task.steps.length === 0 || task.viewports.length === 0) throw new ContractError("authoritative task contract is incomplete");
  if (new Set(task.steps.map((step) => step.id)).size !== task.steps.length) throw new ContractError("authoritative task step IDs must be unique");
}

export function validateSnapshot(snapshot: SourceSnapshot): void {
  if (!SHA256.test(snapshot.digest) || !SHA256.test(snapshot.manifestDigest)) throw new ContractError("snapshot digests must be SHA-256");
  if (!snapshot.benchmarkId.trim() || !snapshot.appId.trim()) throw new ContractError("snapshot benchmarkId and appId are required");
  if (snapshot.candidateDigest && !SHA256.test(snapshot.candidateDigest)) throw new ContractError("candidate snapshot digest must be SHA-256");
  if (snapshot.patchDigest && !SHA256.test(snapshot.patchDigest)) throw new ContractError("patch digest must be SHA-256");
  if (snapshot.verifiedFactsDigest && !SHA256.test(snapshot.verifiedFactsDigest)) throw new ContractError("verified facts digest must be SHA-256");
  if (snapshot.allowlistedFiles.length === 0) throw new ContractError("snapshot must define an explicit patch allowlist");
  for (const file of snapshot.allowlistedFiles) assertSafeRelativePath(file);
}

export function assertSafeRelativePath(file: string): void {
  const normalized = file.replaceAll("\\", "/");
  if (!SAFE_RELATIVE_PATH.test(normalized) || PROTECTED_PATH.test(normalized)) {
    throw new ContractError(`patch path is not allowed: ${file}`);
  }
}

export function validatePatchCandidate(patch: PatchCandidate, snapshot: SourceSnapshot): void {
  if (patch.baseDigest !== snapshot.digest) throw new ContractError("candidate does not start from the sealed source snapshot");
  if (!SHA256.test(patch.candidateDigest) || !SHA256.test(patch.diffDigest)) throw new ContractError("candidate digests must be SHA-256");
  if (patch.diffDigest !== sha256(patch.diff)) throw new ContractError("candidate diff digest does not match its diff");
  if (patch.files.length === 0) throw new ContractError("candidate patch changed no files");
  const runtimeProofCount = Number(Boolean(patch.runtimeArtifactId)) + Number(Boolean(patch.runtimeArtifactSha256));
  if (runtimeProofCount === 1 || (patch.runtimeArtifactSha256 && !SHA256.test(patch.runtimeArtifactSha256))) {
    throw new ContractError("runtime candidate artifact id and SHA-256 must be sealed together");
  }
  const groundingProofCount = Number(Boolean(patch.groundingArtifactId)) + Number(Boolean(patch.groundingArtifactSha256));
  if (groundingProofCount === 1 || (patch.groundingArtifactSha256 && !SHA256.test(patch.groundingArtifactSha256))) {
    throw new ContractError("candidate grounding artifact id and SHA-256 must be sealed together");
  }
  if (patch.groundingArtifactId && !/^[a-z0-9][a-z0-9._-]{2,127}$/.test(patch.groundingArtifactId)) throw new ContractError("candidate grounding artifact id is unsafe");
  if (patch.provider?.mode === "live") {
    if (groundingProofCount !== 2 || runtimeProofCount !== 2 || !patch.verifiedFactsDigest) {
      throw new ContractError("live candidate is missing its runtime, grounding, or verified-facts proof");
    }
    if (patch.verifiedFactsDigest !== snapshot.verifiedFactsDigest) throw new ContractError("live candidate facts digest differs from the sealed snapshot");
    if (!Number.isInteger(patch.synthesisAttemptCount) || (patch.synthesisAttemptCount ?? 0) < 1 || (patch.synthesisAttemptCount ?? 0) > 2) {
      throw new ContractError("live candidate must record one or two bounded synthesis attempts");
    }
    if (!Array.isArray(patch.rejectedSynthesisDigests) || patch.rejectedSynthesisDigests.length !== (patch.synthesisAttemptCount ?? 1) - 1 || !patch.rejectedSynthesisDigests.every((digest) => SHA256.test(digest))) {
      throw new ContractError("live candidate rejected synthesis digests do not match its attempt count");
    }
  }
  if (Boolean(patch.runtimeArtifactId) !== Boolean(patch.runtimeArtifactSha256)) throw new ContractError("runtime candidate artifact id and digest must be provided together");
  if (patch.runtimeArtifactSha256 && !SHA256.test(patch.runtimeArtifactSha256)) throw new ContractError("runtime candidate artifact digest must be SHA-256");
  if (patch.runtimeArtifactId && !/^[a-z0-9][a-z0-9._-]{2,127}$/.test(patch.runtimeArtifactId)) throw new ContractError("runtime candidate artifact id is unsafe");
  const allowed = new Set(snapshot.allowlistedFiles.map((file) => file.replaceAll("\\", "/")));
  for (const file of patch.files) {
    assertSafeRelativePath(file);
    if (!allowed.has(file.replaceAll("\\", "/"))) throw new ContractError(`patch escaped the source allowlist: ${file}`);
  }
}
