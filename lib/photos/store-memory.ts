import { isFileKey } from "./keys";
import type { PhotoStore } from "./types";

export class MemoryPhotoStore implements PhotoStore {
  readonly kind = "memory" as const;
  readonly files = new Map<string, { body: Uint8Array; contentType: string }>();
  private key(k: string): string {
    if (!isFileKey(k)) throw new Error(`Refusing unexpected photo key: ${JSON.stringify(k).slice(0, 80)}`); // same rule as the real stores
    return k;
  }
  async put(key: string, body: Uint8Array, opts: { contentType: string }) {
    this.files.set(this.key(key), { body: body.slice(), contentType: opts.contentType });
  }
  async get(key: string) {
    const f = this.files.get(this.key(key));
    return f ? { body: f.body.slice(), contentType: f.contentType } : null;
  }
  async delete(keys: string[]) {
    for (const k of keys) this.files.delete(this.key(k));
  }
}
