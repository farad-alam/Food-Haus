import type SharpFn from "sharp";
import { MAX_SOURCE_PIXELS, WEBP_QUALITY, type ImageProcessor } from "./types";

// Development, tests and any Node host. `sharp` is loaded by a computed name on purpose: it is a
// native module that cannot run on Cloudflare Workers, so the Workers bundle must never try to
// include it. (On Workers the Cloudflare Images processor is used instead.)
type Sharp = typeof SharpFn;
async function sharp(): Promise<Sharp> {
  const name = "sharp";
  return ((await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ name)) as { default: Sharp }).default;
}

export class SharpImageProcessor implements ImageProcessor {
  readonly kind = "sharp" as const;
  async inspect(input: Uint8Array) {
    const s = (await sharp())(input, { limitInputPixels: MAX_SOURCE_PIXELS, failOn: "error" });
    const m = await s.metadata();
    if (!m.width || !m.height) throw new Error("Could not read the image size.");
    // EXIF orientation 5-8 means the stored width and height are swapped for display.
    const swapped = (m.orientation ?? 1) >= 5;
    return swapped ? { width: m.height, height: m.width } : { width: m.width, height: m.height };
  }
  async render(input: Uint8Array, size: { width: number; height: number }) {
    const lib = await sharp();
    const out = await lib(input, { limitInputPixels: MAX_SOURCE_PIXELS, failOn: "error" })
      .rotate() // apply the camera's orientation, then forget it
      .resize({ width: size.width, height: size.height, fit: "cover", position: "centre" })
      .webp({ quality: WEBP_QUALITY }) // metadata (EXIF, GPS, colour profile text) is dropped by default
      .toBuffer({ resolveWithObject: true });
    return { width: out.info.width, height: out.info.height, bytes: new Uint8Array(out.data) };
  }
}
