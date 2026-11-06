import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp, { type Sharp } from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { allVariantKeys, baseKeyFor, isBaseKey, isFileKey, photoSrcSet, photoUrl, variantKey } from "@/lib/photos/keys";
import { deletePhotoFiles, PHOTO_MESSAGES, storeUploadedPhoto } from "@/lib/photos/pipeline";
import { CloudflareImagesProcessor, type ImagesBinding } from "@/lib/photos/processor-cloudflare";
import { SharpImageProcessor } from "@/lib/photos/processor-sharp";
import { sniffImage } from "@/lib/photos/sniff";
import { FsPhotoStore } from "@/lib/photos/store-fs";
import { MemoryPhotoStore } from "@/lib/photos/store-memory";
import { R2PhotoStore, type R2BucketLike } from "@/lib/photos/store-r2";
import { MAX_UPLOAD_BYTES, VARIANTS, type PhotoStore } from "@/lib/photos/types";

// Test images are generated, never committed.
const jpeg = (w: number, h: number, extra: (s: Sharp) => Sharp = (s) => s) =>
  extra(sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 80, b: 20 } } })).jpeg().toBuffer().then((b) => new Uint8Array(b));
const processor = new SharpImageProcessor();
const dims = async (b: Uint8Array) => { const m = await sharp(b).metadata(); return { w: m.width, h: m.height, format: m.format, exif: m.exif, icc: m.icc }; };

describe("what the bytes are", () => {
  it("accepts JPEG, PNG and WebP by their first bytes", async () => {
    expect(sniffImage(await jpeg(10, 10))).toBe("jpeg");
    expect(sniffImage(new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toBuffer()))).toBe("png");
    expect(sniffImage(new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).webp().toBuffer()))).toBe("webp");
  });
  it("refuses SVG (can carry scripts), GIF, HTML, text and empty files, whatever they are called", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    for (const bad of [enc('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), enc("GIF89a....."), enc("<html></html>"), enc("hello"), new Uint8Array(), new Uint8Array([0xff, 0xd8])]) expect(sniffImage(bad)).toBeNull();
  });
});

describe("keys", () => {
  it("are content hashes in a fixed shape, and only that shape is valid", async () => {
    const k = await baseKeyFor(new Uint8Array([1, 2, 3]));
    expect(isBaseKey(k)).toBe(true);
    expect(k).toBe(await baseKeyFor(new Uint8Array([1, 2, 3])));
    expect(k).not.toBe(await baseKeyFor(new Uint8Array([1, 2, 4])));
    expect(allVariantKeys(k).every(isFileKey)).toBe(true);
    expect(photoUrl(k, 800)).toBe(`/media/${k}-800.webp`);
    expect(photoSrcSet(k)).toBe(`/media/${k}-400.webp 400w, /media/${k}-800.webp 800w, /media/${k}-1200.webp 1200w`);
    for (const bad of ["", "menu/../etc/passwd", "../menu/0123456789abcdef-400.webp", "menu/0123456789abcdef-401.webp", "menu/0123456789abcdef-400.png", "menu/0123456789ABCDEF-400.webp", "/menu/0123456789abcdef-400.webp", "menu/0123456789abcdef-400.webp/x", "menu/0123456789abcdef", null, 5]) expect([bad, isFileKey(bad)]).toEqual([bad, false]);
    expect(isBaseKey("menu/0123456789abcdef")).toBe(true);
    expect(isBaseKey("menu/0123456789abcdef-400.webp")).toBe(false);
  });
});

