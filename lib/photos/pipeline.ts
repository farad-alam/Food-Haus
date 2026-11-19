import { destroyPhoto, PhotoRejectedError, uploadPhoto, type CloudinaryConfig } from "./cloudinary";
import { imageDimensions } from "./dimensions";
import { publicIdFor } from "./keys";
import { sniffImage } from "./sniff";
import { MAX_SOURCE_PIXELS, MAX_UPLOAD_BYTES, MIN_SOURCE } from "./types";

export type PhotoError = "TOO_BIG" | "NOT_AN_IMAGE" | "TOO_SMALL" | "UNREADABLE";
export const PHOTO_MESSAGES: Record<PhotoError, string> = {
  TOO_BIG: `That file is too big. Photos can be up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
  NOT_AN_IMAGE: "That is not a JPEG, PNG or WebP photo. Please choose one of those.",
  TOO_SMALL: `That photo is too small. It needs to be at least ${MIN_SOURCE.width} x ${MIN_SOURCE.height} pixels so it looks sharp.`,
  UNREADABLE: "We could not read that image. It may be damaged. Try another photo.",
};

const MIME = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

/**
 * Checks an upload (size, real file type from its bytes, size in pixels) and only then sends it to Cloudinary.
 * Returns the public id to keep in the database. Nothing is sent anywhere for a file that fails a check.
 * Throws PhotoServiceError if Cloudinary itself is unavailable or refuses our credentials.
 */
export async function uploadValidatedPhoto(cfg: CloudinaryConfig, input: Uint8Array): Promise<{ ok: true; publicId: string } | { ok: false; error: PhotoError }> {
  if (input.byteLength > MAX_UPLOAD_BYTES) return { ok: false, error: "TOO_BIG" };
  const kind = sniffImage(input);
  if (!kind) return { ok: false, error: "NOT_AN_IMAGE" };
  const dims = imageDimensions(input, kind);
  if (!dims || dims.width * dims.height > MAX_SOURCE_PIXELS) return { ok: false, error: "UNREADABLE" };
  if (dims.width < MIN_SOURCE.width || dims.height < MIN_SOURCE.height) return { ok: false, error: "TOO_SMALL" };
  try {
    const r = await uploadPhoto(cfg, input, await publicIdFor(input), MIME[kind]);
    return { ok: true, publicId: r.publicId };
  } catch (e) {
    if (e instanceof PhotoRejectedError) return { ok: false, error: "UNREADABLE" };
    throw e;
  }
}

/** Removes an old photo. A failure only leaves an unused asset behind: it is logged and never fails the request. */
export async function deletePhotoAsset(cfg: CloudinaryConfig | null, publicId: string | null | undefined): Promise<void> {
  if (!publicId || !cfg) return;
  try {
    await destroyPhoto(cfg, publicId);
  } catch (e) {
    console.error("photo cleanup failed", publicId, e instanceof Error ? e.message : e);
  }
}
