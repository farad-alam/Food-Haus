import { getCloudinaryConfig, type CloudinaryConfig } from "./cloudinary";

export { getPhotoCloudName } from "./cloudinary";

/** Thrown when this deployment has no Cloudinary credentials. The admin is told in plain words. */
export class PhotoSetupError extends Error {
  constructor() {
    super("Photo upload is not set up on this site yet (the Cloudinary settings are missing).");
    this.name = "PhotoSetupError";
  }
}
export const PHOTO_SETUP_MESSAGE = "Photo upload is not switched on for this site yet. It needs a Cloudinary account connected (three settings on the website's hosting). Everything else works without photos.";
export const PHOTO_SERVICE_MESSAGE = "The photo service did not accept that. Please try again in a minute. If it keeps happening, the Cloudinary settings may be wrong.";

/** The credentials, or a PhotoSetupError when they are not all set. */
export function requireCloudinary(): CloudinaryConfig {
  const c = getCloudinaryConfig();
  if (!c) throw new PhotoSetupError();
  return c;
}
