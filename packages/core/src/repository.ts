import { LifecycleError } from "./errors.js";
import type { CourtRun } from "./types.js";
import type { RunRepository } from "./ports.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryRunRepository implements RunRepository {
  readonly #runs = new Map<string, CourtRun>();

  async create(run: CourtRun): Promise<void> {
    if (this.#runs.has(run.id)) throw new LifecycleError(`run already exists: ${run.id}`);
    this.#runs.set(run.id, clone(run));
  }

  async get(runId: string): Promise<CourtRun | undefined> {
    const run = this.#runs.get(runId);
    return run ? clone(run) : undefined;
  }

  async list(): Promise<CourtRun[]> {
    return [...this.#runs.values()]
      .map((run) => clone(run))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async save(run: CourtRun, expectedRevision: number): Promise<void> {
    const current = this.#runs.get(run.id);
    if (!current) throw new LifecycleError(`run does not exist: ${run.id}`);
    if (current.revision !== expectedRevision) {
      throw new LifecycleError(`stale run revision: expected ${expectedRevision}, current ${current.revision}`);
    }
    if (run.revision !== expectedRevision + 1) throw new LifecycleError("saved run revision must advance exactly once");
    this.#runs.set(run.id, clone(run));
  }
}
