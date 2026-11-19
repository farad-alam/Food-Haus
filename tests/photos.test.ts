import { createHash } from "node:crypto";
import sharp, { type Sharp } from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cloudinaryConfigFromEnv, destroyPhoto, PhotoRejectedError, PhotoServiceError, signParams, uploadPhoto } from "@/lib/photos/cloudinary";
import { imageDimensions } from "@/lib/photos/dimensions";
import { isPublicId, photoSrcSet, photoUrl, publicIdFor } from "@/lib/photos/keys";
import { PHOTO_MESSAGES, uploadValidatedPhoto } from "@/lib/photos/pipeline";
import { sniffImage } from "@/lib/photos/sniff";
import { MAX_UPLOAD_BYTES } from "@/lib/photos/types";

// Test images are generated, never committed.
const jpeg = (w: number, h: number, extra: (s: Sharp) => Sharp = (s) => s) =>
  extra(sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 80, b: 20 } } })).jpeg().toBuffer().then((b) => new Uint8Array(b));
const CFG = { cloudName: "demo-cloud", apiKey: "123456789012", apiSecret: "abcdefghijklmnop" };

afterEach(() => vi.unstubAllGlobals());

describe("what the bytes are, and how big the picture is (no image library on Workers)", () => {
  it("reads JPEG, PNG and WebP dimensions from the bytes", async () => {
    expect(imageDimensions(await jpeg(321, 123), "jpeg")).toEqual({ width: 321, height: 123 });
    const png = new Uint8Array(await sharp({ create: { width: 55, height: 44, channels: 3, background: "#fff" } }).png().toBuffer());
    expect(imageDimensions(png, "png")).toEqual({ width: 55, height: 44 });
    const webpLossy = new Uint8Array(await sharp({ create: { width: 210, height: 160, channels: 3, background: "#fff" } }).webp({ lossless: false }).toBuffer());
    expect(imageDimensions(webpLossy, sniffImage(webpLossy)! as "webp")).toEqual({ width: 210, height: 160 });
    const webpLossless = new Uint8Array(await sharp({ create: { width: 33, height: 77, channels: 4, background: "#fff0" } }).webp({ lossless: true }).toBuffer());
    expect(imageDimensions(webpLossless, "webp")).toEqual({ width: 33, height: 77 });
  });
  it("a sideways phone JPEG (EXIF orientation 6) reports its size as displayed", async () => {
    const raw = await jpeg(900, 1300, (s) => s.withMetadata({ orientation: 6 }));
    expect(imageDimensions(raw, "jpeg")).toEqual({ width: 1300, height: 900 });
    const upright = await jpeg(900, 1300, (s) => s.withMetadata({ orientation: 1 }));
    expect(imageDimensions(upright, "jpeg")).toEqual({ width: 900, height: 1300 });
  });
  it("garbage, truncated files and wrong kinds give null, never a guess", async () => {
    expect(imageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 1]), "jpeg")).toBeNull();
    expect(imageDimensions((await jpeg(300, 200)).slice(0, 6), "jpeg")).toBeNull();
    expect(imageDimensions(new TextEncoder().encode("RIFFxxxxWEBPJUNKssssssssssssssssss"), "webp")).toBeNull();
    expect(imageDimensions(new Uint8Array(30).fill(7), "png")).toBeNull();
  });
});

