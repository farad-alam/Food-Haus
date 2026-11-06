import { isFileKey } from "./keys";
import type { PhotoStore } from "./types";

// Cloudflare R2, through the bucket BINDING on the Worker (wrangler.jsonc: r2_buckets, binding
// "PHOTOS"). No access keys exist anywhere: the binding is the credential.
//
// UNVERIFIED against a real bucket (none was available when this was written). Checked only
// against a fake that follows the documented R2 Workers API: put(key, value, { httpMetadata }),
// get(key) -> object with arrayBuffer() and httpMetadata, delete(key | key[]).
// See docs/security-checklist.md, "Photo upload", for what to verify after the first deploy.

export type R2BucketLike = {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>;
  delete(keys: string | string[]): Promise<void>;
};

export class R2PhotoStore implements PhotoStore {
  readonly kind = "r2" as const;
  constructor(private readonly bucket: R2BucketLike) {}
  private key(k: string): string {
    if (!isFileKey(k)) throw new Error(`Refusing unexpected photo key: ${JSON.stringify(k).slice(0, 80)}`);
    return k;
  }
  async put(key: string, body: Uint8Array, opts: { contentType: string }) {
    await this.bucket.put(this.key(key), body, { httpMetadata: { contentType: opts.contentType, cacheControl: "public, max-age=31536000, immutable" } });
  }
  async get(key: string) {
    const o = await this.bucket.get(this.key(key));
    if (!o) return null;
    return { body: new Uint8Array(await o.arrayBuffer()), contentType: o.httpMetadata?.contentType ?? "application/octet-stream" };
  }
  async delete(keys: string[]) {
    if (keys.length) await this.bucket.delete(keys.map((k) => this.key(k)));
  }
}
