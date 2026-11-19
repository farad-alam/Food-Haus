import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { adminUser, auditLog, category, settings } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { createAdminUser } from "@/lib/auth/pg-store";
import { generateToken, hashToken } from "@/lib/auth/service";
import { adminStore } from "@/lib/admin/guard";
import { loadHomeImages } from "@/lib/home-images";
import { signParams } from "@/lib/photos/cloudinary";
import { isPublicId } from "@/lib/photos/keys";
import { GET as getImages, POST as upload, DELETE as removeImage } from "@/app/api/admin/settings/home-images/route";

// Real route handlers and database; Cloudinary is the same faithful fake as tests/db/photos.test.ts.
const enabled = !!process.env.DATABASE_URL;
const ORIGIN = "http://localhost:3000";
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(5)));
const tag = crypto.randomUUID().slice(0, 6);
const CLOUD = { name: "fake-cloud", key: "123456789012", secret: "test-secret-abcdef" };

const assets = new Map<string, true>();
function fakeCloudinary(realFetch: typeof fetch) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (!url.startsWith("https://api.cloudinary.com/")) return realFetch(input as never, init);
    const form = init?.body as FormData;
    if (url.endsWith("/image/upload")) {
      const params: Record<string, string> = {};
      for (const n of ["allowed_formats", "overwrite", "public_id", "timestamp", "transformation", "unique_filename", "use_filename"]) params[n] = String(form.get(n));
      if ((await signParams(params, CLOUD.secret)) !== form.get("signature")) return new Response(JSON.stringify({ error: { message: "Invalid Signature" } }), { status: 401 });
      assets.set(String(form.get("public_id")), true);
      return new Response(JSON.stringify({ public_id: form.get("public_id"), width: 1600, height: 1200 }), { status: 200 });
    }
    assets.delete(String(form.get("public_id")));
    return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
  };
}