describe("public ids and delivery URLs", () => {
  it("ids are content hashes in a fixed shape; the same bytes always get the same id", async () => {
    const id = await publicIdFor(new Uint8Array([1, 2, 3]));
    expect(isPublicId(id)).toBe(true);
    expect(id).toBe(await publicIdFor(new Uint8Array([1, 2, 3])));
    expect(id).not.toBe(await publicIdFor(new Uint8Array([1, 2, 4])));
    for (const bad of ["", "menu/0123456789abcdef", "food-haus/menu/XYZ", "food-haus/menu/0123456789abcdef/../x", "food-haus/menu/0123456789abcde", null, 7]) expect([bad, isPublicId(bad)]).toEqual([bad, false]);
  });
  it("delivery URLs are Cloudinary transformations: 4:3, width-capped at 1600, automatic format and quality", () => {
    const id = "food-haus/menu/0123456789abcdef";
    expect(photoUrl("demo-cloud", id, 800)).toBe("https://res.cloudinary.com/demo-cloud/image/upload/c_lfill,ar_4:3,g_auto,w_800,f_auto,q_auto/food-haus/menu/0123456789abcdef");
    expect(photoUrl("demo-cloud", id, 99999)).toContain("w_1600");
    expect(photoSrcSet("demo-cloud", id)).toBe([400, 800, 1200, 1600].map((w) => `${photoUrl("demo-cloud", id, w)} ${w}w`).join(", "));
  });
  it("a bad cloud name or stored id gives an empty URL (no picture), never a broken or crafted address", () => {
    const id = "food-haus/menu/0123456789abcdef";
    for (const badCloud of ["", "bad cloud", "x/../y", "a.b", null, undefined]) expect(photoUrl(badCloud as string, id, 400)).toBe("");
    for (const badId of ["../../etc", "food-haus/menu/0123456789abcdef?x=1", "menu/0123456789abcdef"]) expect(photoUrl("demo-cloud", badId, 400)).toBe("");
    expect(photoSrcSet("demo-cloud", "junk")).toBe("");
  });
});

describe("signed Cloudinary requests (no SDK: fetch + Web Crypto)", () => {
  it("signs exactly as documented: sorted params, name=value&…, secret appended, SHA-1 hex", async () => {
    const params = { timestamp: 1700000000, public_id: "food-haus/menu/abc", overwrite: "false" };
    const expected = createHash("sha1").update("overwrite=false&public_id=food-haus/menu/abc&timestamp=1700000000" + CFG.apiSecret).digest("hex");
    expect(await signParams(params, CFG.apiSecret)).toBe(expected);
  });
  it("accepts only sane credentials, so a typo cannot half-work", () => {
    expect(cloudinaryConfigFromEnv({ CLOUDINARY_CLOUD_NAME: "demo-cloud", CLOUDINARY_API_KEY: "123456789012", CLOUDINARY_API_SECRET: "abcdefghijklmnop" })).toEqual(CFG);
    expect(cloudinaryConfigFromEnv({ CLOUDINARY_CLOUD_NAME: " demo-cloud ", CLOUDINARY_API_KEY: " 123456789012 ", CLOUDINARY_API_SECRET: " abcdefghijklmnop " })).toEqual(CFG);
    expect(cloudinaryConfigFromEnv({})).toBeNull();
    for (const patch of [{ CLOUDINARY_CLOUD_NAME: undefined }, { CLOUDINARY_API_KEY: undefined }, { CLOUDINARY_API_SECRET: undefined }, { CLOUDINARY_CLOUD_NAME: "bad cloud" }, { CLOUDINARY_API_KEY: "letters" }, { CLOUDINARY_API_KEY: "123" }, { CLOUDINARY_API_SECRET: "short" }, { CLOUDINARY_API_SECRET: "has space in it" }]) {
      expect([patch, cloudinaryConfigFromEnv({ CLOUDINARY_CLOUD_NAME: CFG.cloudName, CLOUDINARY_API_KEY: CFG.apiKey, CLOUDINARY_API_SECRET: CFG.apiSecret, ...patch })]).toEqual([patch, null]);
    }
  });
  it("upload sends a correctly signed form with the strip-metadata transformation, and never the secret", async () => {
    const calls: { url: string; form: FormData }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, form: init.body as FormData });
      return new Response(JSON.stringify({ public_id: "food-haus/menu/abcdef0123456789", width: 1600, height: 1200 }), { status: 200 });
    }));
    const bytes = await jpeg(1300, 1000);
    const r = await uploadPhoto(CFG, bytes, "food-haus/menu/abcdef0123456789", "image/jpeg");
    expect(r).toEqual({ publicId: "food-haus/menu/abcdef0123456789", width: 1600, height: 1200 });
    expect(calls[0].url).toBe("https://api.cloudinary.com/v1_1/demo-cloud/image/upload");
    const f = calls[0].form;
    const signed: Record<string, string | number> = {};
    for (const k of ["allowed_formats", "overwrite", "public_id", "timestamp", "transformation", "unique_filename", "use_filename"]) signed[k] = String(f.get(k));
    expect(await signParams(signed, CFG.apiSecret)).toBe(f.get("signature"));
    expect(f.get("transformation")).toBe("a_exif/c_limit,w_1600,h_1600/fl_force_strip");
    expect(f.get("allowed_formats")).toBe("jpg,jpeg,png,webp");
    expect(f.get("overwrite")).toBe("false");
    expect(f.get("api_key")).toBe(CFG.apiKey);
    for (const [, v] of f.entries()) if (typeof v === "string") expect(v).not.toContain(CFG.apiSecret);
    expect((f.get("file") as File).type).toBe("image/jpeg");
  });
  it("a 400 means Cloudinary refused THIS picture; other failures are service errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid image file" } }), { status: 400 })));
    await expect(uploadPhoto(CFG, new Uint8Array([1]), "food-haus/menu/abcdef0123456789", "image/jpeg")).rejects.toBeInstanceOf(PhotoRejectedError);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid Signature" } }), { status: 401 })));
    await expect(uploadPhoto(CFG, new Uint8Array([1]), "food-haus/menu/abcdef0123456789", "image/jpeg")).rejects.toBeInstanceOf(PhotoServiceError);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(uploadPhoto(CFG, new Uint8Array([1]), "food-haus/menu/abcdef0123456789", "image/jpeg")).rejects.toBeInstanceOf(PhotoServiceError);
  });
  it("destroy signs public_id + invalidate + timestamp; 'not found' from Cloudinary is success", async () => {
    const calls: FormData[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      calls.push(init.body as FormData);
      return new Response(JSON.stringify({ result: "not found" }), { status: 200 });
    }));
    await destroyPhoto(CFG, "food-haus/menu/abcdef0123456789");
    const f = calls[0];
    expect(await signParams({ invalidate: String(f.get("invalidate")), public_id: String(f.get("public_id")), timestamp: Number(f.get("timestamp")) }, CFG.apiSecret)).toBe(f.get("signature"));
    expect(f.get("invalidate")).toBe("true");
  });
});

