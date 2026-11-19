// Menu photo rules (R9.7, R10.5, R11.15). Photos live in Cloudinary: the Worker checks the file, uploads it
// with a signed request, and every public image is a Cloudinary delivery URL (lib/photos/cloudinary.ts).

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // what a phone photo needs; blocks absurd uploads before anything is sent anywhere
export const MAX_SOURCE_PIXELS = 50_000_000; // refuses decompression bombs
export const MIN_SOURCE = { width: 1200, height: 900 }; // smaller photos would look soft at the largest size
/** Delivery widths (px). Every image is 4:3 and never wider than 1,600 px (R10.5). */
export const DELIVERY_WIDTHS = [400, 800, 1200, 1600] as const;
export const MAX_DELIVERY_WIDTH = 1600;
export const MAX_ALT_LENGTH = 200;
