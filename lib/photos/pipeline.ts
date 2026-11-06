import { baseKeyFor, allVariantKeys, variantKey } from "./keys";
import { sniffImage } from "./sniff";
import { MAX_UPLOAD_BYTES, MIN_SOURCE, VARIANTS, type ImageProcessor, type PhotoStore } from "./types";

export type PhotoError = "TOO_BIG" | "NOT_AN_IMAGE" | "TOO_SMALL" | "UNREADABLE";
export const PHOTO_MESSAGES: Record<PhotoError, string> = {
  TOO_BIG: `That file is too big. Photos can be up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
  NOT_AN_IMAGE: "That is not a JPEG, PNG or WebP photo. Please choose one of those.",
  TOO_SMALL: `That photo is too small. It needs to be at least ${MIN_SOURCE.width} x ${MIN_SOURCE.height} pixels so it looks sharp.`,
  UNREADABLE: "We could not read that image. It may be damaged. Try another photo.",
};

/**
 * Validates an upload, makes every size and stores them. Returns the base key to keep in the
 * database. All files are written BEFORE anything points at them, so the menu can never reference
 * a photo that is not there.
 */
export async function storeUploadedPhoto(deps: { store: PhotoStore; processor: ImageProcessor }, input: Uint8Array): Promise<{ ok: true; base: string } | { ok: false; error: PhotoError }> {
  if (input.byteLength > MAX_UPLOAD_BYTES) return { ok: false, error: "TOO_BIG" };
  if (!sniffImage(input)) return { ok: false, error: "NOT_AN_IMAGE" };
  let dims;
  try {
    dims = await deps.processor.inspect(input);
  } catch {
    return { ok: false, error: "UNREADABLE" };
  }
  if (dims.width < MIN_SOURCE.width || dims.height < MIN_SOURCE.height) return { ok: false, error: "TOO_SMALL" };
  let rendered;
  try {
    rendered = await Promise.all(VARIANTS.map((v) => deps.processor.render(input, v)));
  } catch {
    return { ok: false, error: "UNREADABLE" };
  }
  const base = await baseKeyFor(rendered[rendered.length - 1].bytes); // named by what was produced, never by what was uploaded
  await Promise.all(rendered.map((r, i) => deps.store.put(variantKey(base, VARIANTS[i].width), r.bytes, { contentType: "image/webp" })));
  return { ok: true, base };
}

export async function deletePhotoFiles(store: PhotoStore, base: string | null | undefined): Promise<void> {
  if (!base) return;
  try {
    await store.delete(allVariantKeys(base));
  } catch (e) {
    console.error("photo cleanup failed", base, e instanceof Error ? e.message : e); // an orphan file is harmless; never fail the request for it
  }
}
