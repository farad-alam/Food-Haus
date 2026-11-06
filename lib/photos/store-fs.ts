import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { isFileKey } from "./keys";
import type { PhotoStore } from "./types";

/** Development store: files in a folder. Only well-formed photo keys are ever turned into paths. */
export class FsPhotoStore implements PhotoStore {
  readonly kind = "fs" as const;
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private path(key: string): string {
    if (!isFileKey(key)) throw new Error(`Refusing unexpected photo key: ${JSON.stringify(key).slice(0, 80)}`);
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error("Photo key escapes the storage folder.");
    return p;
  }
  async put(key: string, body: Uint8Array, opts: { contentType: string }) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${crypto.randomUUID()}.tmp`; // write then rename, so a reader never sees half a file
    await writeFile(tmp, body);
    await writeFile(`${p}.type`, opts.contentType);
    await rename(tmp, p);
  }
  async get(key: string) {
    const p = this.path(key);
    try {
      const [body, type] = await Promise.all([readFile(p), readFile(`${p}.type`, "utf8").catch(() => "application/octet-stream")]);
      return { body: new Uint8Array(body), contentType: type };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async delete(keys: string[]) {
    for (const k of keys) {
      const p = this.path(k);
      await rm(p, { force: true });
      await rm(`${p}.type`, { force: true });
    }
  }
}