describe("the upload pipeline", () => {
  it("makes 4:3 WebP in every size, never wider than 1,600 px, and files are named by their content", async () => {
    const store = new MemoryPhotoStore();
    const r = await storeUploadedPhoto({ store, processor }, await jpeg(3000, 2000));
    if (!r.ok) throw new Error(r.error);
    expect(isBaseKey(r.base)).toBe(true);
    expect([...store.files.keys()].sort()).toEqual(allVariantKeys(r.base).sort());
    for (const v of VARIANTS) {
      const f = store.files.get(variantKey(r.base, v.width))!;
      expect(f.contentType).toBe("image/webp");
      const d = await dims(f.body);
      expect([d.format, d.w, d.h]).toEqual(["webp", v.width, v.height]);
      expect(v.width).toBeLessThanOrEqual(1600);
    }
    const again = await storeUploadedPhoto({ store: new MemoryPhotoStore(), processor }, await jpeg(3000, 2000));
    expect(again.ok && again.base).toBe(r.base); // same photo, same name
  });
  it("applies the camera's rotation and strips every trace of EXIF/GPS and colour profiles", async () => {
    // A portrait photo stored sideways (orientation 6) with a copyright, as a phone writes it.
    const raw = await jpeg(2000, 1500, (s) => s.withExif({ IFD0: { Copyright: "SECRET-OWNER-NAME" } }).withMetadata({ orientation: 6 }));
    expect((await dims(raw)).exif).toBeTruthy();
    const store = new MemoryPhotoStore();
    const r = await storeUploadedPhoto({ store, processor }, raw);
    if (!r.ok) throw new Error(r.error);
    for (const v of VARIANTS) {
      const bytes = store.files.get(variantKey(r.base, v.width))!.body;
      expect((await dims(bytes)).exif).toBeUndefined();
      expect(Buffer.from(bytes).includes("SECRET-OWNER-NAME")).toBe(false);
    }
  });
  it("reads the display size of a rotated photo, so a sideways 1500x2000 is not judged as too small", async () => {
    const raw = await jpeg(900, 1300, (s) => s.withMetadata({ orientation: 6 })); // displays as 1300 x 900
    expect(await processor.inspect(raw)).toEqual({ width: 1300, height: 900 });
    expect((await storeUploadedPhoto({ store: new MemoryPhotoStore(), processor }, raw)).ok).toBe(true);
  });
  it("refuses each bad upload with a plain message and stores NOTHING", async () => {
    const cases: [string, Uint8Array, keyof typeof PHOTO_MESSAGES][] = [
      ["too small", await jpeg(800, 600), "TOO_SMALL"],
      ["svg", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000"/>'), "NOT_AN_IMAGE"],
      ["a pdf", new TextEncoder().encode("%PDF-1.4 ...."), "NOT_AN_IMAGE"],
      ["a truncated jpeg", (await jpeg(2000, 1500)).slice(0, 1200), "UNREADABLE"],
      ["a jpeg header then junk", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(500).fill(7)]), "UNREADABLE"],
      ["too many pixels", new Uint8Array(await sharp({ create: { width: 8000, height: 7000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer()), "UNREADABLE"],
      ["over the size limit", new Uint8Array(MAX_UPLOAD_BYTES + 1).fill(0xff), "TOO_BIG"],
    ];
    for (const [name, bytes, error] of cases) {
      const store = new MemoryPhotoStore();
      const r = await storeUploadedPhoto({ store, processor }, bytes);
      expect([name, r]).toEqual([name, { ok: false, error }]);
      expect([name, store.files.size]).toEqual([name, 0]);
      expect(PHOTO_MESSAGES[error].length).toBeGreaterThan(10);
    }
  });
  it("deleting removes every size, a missing photo is not an error, and a failing store never throws", async () => {
    const store = new MemoryPhotoStore();
    const r = await storeUploadedPhoto({ store, processor }, await jpeg(2000, 1500));
    if (!r.ok) throw new Error();
    await deletePhotoFiles(store, r.base);
    expect(store.files.size).toBe(0);
    await deletePhotoFiles(store, r.base);
    await deletePhotoFiles(store, null);
    const broken: PhotoStore = { kind: "memory", put: async () => {}, get: async () => null, delete: async () => { throw new Error("boom"); } };
    await expect(deletePhotoFiles(broken, r.base)).resolves.toBeUndefined();
  });
});

describe("storage implementations behave the same", () => {
  const dir = mkdtemp(join(tmpdir(), "fh-photos-"));
  afterAll(async () => rm(await dir, { recursive: true, force: true }));

  // A fake that follows the documented R2 Workers API (put/get/delete(key|keys), httpMetadata, arrayBuffer()).
  class FakeR2 implements R2BucketLike {
    objects = new Map<string, { bytes: ArrayBuffer; httpMetadata: { contentType?: string; cacheControl?: string } }>();
    async put(key: string, value: ArrayBuffer | Uint8Array, o?: { httpMetadata?: { contentType?: string; cacheControl?: string } }) {
      const u = value instanceof Uint8Array ? value : new Uint8Array(value);
      this.objects.set(key, { bytes: u.slice().buffer as ArrayBuffer, httpMetadata: o?.httpMetadata ?? {} });
    }
    async get(key: string) {
      const o = this.objects.get(key);
      return o ? { arrayBuffer: async () => o.bytes.slice(0), httpMetadata: o.httpMetadata } : null;
    }
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k);
    }
  }
  const fake = new FakeR2();
  const stores = async (): Promise<[string, PhotoStore][]> => [["memory", new MemoryPhotoStore()], ["fs", new FsPhotoStore(await dir)], ["r2 (fake)", new R2PhotoStore(fake)]];
  const key = "menu/0123456789abcdef-400.webp";

  it("put, get, overwrite, delete, and a missing key is null / not an error", async () => {
    for (const [name, s] of await stores()) {
      expect([name, await s.get(key)]).toEqual([name, null]);
      await s.put(key, new Uint8Array([1, 2, 3]), { contentType: "image/webp" });
      const got = await s.get(key);
      expect([name, [...got!.body], got!.contentType]).toEqual([name, [1, 2, 3], "image/webp"]);
      await s.put(key, new Uint8Array([9]), { contentType: "image/webp" });
      expect([name, [...(await s.get(key))!.body]]).toEqual([name, [9]]);
      await s.delete([key, "menu/ffffffffffffffff-800.webp"]);
      expect([name, await s.get(key)]).toEqual([name, null]);
      await s.delete([]);
    }
  });
  it("every store refuses a key that is not a photo key (no path tricks)", async () => {
    for (const [, s] of await stores()) {
      for (const bad of ["../escape.webp", "menu/../../etc/passwd", "/abs.webp", "menu/0123456789abcdef-400.png", ""]) {
        await expect(s.get(bad)).rejects.toThrow(/unexpected photo key|escapes/);
        await expect(s.put(bad, new Uint8Array([1]), { contentType: "image/webp" })).rejects.toThrow();
        await expect(s.delete([bad])).rejects.toThrow();
      }
    }
  });
  it("R2 files are stored with a type and a long cache lifetime, and the filesystem leaves no temp files", async () => {
    const r2 = new R2PhotoStore(fake);
    await r2.put(key, new Uint8Array([1]), { contentType: "image/webp" });
    expect(fake.objects.get(key)!.httpMetadata).toEqual({ contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" });
    const fs = new FsPhotoStore(await dir);
    await fs.put(key, new Uint8Array([1]), { contentType: "image/webp" });
    expect((await readdir(join(await dir, "menu"))).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    await fs.delete([key]);
  });
});

describe("the Cloudflare Images processor (against a fake of the documented API)", () => {
  // Stands in for env.IMAGES: runs the same transform with sharp so the pipeline can be exercised end to end.
  const fakeImages: ImagesBinding = {
    info: async (stream) => {
      const m = await sharp(Buffer.from(await new Response(stream).arrayBuffer())).metadata();
      return { width: m.width, height: m.height };
    },
    input: (stream) => ({
      transform: (t) => ({
        output: async (o) => {
          expect(o.format).toBe("image/webp");
          const out = await sharp(Buffer.from(await new Response(stream).arrayBuffer())).rotate().resize({ width: t.width, height: t.height, fit: t.fit }).webp({ quality: o.quality }).toBuffer();
          return { response: () => new Response(new Uint8Array(out), { headers: { "content-type": "image/webp" } }) };
        },
      }),
    }),
  };
  it("produces the same variants through the same pipeline", async () => {
    const store = new MemoryPhotoStore();
    const r = await storeUploadedPhoto({ store, processor: new CloudflareImagesProcessor(fakeImages) }, await jpeg(2400, 1800));
    if (!r.ok) throw new Error(r.error);
    for (const v of VARIANTS) expect(await dims(store.files.get(variantKey(r.base, v.width))!.body)).toMatchObject({ format: "webp", w: v.width, h: v.height });
  });
  it("a failing service becomes 'could not read', not a crash, and stores nothing", async () => {
    const failing: ImagesBinding = { ...fakeImages, input: () => ({ transform: () => ({ output: async () => ({ response: () => new Response("nope", { status: 415 }) }) }) }) };
    const store = new MemoryPhotoStore();
    expect(await storeUploadedPhoto({ store, processor: new CloudflareImagesProcessor(failing) }, await jpeg(2400, 1800))).toEqual({ ok: false, error: "UNREADABLE" });
    expect(store.files.size).toBe(0);
    const noSize: ImagesBinding = { ...fakeImages, info: async () => ({}) };
    expect(await storeUploadedPhoto({ store, processor: new CloudflareImagesProcessor(noSize) }, await jpeg(2400, 1800))).toEqual({ ok: false, error: "UNREADABLE" });
  });
});
