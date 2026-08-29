import { LifecycleError } from "./errors.js";
import type { RunStatus } from "./types.js";

export const TERMINAL_STATUSES = new Set<RunStatus>(["promoted", "rejected", "invalid"]);

const ORDERED: RunStatus[] = [
  "created",
  "snapshotting",
  "observing_incumbent",
  "criticizing",
  "compiling_feedback",
  "patching_candidate",
  "observing_candidate",
  "deterministic_gates",
  "blind_comparison",
];

const ALLOWED = new Map<RunStatus, ReadonlySet<RunStatus>>();
for (let index = 0; index < ORDERED.length; index += 1) {
  const status = ORDERED[index];
  const next = ORDERED[index + 1];
  if (status && next) ALLOWED.set(status, new Set([next, "invalid"]));
}
ALLOWED.set("blind_comparison", new Set(["promoted", "rejected", "invalid"]));
ALLOWED.set("promoted", new Set());
ALLOWED.set("rejected", new Set());
ALLOWED.set("invalid", new Set());

export function assertTransition(from: RunStatus, to: RunStatus): void {
  if (!ALLOWED.get(from)?.has(to)) throw new LifecycleError(`invalid run transition: ${from} -> ${to}`);
}

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
