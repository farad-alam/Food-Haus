import { WEBP_QUALITY, type ImageProcessor } from "./types";

// Production processor: the Cloudflare Images BINDING (wrangler.jsonc: "images": { "binding": "IMAGES" }).
//
// UNVERIFIED against the real service (not available when this was written). It follows the
// documented Workers Images API shape, and is checked only against a fake of it:
//   env.IMAGES.info(stream)                      -> { width, height, format, fileSize }
//   env.IMAGES.input(stream).transform({...}).output({ format, quality }) -> result with .response()
// Things to confirm after deploy: EXIF orientation is applied, metadata (GPS) is stripped,
// fit "cover" crops from the centre, WebP output at quality 80, the input size limit, and billing.

type ImagesResult = { response(): Response };
type ImagesBinding = {
  info(stream: ReadableStream<Uint8Array>): Promise<{ width?: number; height?: number }>;
  input(stream: ReadableStream<Uint8Array>): {
    transform(t: { width: number; height: number; fit: "cover" }): { output(o: { format: "image/webp"; quality: number }): Promise<ImagesResult> };
  };
};
export type { ImagesBinding };

const stream = (b: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(b);
      c.close();
    },
  });

export class CloudflareImagesProcessor implements ImageProcessor {
  readonly kind = "cloudflare-images" as const;
  constructor(private readonly images: ImagesBinding) {}
  async inspect(input: Uint8Array) {
    const i = await this.images.info(stream(input));
    if (!i.width || !i.height) throw new Error("Could not read the image size.");
    return { width: i.width, height: i.height };
  }
  async render(input: Uint8Array, size: { width: number; height: number }) {
    const r = await this.images.input(stream(input)).transform({ width: size.width, height: size.height, fit: "cover" }).output({ format: "image/webp", quality: WEBP_QUALITY });
    const res = r.response();
    if (!res.ok) throw new Error(`Image processing failed (${res.status}).`);
    return { width: size.width, height: size.height, bytes: new Uint8Array(await res.arrayBuffer()) };
  }
}
