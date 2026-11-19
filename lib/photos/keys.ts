import { DELIVERY_WIDTHS, MAX_DELIVERY_WIDTH } from "./types";

// A photo is stored in Cloudinary under a public id named by a hash of the file's content:
//   food-haus/menu/<16 hex>
// That id is what the database keeps. Delivery URLs are built from it; the same content always gets the same
// id, so a URL never changes meaning.

export const PUBLIC_ID = /^food-haus\/menu\/[0-9a-f]{16}$/;
export const isPublicId = (k: unknown): k is string => typeof k === "string" && PUBLIC_ID.test(k);

export async function publicIdFor(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return `food-haus/menu/${[...d.slice(0, 8)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

const CLOUD_RE = /^[A-Za-z0-9_-]{2,64}$/;
export const isCloudName = (c: unknown): c is string => typeof c === "string" && CLOUD_RE.test(c);

/**
 * One size of a photo, served by Cloudinary: 4:3, never wider than 1,600 px, never enlarged (c_lfill), automatic
 * format (f_auto: WebP or AVIF where the browser can) and quality (q_auto), smart crop (g_auto). Returns "" for
 * anything that is not a valid cloud name and id, so a bad stored value shows no picture instead of a broken one.
 */
export function photoUrl(cloud: string | null | undefined, publicId: string, width: number): string {
  if (!isCloudName(cloud) || !isPublicId(publicId)) return "";
  const w = Math.min(Math.max(Math.round(width), 1), MAX_DELIVERY_WIDTH);
  return `https://res.cloudinary.com/${cloud}/image/upload/c_lfill,ar_4:3,g_auto,w_${w},f_auto,q_auto/${publicId}`;
}

/** One size of a WIDE (16:9) photo, for the admin-uploaded home banner. Same rules as photoUrl. */
export function bannerUrl(cloud: string | null | undefined, publicId: string, width: number): string {
  if (!isCloudName(cloud) || !isPublicId(publicId)) return "";
  const w = Math.min(Math.max(Math.round(width), 1), MAX_DELIVERY_WIDTH);
  return `https://res.cloudinary.com/${cloud}/image/upload/c_lfill,ar_16:9,g_auto,w_${w},f_auto,q_auto/${publicId}`;
}
export function bannerSrcSet(cloud: string | null | undefined, publicId: string): string {
  return DELIVERY_WIDTHS.map((w) => ({ w, u: bannerUrl(cloud, publicId, w) }))
    .filter((x) => x.u)
    .map((x) => `${x.u} ${x.w}w`)
    .join(", ");
}

/** One size of a SQUARE photo, for the admin-uploaded hero picture. Same rules as photoUrl. */
export function squareUrl(cloud: string | null | undefined, publicId: string, width: number): string {
  if (!isCloudName(cloud) || !isPublicId(publicId)) return "";
  const w = Math.min(Math.max(Math.round(width), 1), MAX_DELIVERY_WIDTH);
  return `https://res.cloudinary.com/${cloud}/image/upload/c_lfill,ar_1:1,g_auto,w_${w},f_auto,q_auto/${publicId}`;
}
export function squareSrcSet(cloud: string | null | undefined, publicId: string): string {
  return DELIVERY_WIDTHS.map((w) => ({ w, u: squareUrl(cloud, publicId, w) }))
    .filter((x) => x.u)
    .map((x) => `${x.u} ${x.w}w`)
    .join(", ");
}

/** The srcset for a photo: every delivery width, each described by its real width. */
export function photoSrcSet(cloud: string | null | undefined, publicId: string): string {
  return DELIVERY_WIDTHS.map((w) => ({ w, u: photoUrl(cloud, publicId, w) }))
    .filter((x) => x.u)
    .map((x) => `${x.u} ${x.w}w`)
    .join(", ");
}
