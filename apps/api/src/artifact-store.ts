import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { ContractError, sha256, type EvidenceKind, type Variant } from "@patchcourt/core";

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{2,127}$/;

export class ArtifactStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(input: {
    runId: string;
    variant: Variant;
    viewport: string;
    stepId: string;
    kind: EvidenceKind | "candidate-data";
    extension: "png" | "json";
    bytes: Uint8Array;
  }): Promise<{ id: string; sha256: string; uri: string }> {
    await mkdir(this.root, { recursive: true });
    const opaqueArm = sha256(`${input.runId}:${input.variant}`).slice(0, 12);
    const base = `art-${opaqueArm}-${input.viewport}-${input.stepId}-${input.kind}`
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .slice(0, 50);
    const digest = sha256(input.bytes);
    const id = `${base}-${digest}.${input.extension}`;
    if (!SAFE_ID.test(id)) throw new ContractError("generated artifact id is unsafe");
    const destination = join(this.root, id);
    const temporary = join(this.root, `${id}.${process.pid}.tmp`);
    await writeFile(temporary, input.bytes, { flag: "wx" }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
      await writeFile(temporary, input.bytes);
    });
    await rename(temporary, destination);
    const verified = await readFile(destination);
    if (sha256(verified) !== digest) throw new ContractError("artifact bytes failed post-write SHA-256 verification");
    return { id, sha256: digest, uri: `artifact://${id}` };
  }

  async read(id: string): Promise<{ bytes: Buffer; contentType: string }> {
    if (!SAFE_ID.test(id)) throw new ContractError("artifact id is invalid");
    const path = resolve(this.root, id);
    if (!path.startsWith(`${this.root}\\`) && !path.startsWith(`${this.root}/`)) throw new ContractError("artifact path escaped storage root");
    const bytes = await readFile(path);
    const expected = id.match(/-([a-f0-9]{64})\.(?:png|json)$/)?.[1];
    if (!expected || sha256(bytes) !== expected) throw new ContractError("stored artifact failed read-time SHA-256 verification");
    const contentType = id.endsWith(".png") ? "image/png" : "application/json; charset=utf-8";
    return { bytes, contentType };
  }
}
