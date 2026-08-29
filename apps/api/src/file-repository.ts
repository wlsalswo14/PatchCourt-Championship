import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { LifecycleError, sanitizeForPersistence, type CourtRun, type RunRepository } from "@patchcourt/core";

const SAFE_RUN_ID = /^[a-z0-9][a-z0-9_-]{2,100}$/i;

export class FileRunRepository implements RunRepository {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  #path(runId: string): string {
    if (!SAFE_RUN_ID.test(runId)) throw new LifecycleError("run id is invalid");
    return join(this.root, `${runId}.json`);
  }

  async create(run: CourtRun): Promise<void> {
    await mkdir(this.root, { recursive: true });
    try {
      await writeFile(this.#path(run.id), JSON.stringify(sanitizeForPersistence(run), null, 2), { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new LifecycleError(`run already exists: ${run.id}`);
      throw error;
    }
  }

  async get(runId: string): Promise<CourtRun | undefined> {
    try {
      return JSON.parse(await readFile(this.#path(runId), "utf8")) as CourtRun;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async list(): Promise<CourtRun[]> {
    try {
      const files = (await readdir(this.root)).filter((file) => file.endsWith(".json"));
      const runs = await Promise.all(files.map((file) => this.get(file.slice(0, -5))));
      return runs.filter((run): run is CourtRun => Boolean(run)).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async save(run: CourtRun, expectedRevision: number): Promise<void> {
    const current = await this.get(run.id);
    if (!current || current.revision !== expectedRevision) throw new LifecycleError("stale or missing run revision");
    if (run.revision !== expectedRevision + 1) throw new LifecycleError("run revision must advance exactly once");
    await mkdir(this.root, { recursive: true });
    const path = this.#path(run.id);
    const temporary = join(this.root, `${run.id}.${process.pid}.${run.revision}.tmp`);
    await writeFile(temporary, JSON.stringify(sanitizeForPersistence(run), null, 2), "utf8");
    await rename(temporary, path);
  }
}
