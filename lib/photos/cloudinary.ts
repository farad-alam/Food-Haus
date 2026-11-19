import { isCloudName } from "./keys";

// Cloudinary, with no Node SDK: plain fetch and Web Crypto, so it runs on Cloudflare Workers (R9.7).
//
// Credentials come from Worker RUNTIME variables, never from the browser bundle or the repository:
//   CLOUDINARY_CLOUD_NAME   (public by design: it appears in every image URL)
//   CLOUDINARY_API_KEY
//   CLOUDINARY_API_SECRET   (a secret: only used here, to sign requests; it is never sent to Cloudinary or the browser)
//
// Signed requests: Cloudinary's documented scheme. The signature is the SHA-1 hex digest of the request's
// parameters (all except file, api_key, cloud_name and resource_type), sorted by name, written as
// "name=value&name=value", with the API secret appended.
//
// UNVERIFIED against the real service (no account was available when this was written); checked against a mock
// that follows Cloudinary's documented upload and destroy endpoints. See docs/preview-deploy.md.

export type CloudinaryConfig = { cloudName: string; apiKey: string; apiSecret: string };

export function cloudinaryConfigFromEnv(env: Record<string, string | undefined>): CloudinaryConfig | null {
  const cloudName = env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = env.CLOUDINARY_API_SECRET?.trim();
  if (!isCloudName(cloudName) || !apiKey || !/^\d{6,20}$/.test(apiKey) || !apiSecret || !/^[A-Za-z0-9_-]{10,100}$/.test(apiSecret)) return null;
  return { cloudName, apiKey, apiSecret };
}

export const getCloudinaryConfig = (): CloudinaryConfig | null =>
  cloudinaryConfigFromEnv({
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  });

/** The cloud name alone, for building image URLs on the server (it is public: it is in every image address). */
export const getPhotoCloudName = (): string | null => {
  const c = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  return isCloudName(c) ? c : null;
};

export async function signParams(params: Record<string, string | number>, apiSecret: string): Promise<string> {
  const text = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&") + apiSecret;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text)));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** The service could not take or remove the photo for a reason that is not about the picture (credentials, outage, timeout). */
export class PhotoServiceError extends Error {
  constructor(public readonly status: number, detail: string) {
    super(`Cloudinary: ${detail}`);
    this.name = "PhotoServiceError";
  }
}
/** Cloudinary refused THIS picture (HTTP 400): not a usable image. */
export class PhotoRejectedError extends Error {
  constructor(detail: string) {
    super(`Cloudinary rejected the image: ${detail}`);
    this.name = "PhotoRejectedError";
  }
}

const API = "https://api.cloudinary.com/v1_1";
const TIMEOUT_MS = 25_000;

// Applied to the STORED original, once, as it arrives: turn the camera's rotation into real pixels, never keep an
// original larger than 1,600 px, and remove ALL metadata (EXIF, GPS, IPTC), so a delivery URL with the transformations
// removed still cannot reveal where a photo was taken.
const INCOMING = "a_exif/c_limit,w_1600,h_1600/fl_force_strip";
const ALLOWED = "jpg,jpeg,png,webp";

async function post(cfg: CloudinaryConfig, path: string, body: FormData): Promise<{ status: number; json: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(`${API}/${encodeURIComponent(cfg.cloudName)}/${path}`, { method: "POST", body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new PhotoServiceError(0, e instanceof Error ? e.name : "network error");
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}
const errorText = (json: Record<string, unknown>) => String((json.error as { message?: unknown } | undefined)?.message ?? "no detail").slice(0, 200);

/** Uploads one image under `publicId`. Same id again means the same content, so an existing asset is kept (overwrite=false). */
export async function uploadPhoto(cfg: CloudinaryConfig, bytes: Uint8Array, publicId: string, mime: string): Promise<{ publicId: string; width: number; height: number }> {
  const params = {
    allowed_formats: ALLOWED,
    overwrite: "false",
    public_id: publicId,
    timestamp: Math.floor(Date.now() / 1000),
    transformation: INCOMING,
    unique_filename: "false",
    use_filename: "false",
  };
  const form = new FormData();
  for (const [k, v] of Object.entries(params)) form.set(k, String(v));
  form.set("api_key", cfg.apiKey);
  form.set("signature", await signParams(params, cfg.apiSecret));
  form.set("file", new Blob([bytes as BlobPart], { type: mime }), "photo");
  const { status, json } = await post(cfg, "image/upload", form);
  if (status === 400) throw new PhotoRejectedError(errorText(json));
  if (status < 200 || status >= 300 || typeof json.public_id !== "string") throw new PhotoServiceError(status, errorText(json));
  return { publicId: json.public_id, width: Number(json.width) || 0, height: Number(json.height) || 0 };
}

/** Removes an asset (and purges its cached copies). A missing asset is not an error. */
export async function destroyPhoto(cfg: CloudinaryConfig, publicId: string): Promise<void> {
  const params = { invalidate: "true", public_id: publicId, timestamp: Math.floor(Date.now() / 1000) };
  const form = new FormData();
  for (const [k, v] of Object.entries(params)) form.set(k, String(v));
  form.set("api_key", cfg.apiKey);
  form.set("signature", await signParams(params, cfg.apiSecret));
  const { status, json } = await post(cfg, "image/destroy", form);
  if (status < 200 || status >= 300) throw new PhotoServiceError(status, errorText(json));
  // json.result is "ok" or "not found": both mean the asset is gone.
}
