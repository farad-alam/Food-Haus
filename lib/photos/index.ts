import { CloudflareImagesProcessor, type ImagesBinding } from "./processor-cloudflare";
import { SharpImageProcessor } from "./processor-sharp";
import { FsPhotoStore } from "./store-fs";
import { R2PhotoStore, type R2BucketLike } from "./store-r2";
import type { ImageProcessor, PhotoStore } from "./types";

// Picks the storage and processor for THIS environment.
//  - On Cloudflare the PHOTOS (R2) and IMAGES bindings exist: use them.
//  - Anywhere else (local dev, tests, `next start`): a folder on disk and sharp.
//  - In production (APP_ENV=production) a missing binding is an ERROR, never a quiet fall back to
//    local disk, because a Worker has no persistent disk and uploads would vanish.

type Bindings = { PHOTOS?: R2BucketLike; IMAGES?: ImagesBinding };

async function bindings(): Promise<Bindings> {
  try {
    const m = await import("@opennextjs/cloudflare");
    return (m.getCloudflareContext().env ?? {}) as Bindings;
  } catch {
    return {}; // not running on Cloudflare
  }
}

const isProduction = () => process.env.APP_ENV === "production";
const onWorkers = () => typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

/** Thrown when this deployment has nowhere to keep photos (no R2 bucket / Images binding). The admin is told in plain words. */
export class PhotoSetupError extends Error {
  constructor(what: string) {
    super(`Photo upload is not set up on this site yet (${what}).`);
    this.name = "PhotoSetupError";
  }
}
export const PHOTO_SETUP_MESSAGE = "Photo upload is not switched on for this site yet. It needs a Cloudflare R2 bucket and the Images service connected. Everything else works without photos.";

/** Is there a place to put photos here? Local development always has one (a folder); on Cloudflare it needs the bindings. */
export function photoStorageNeedsSetup(b: { PHOTOS?: unknown; IMAGES?: unknown }, runtime: { workers: boolean; production: boolean }): string | null {
  if (b.PHOTOS && b.IMAGES) return null;
  if (!runtime.workers && !runtime.production) return null;
  return [!b.PHOTOS && "the PHOTOS R2 bucket", !b.IMAGES && "the IMAGES binding"].filter(Boolean).join(" and ") + " missing";
}

export async function getPhotoStore(): Promise<PhotoStore> {
  const b = await bindings();
  if (b.PHOTOS) return new R2PhotoStore(b.PHOTOS);
  // On Cloudflare there is no disk to fall back to, and in production a missing binding is an error, never local storage.
  if (onWorkers() || isProduction()) throw new PhotoSetupError("the PHOTOS R2 bucket is missing");
  return new FsPhotoStore(process.env.PHOTO_STORE_DIR || ".data/photos");
}

export async function getImageProcessor(): Promise<ImageProcessor> {
  const b = await bindings();
  if (b.IMAGES) return new CloudflareImagesProcessor(b.IMAGES);
  if (onWorkers() || isProduction()) throw new PhotoSetupError("the IMAGES binding is missing");
  return new SharpImageProcessor();
}