describe("the upload pipeline checks everything BEFORE anything is sent", () => {
  it("refuses each bad upload with a plain message and makes no network call at all", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const cases: [string, Uint8Array, keyof typeof PHOTO_MESSAGES][] = [
      ["too small", await jpeg(800, 600), "TOO_SMALL"],
      ["svg", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000"/>'), "NOT_AN_IMAGE"],
      ["a pdf", new TextEncoder().encode("%PDF-1.4 ..."), "NOT_AN_IMAGE"],
      ["a truncated jpeg", (await jpeg(2000, 1500)).slice(0, 40), "UNREADABLE"],
      ["over the size limit", new Uint8Array(MAX_UPLOAD_BYTES + 1).fill(0xff), "TOO_BIG"],
    ];
    for (const [name, bytes, error] of cases) {
      expect([name, await uploadValidatedPhoto(CFG, bytes)]).toEqual([name, { ok: false, error }]);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("a sideways 900x1300 phone photo (displays as 1300x900) passes the minimum-size check and is uploaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const id = (init.body as FormData).get("public_id") as string;
      return new Response(JSON.stringify({ public_id: id, width: 1300, height: 900 }), { status: 200 });
    }));
    const r = await uploadValidatedPhoto(CFG, await jpeg(900, 1300, (s) => s.withMetadata({ orientation: 6 })));
    expect(r.ok && isPublicId(r.publicId)).toBe(true);
  });
  it("Cloudinary refusing the picture reads as 'could not read that image'; an outage is an error for the route to map", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid image file" } }), { status: 400 })));
    expect(await uploadValidatedPhoto(CFG, await jpeg(2000, 1500))).toEqual({ ok: false, error: "UNREADABLE" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await expect(uploadValidatedPhoto(CFG, await jpeg(2000, 1500))).rejects.toBeInstanceOf(PhotoServiceError);
  });
});
