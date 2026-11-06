// Menu photo storage and processing: two small interfaces so the app never depends on one vendor.
//
//   PhotoStore      where the finished files live
//     - MemoryPhotoStore   tests
//     - FsPhotoStore       local development (a folder on disk)
//     - R2PhotoStore       production (a Cloudflare R2 bucket bound to the Worker as PHOTOS)
//   ImageProcessor  decode, auto-rotate, crop, resize and re-encode an upload
//     - SharpImageProcessor    development, tests and any Node host
//     - CloudflareImagesProcessor   production (the Cloudflare Images binding, IMAGES)
//
// Only the interfaces and the rules below are shared; see lib/photos/index.ts for which pair is picked.

export interface PhotoStore {
  readonly kind: "memory" | "fs" | "r2";
  put(key: string, body: Uint8Array, opts: { contentType: string }): Promise<void>;
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  /** Missing keys are not an error. */
  delete(keys: string[]): Promise<void>;
}

export type ProcessedVariant = { width: number; height: number; bytes: Uint8Array };

export interface ImageProcessor {
  readonly kind: "sharp" | "cloudflare-images";
  /** Reads the dimensions of a (sniffed, size-checked) image, or throws if it cannot be decoded. */
  inspect(input: Uint8Array): Promise<{ width: number; height: number }>;
  /** Auto-rotates by EXIF, crops to `width`x`height` (centre), re-encodes as WebP and strips all metadata. */
  render(input: Uint8Array, size: { width: number; height: number }): Promise<ProcessedVariant>;
}

// ---- the rules (R9.7, R10.5, R11.15) ------------------------------------------------------------

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // what a phone photo needs; blocks absurd uploads before any decoding
export const MAX_SOURCE_PIXELS = 50_000_000; // refuses decompression bombs
export const MIN_SOURCE = { width: 1200, height: 900 }; // smaller photos would look soft at the largest size
/** 4:3 on every card so the layout never jumps (R10.8). Widths are at most 1,600 px (R10.5). */
export const VARIANTS = [
  { width: 400, height: 300 },
  { width: 800, height: 600 },
  { width: 1200, height: 900 },
] as const;
export const WEBP_QUALITY = 80;
export const MAX_ALT_LENGTH = 200;
