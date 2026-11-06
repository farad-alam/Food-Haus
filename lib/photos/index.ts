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

export async function getPhotoStore(): Promise<PhotoStore> {
  const b = await bindings();
  if (b.PHOTOS) return new R2PhotoStore(b.PHOTOS);
  if (isProduction()) throw new Error("Photo storage is not configured: the PHOTOS R2 binding is missing.");
  return new FsPhotoStore(process.env.PHOTO_STORE_DIR || ".data/photos");
}

export async function getImageProcessor(): Promise<ImageProcessor> {
  const b = await bindings();
  if (b.IMAGES) return new CloudflareImagesProcessor(b.IMAGES);
  if (isProduction()) throw new Error("Image processing is not configured: the IMAGES binding is missing.");
  return new SharpImageProcessor();
}