describe.skipIf(!enabled)("home page images (real database, fake Cloudinary)", () => {
  const db = enabled ? getDb() : (null as never);
  const users: Record<string, { id: number; cookie: string }> = {};
  const saved: Record<string, string | undefined> = {};
  let original: unknown;
  let catSlug = "";

  const img = (w = 2000, h = 1500, tint = 30) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 40, g: 120, b: tint } } }).jpeg().toBuffer();
  const send = (who: string | null, fields: Record<string, string>, file: Uint8Array | Buffer | null, origin = ORIGIN) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    if (file) form.set("file", new File([new Uint8Array(file)], "photo.jpg", { type: "image/jpeg" }));
    return upload(new Request(`${ORIGIN}/api/admin/settings/home-images`, { method: "POST", headers: { origin, ...(who ? { cookie: users[who].cookie } : {}) }, body: form }));
  };
  const del = (who: string, body: unknown) =>
    removeImage(new Request(`${ORIGIN}/api/admin/settings/home-images`, { method: "DELETE", headers: { "content-type": "application/json", origin: ORIGIN, cookie: users[who].cookie }, body: JSON.stringify(body) }));

  beforeAll(async () => {
    for (const [k, v] of Object.entries({ SECRET_BOX_KEY: KEY, CLOUDINARY_CLOUD_NAME: CLOUD.name, CLOUDINARY_API_KEY: CLOUD.key, CLOUDINARY_API_SECRET: CLOUD.secret })) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    vi.stubGlobal("fetch", fakeCloudinary(fetch));
    original = (await db.select({ h: settings.homeImages }).from(settings).where(eq(settings.id, 1)))[0]?.h ?? {};
    for (const role of ["manager", "kitchen"] as const) {
      const id = await createAdminUser(db, KEY, { email: `${role}-homeimg-${tag}@example.test`, passwordHash: "x", role });
      const token = generateToken();
      const now = new Date();
      await adminStore().createSession({ tokenHash: await hashToken(token), userId: id, createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + 3_600_000) });
      users[role] = { id, cookie: `fh_admin=${token}` };
    }
    const [cat] = await db.select({ slug: category.slug }).from(category).where(eq(category.visible, true)).limit(1);
    catSlug = cat?.slug ?? "";
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await db.update(settings).set({ homeImages: (original ?? {}) as Record<string, unknown> }).where(eq(settings.id, 1));
    const ids = Object.values(users).map((u) => u.id);
    await db.delete(auditLog).where(inArray(auditLog.userId, ids));
    await db.delete(adminUser).where(inArray(adminUser.id, ids));
    await db.delete(adminUser).where(like(adminUser.email, `%homeimg-${tag}%`));
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("settings editors only: no session 401, kitchen 403, cross-site 403; GET lists the categories and the cloud name", async () => {
    expect((await send(null, { slot: "hero" }, await img())).status).toBe(401);
    expect((await send("kitchen", { slot: "hero" }, await img())).status).toBe(403);
    expect((await send("manager", { slot: "hero" }, await img(), "https://evil.example")).status).toBe(403);
    const res = await getImages(new Request(`${ORIGIN}/api/admin/settings/home-images`, { headers: { cookie: users.manager.cookie } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.photoCloud).toBe(CLOUD.name);
    expect(Array.isArray(body.categories) && body.categories.length).toBeTruthy();
    expect(body.categories.some((c: { slug: string }) => c.slug === catSlug)).toBe(true);
  });

  it("uploads the hero with a description, replaces it (destroying the old asset), edits the description alone, and removes it", async () => {
    const first = await send("manager", { slot: "hero", alt: "  A stacked  burger " }, await img(2000, 1500, 30));
    expect(first.status).toBe(200);
    const id1 = (await first.json()).photo as string;
    expect(isPublicId(id1) && assets.has(id1)).toBe(true);
    expect((await loadHomeImages(db)).hero).toEqual({ key: id1, alt: "A stacked burger" });

    const second = await send("manager", { slot: "hero" }, await img(2000, 1500, 200));
    const id2 = (await second.json()).photo as string;
    expect(id2).not.toBe(id1);
    expect(assets.has(id1)).toBe(false); // old asset destroyed
    expect((await loadHomeImages(db)).hero!.alt).toBe("A stacked burger"); // no new description: the old one stays

    expect((await send("manager", { slot: "hero", alt: "Wings in sauce" }, null)).status).toBe(200); // description alone, no file
    expect((await loadHomeImages(db)).hero).toEqual({ key: id2, alt: "Wings in sauce" });

    expect((await del("manager", { slot: "hero" })).status).toBe(200);
    expect((await loadHomeImages(db)).hero).toBeNull();
    expect(assets.has(id2)).toBe(false);
    expect((await del("manager", { slot: "hero" })).status).toBe(404); // nothing left

    const banner = await send("manager", { slot: "banner" }, await img(2000, 1500, 120));
    expect(banner.status).toBe(200);
    const bid = (await banner.json()).photo as string;
    expect((await loadHomeImages(db)).banner).toBe(bid);
    expect((await del("manager", { slot: "banner" })).status).toBe(200);
    expect((await loadHomeImages(db)).banner).toBeNull();
    expect(assets.has(bid)).toBe(false);

    const trail = await db.select().from(auditLog).where(eq(auditLog.userId, users.manager.id));
    for (const action of ["settings.homeImage", "settings.homeImage.alt", "settings.homeImage.remove"]) {
      expect([action, trail.some((t) => t.action === action && t.entity === "home-image:hero")]).toEqual([action, true]);
    }
  });

  it("category images need a real category; bad slots and bad files are refused with nothing stored", async () => {
    if (!catSlug) return; // no categories in this database: nothing to test against
    const ok = await send("manager", { slot: "category", slug: catSlug }, await img(1600, 1200, 90));
    expect(ok.status).toBe(200);
    const id = (await ok.json()).photo as string;
    expect((await loadHomeImages(db)).categories[catSlug]).toBe(id);

    for (const [name, fields, file] of [
      ["unknown category", { slot: "category", slug: "no-such-category" }, await img()],
      ["malformed slug", { slot: "category", slug: "../etc" }, await img()],
      ["unknown slot", { slot: "poster" }, await img()],
      ["too small", { slot: "category", slug: catSlug }, await img(600, 400)],
      ["not an image", { slot: "category", slug: catSlug }, Buffer.from("not a picture")],
    ] as const) {
      const r = await send("manager", fields as Record<string, string>, file);
      expect([name, r.status]).toEqual([name, 400]);
    }
    expect((await loadHomeImages(db)).categories[catSlug]).toBe(id); // untouched by the failures
    expect((await del("manager", { slot: "category", slug: catSlug })).status).toBe(200);
    expect((await loadHomeImages(db)).categories[catSlug]).toBeUndefined();
    expect(assets.has(id)).toBe(false);
  });
});
