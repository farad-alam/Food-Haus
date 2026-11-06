import { VARIANTS } from "./types";

// A photo is stored as one file per size, named by a hash of its content:
//   menu/<16 hex>-<width>.webp   e.g. menu/9f2c04ab77d1e3c5-800.webp
// The base key (menu/<16 hex>) is what the database keeps. The content never changes under a key,
// so the files are served as immutable and cached for a year.

export const BASE_KEY = /^menu\/[0-9a-f]{16}$/;
export const FILE_KEY = /^menu\/[0-9a-f]{16}-(?:400|800|1200)\.webp$/;

export const isBaseKey = (k: unknown): k is string => typeof k === "string" && BASE_KEY.test(k);
export const isFileKey = (k: unknown): k is string => typeof k === "string" && FILE_KEY.test(k);
export const variantKey = (base: string, width: number) => `${base}-${width}.webp`;
export const allVariantKeys = (base: string) => VARIANTS.map((v) => variantKey(base, v.width));

export async function baseKeyFor(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return `menu/${[...d.slice(0, 8)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** URL a browser uses for one size of a photo. */
export const photoUrl = (base: string, width: number) => `/media/${variantKey(base, width)}`;
export const photoSrcSet = (base: string) => VARIANTS.map((v) => `${photoUrl(base, v.width)} ${v.width}w`).join(", ");
