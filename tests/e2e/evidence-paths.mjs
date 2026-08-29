import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_ROOT = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(E2E_ROOT, "../..");
export const TEST_RESULTS_ROOT = join(E2E_ROOT, ".artifacts", "test-results");
export const AUTHORITATIVE_EVIDENCE_ROOT = join(REPO_ROOT, "docs", "evidence");

const AUTHORITATIVE_UPDATE = process.env.PATCHCOURT_AUTHORITATIVE_EVIDENCE_UPDATE === "1";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function samePath(left, right) {
  return relative(resolve(left), resolve(right)) === "";
}

function isWithin(child, parent) {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!isAbsolute(path) && !path.startsWith(".."));
}

function evidenceDirectory({ envName, kind, authoritativeName }) {
  const fallback = join(TEST_RESULTS_ROOT, "evidence", kind);
  const configured = process.env[envName];
  const destination = configured ? resolve(E2E_ROOT, configured) : fallback;
  const authoritativeDestination = join(AUTHORITATIVE_EVIDENCE_ROOT, authoritativeName);

  if (isWithin(destination, AUTHORITATIVE_EVIDENCE_ROOT)) {
    assert(
      samePath(destination, authoritativeDestination),
      `${envName} may only target docs/evidence/${authoritativeName}`
    );
    assert(
      AUTHORITATIVE_UPDATE,
      `refusing to update docs/evidence/${authoritativeName} without the evidence:update command`
    );
    return destination;
  }

  assert(
    isWithin(destination, TEST_RESULTS_ROOT),
    `${envName} must target ${relative(REPO_ROOT, TEST_RESULTS_ROOT).replaceAll("\\", "/")} or the exact authoritative evidence directory`
  );
  return destination;
}

export const PROMOTION_EVIDENCE_DIR = evidenceDirectory({
  envName: "PATCHCOURT_EVIDENCE_DIR",
  kind: "promotion",
  authoritativeName: "latest",
});

export const REJECTION_EVIDENCE_DIR = evidenceDirectory({
  envName: "PATCHCOURT_REJECTION_EVIDENCE_DIR",
  kind: "rejection",
  authoritativeName: "rejection",
});

export function artifactUri(path, id) {
  if (isWithin(path, AUTHORITATIVE_EVIDENCE_ROOT)) {
    return relative(REPO_ROOT, path).replaceAll("\\", "/");
  }
  return `artifact://${id}`;
}
