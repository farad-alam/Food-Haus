import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { adminUser, auditLog, category, item } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { createAdminUser } from "@/lib/auth/pg-store";
import { generateToken, hashToken } from "@/lib/auth/service";
import { adminStore } from "@/lib/admin/guard";
import { loadMenuAdmin } from "@/lib/admin/menu";
import { loadMenuRows } from "@/lib/db/menu-repo";
import { rowsToMenu } from "@/lib/menu-model";
import { signParams } from "@/lib/photos/cloudinary";
import { isPublicId } from "@/lib/photos/keys";
import { POST as postCategory } from "@/app/api/admin/menu/categories/route";
import { POST as postItem } from "@/app/api/admin/menu/items/route";
import { DELETE as deleteItem } from "@/app/api/admin/menu/items/[id]/route";
import { POST as upload, PUT as putAlt, DELETE as removePhoto } from "@/app/api/admin/menu/items/[id]/photo/route";

// Real route handlers and real database; Cloudinary is a FAKE that follows its documented upload and destroy
// endpoints (and verifies our signatures). Only requests to api.cloudinary.com are intercepted — everything
// else (Neon) goes to the real fetch. The real service has still never been called: see docs/preview-deploy.md.
const enabled = !!process.env.DATABASE_URL;
const ORIGIN = "http://localhost:3000";
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(6)));
const tag = crypto.randomUUID().slice(0, 6);
const CLOUD = { name: "fake-cloud", key: "123456789012", secret: "test-secret-abcdef" };

type Asset = { bytes: number; format: string };
const assets = new Map<string, Asset>();
let rejectNext: { status: number; message: string } | null = null;
let cloudinaryCalls = 0;

function fakeCloudinary(realFetch: typeof fetch) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (!url.startsWith("https://api.cloudinary.com/")) return realFetch(input as never, init);
    cloudinaryCalls++;
    if (rejectNext) {
      const r = rejectNext;
      rejectNext = null;
      return new Response(JSON.stringify({ error: { message: r.message } }), { status: r.status });
    }
    const form = init?.body as FormData;
    const expectSigned = async (names: string[]) => {
      const params: Record<string, string> = {};
      for (const n of names) params[n] = String(form.get(n));
      if ((await signParams(params, CLOUD.secret)) !== form.get("signature")) return false;
      return form.get("api_key") === CLOUD.key;
    };
    if (url.endsWith(`/v1_1/${CLOUD.name}/image/upload`)) {
      if (!(await expectSigned(["allowed_formats", "overwrite", "public_id", "timestamp", "transformation", "unique_filename", "use_filename"]))) {
        return new Response(JSON.stringify({ error: { message: "Invalid Signature" } }), { status: 401 });
      }
      const id = String(form.get("public_id"));
      const file = form.get("file") as File;
      assets.set(id, { bytes: file.size, format: file.type.replace("image/", "") });
      return new Response(JSON.stringify({ public_id: id, width: 1600, height: 1200, format: assets.get(id)!.format }), { status: 200 });
    }
    if (url.endsWith(`/v1_1/${CLOUD.name}/image/destroy`)) {
      if (!(await expectSigned(["invalidate", "public_id", "timestamp"]))) return new Response(JSON.stringify({ error: { message: "Invalid Signature" } }), { status: 401 });
      const id = String(form.get("public_id"));
      const found = assets.delete(id);
      return new Response(JSON.stringify({ result: found ? "ok" : "not found" }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { message: `unexpected call ${url}` } }), { status: 500 });
  };
}

describe.skipIf(!enabled)("menu photos through Cloudinary (real database, fake Cloudinary)", () => {
  const db = enabled ? getDb() : (null as never);
  const users: Record<string, { id: number; cookie: string }> = {};
  const saved: Record<string, string | undefined> = {};
  let catId = 0;

  const img = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 40, g: 120, b: 200 } } }).jpeg().toBuffer();
  const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
  const json = (method: string, path: string, who: string, body: unknown) =>
    new Request(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: users[who].cookie }, body: JSON.stringify(body) });
  const send = (who: string | null, file: Uint8Array | Buffer | null, opts: { alt?: string; origin?: string | null; type?: string } = {}) => {
    const form = new FormData();
    if (file) form.append("file", new File([new Uint8Array(file)], "whatever.jpg", { type: opts.type ?? "image/jpeg" }));
    if (opts.alt !== undefined) form.append("alt", opts.alt);
    return new Request(`${ORIGIN}/api/admin/menu/items/1/photo`, { method: "POST", headers: { ...(opts.origin === null ? {} : { origin: opts.origin ?? ORIGIN }), ...(who ? { cookie: users[who].cookie } : {}) }, body: form });
  };
  const newItem = async (name: string) => {
    const r = await postItem(json("POST", "/api/admin/menu/items", "manager", { name: `${name} ${tag}`, description: "", price: 700, categoryId: catId, allergens: null, dietaryTags: [], soldOut: false, visible: true }));
    return (await r.json()).id as number;
  };
  const row = async (id: number) => (await db.select().from(item).where(eq(item.id, id)))[0];
  const publicItem = async (id: number) => {
    const slug = (await row(id)).slug;
    return rowsToMenu(await loadMenuRows(db)).categories.flatMap((c) => c.items).find((i) => i.slug === slug)!;
  };

  beforeAll(async () => {
    for (const [k, v] of Object.entries({ SECRET_BOX_KEY: KEY, CLOUDINARY_CLOUD_NAME: CLOUD.name, CLOUDINARY_API_KEY: CLOUD.key, CLOUDINARY_API_SECRET: CLOUD.secret })) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    vi.stubGlobal("fetch", fakeCloudinary(fetch));
    for (const role of ["manager", "kitchen"] as const) {
      const id = await createAdminUser(db, KEY, { email: `${role}-photo-${tag}@example.test`, passwordHash: "x", role });
      const token = generateToken();
      const now = new Date();
      await adminStore().createSession({ tokenHash: await hashToken(token), userId: id, createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + 3_600_000) });
      users[role] = { id, cookie: `fh_admin=${token}` };
    }
    const r = await postCategory(json("POST", "/api/admin/menu/categories", "manager", { name: `Photos ${tag}` }));
    catId = (await r.json()).id;
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    const cats = await db.select({ id: category.id }).from(category).where(like(category.name, `%${tag}%`));
    const ids = cats.map((c) => c.id);
    if (ids.length) {
      await db.delete(item).where(inArray(item.categoryId, ids));
      await db.delete(category).where(inArray(category.id, ids));
    }
    const u = Object.values(users).map((x) => x.id);
    await db.delete(auditLog).where(inArray(auditLog.userId, u));
    await db.delete(adminUser).where(inArray(adminUser.id, u));
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("is for menu editors only: no session 401, kitchen 403, cross-site 403, and nothing is sent to Cloudinary", async () => {
    const id = await newItem("Guarded");
    const good = await img(1600, 1200);
    const before = cloudinaryCalls;
    expect((await upload(send(null, good), ctx(id))).status).toBe(401);
    expect((await upload(send("kitchen", good), ctx(id))).status).toBe(403);
    expect((await upload(send("manager", good, { origin: "https://evil.example" }), ctx(id))).status).toBe(403);
    expect((await row(id)).photo).toBeNull();
    expect(cloudinaryCalls).toBe(before);
  });

  it("without the Cloudinary settings the answer is the plain 'not switched on' message, and nothing changes", async () => {
    const id = await newItem("Unset");
    const savedName = process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_CLOUD_NAME;
    try {
      const res = await upload(send("manager", await img(1600, 1200)), ctx(id));
      expect(res.status).toBe(501);
      expect((await res.json()).message).toMatch(/not switched on/);
      expect((await removePhoto(json("DELETE", "/x", "manager", {}), ctx(id))).status).toBe(501);
    } finally {
      process.env.CLOUDINARY_CLOUD_NAME = savedName;
    }
    expect((await row(id)).photo).toBeNull();
  });

  it("uploads with a signed request, stores the public id, and the public menu shows the photo with the item name as alt", async () => {
    const id = await newItem("Burger");
    const res = await upload(send("manager", await img(3000, 2000)), ctx(id));
    expect(res.status).toBe(200);
    const { photo } = await res.json();
    expect(isPublicId(photo)).toBe(true);
    expect(assets.has(photo)).toBe(true);
    expect((await row(id)).photo).toBe(photo);
    const pub = await publicItem(id);
    expect(pub.photo).toEqual({ key: photo, alt: `Burger ${tag}` }); // R11.15: falls back to the name
    expect((await loadMenuAdmin(db)).photoCloud).toBe(CLOUD.name); // the editor is told the cloud name for URLs
    const trail = await db.select().from(auditLog).where(eq(auditLog.entity, `item:${id}`));
    expect(trail.some((t) => t.action === "menu.item.photo")).toBe(true);
  });

  it("rejects a bad upload with a plain message, keeps the old photo, and sends nothing", async () => {
    const id = await newItem("Keeps");
    const { photo } = await (await upload(send("manager", await img(2000, 1500)), ctx(id))).json();
    const calls = cloudinaryCalls;
    const cases: [string, Request, number, RegExp][] = [
      ["too small", send("manager", await img(600, 400)), 400, /too small/i],
      ["not an image", send("manager", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), { type: "image/svg+xml" }), 400, /JPEG, PNG or WebP/],
      ["a text file called .jpg", send("manager", Buffer.from("not a picture at all")), 400, /JPEG, PNG or WebP/],
      ["no file", send("manager", null), 400, /choose a photo/i],
      ["wrong content type", new Request(`${ORIGIN}/api/admin/menu/items/1/photo`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie: users.manager.cookie }, body: "{}" }), 415, /choose a photo/i],
      ["huge", send("manager", Buffer.alloc(9 * 1024 * 1024, 0xff)), 0, /too big/i], // 413 when the browser sends Content-Length, 400 from the pipeline otherwise
    ];
    for (const [name, req, status, msg] of cases) {
      const r = await upload(req, ctx(id));
      const b = await r.json();
      expect([name, status === 0 ? [400, 413].includes(r.status) : r.status === status, msg.test(b.message)]).toEqual([name, true, true]);
    }
    expect(cloudinaryCalls).toBe(calls); // no network call for any of them
    expect((await row(id)).photo).toBe(photo);
    expect((await upload(send("manager", await img(1600, 1200)), ctx(2_000_000_000))).status).toBe(404);
  });

  it("a Cloudinary outage is a 502 with a calm message, and the item keeps its old photo", async () => {
    const id = await newItem("Outage");
    const { photo } = await (await upload(send("manager", await img(2000, 1500)), ctx(id))).json();
    rejectNext = { status: 503, message: "over capacity" };
    const res = await upload(send("manager", await img(1600, 1200)), ctx(id));
    expect(res.status).toBe(502);
    expect((await res.json()).message).toMatch(/try again/i);
    expect((await row(id)).photo).toBe(photo);
    rejectNext = { status: 400, message: "Invalid image file" }; // Cloudinary refusing the picture reads as unreadable
    const bad = await upload(send("manager", await img(1600, 1200)), ctx(id));
    expect(bad.status).toBe(400);
    expect((await bad.json()).message).toMatch(/could not read/i);
  });

  it("replacing removes the old Cloudinary asset; removing deletes it and the alt; deleting the item cleans up too", async () => {
    const id = await newItem("Replace");
    const first = (await (await upload(send("manager", await img(2000, 1500), { alt: "A burger on a tray" }), ctx(id))).json()).photo as string;
    expect((await row(id)).photoAlt).toBe("A burger on a tray");
    const second = (await (await upload(send("manager", await sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#f0f" } }).jpeg().toBuffer()), ctx(id))).json()).photo as string;
    expect(second).not.toBe(first);
    expect(assets.has(first)).toBe(false); // old asset destroyed
    expect(assets.has(second)).toBe(true);
    expect((await row(id)).photoAlt).toBe("A burger on a tray"); // a new photo without new text keeps the old text

    expect((await putAlt(json("PUT", "/x", "manager", { alt: "  Cheese   stack  " }), ctx(id))).status).toBe(200);
    expect((await row(id)).photoAlt).toBe("Cheese stack");
    expect((await putAlt(json("PUT", "/x", "manager", { alt: null }), ctx(id))).status).toBe(200);
    expect((await publicItem(id)).photo!.alt).toBe(`Replace ${tag}`);

    expect((await removePhoto(json("DELETE", "/x", "manager", {}), ctx(id))).status).toBe(200);
    expect((await row(id)).photo).toBeNull();
    expect(assets.has(second)).toBe(false);
    expect((await removePhoto(json("DELETE", "/x", "manager", {}), ctx(id))).status).toBe(404); // nothing left to remove

    const id2 = await newItem("Doomed");
    const p = (await (await upload(send("manager", await img(2000, 1500)), ctx(id2))).json()).photo as string;
    expect((await deleteItem(json("DELETE", "/x", "manager", undefined), ctx(id2))).status).toBe(200);
    expect(assets.has(p)).toBe(false);
  });

  it("the same photo on two items: deleting one never breaks the other's picture", async () => {
    const a = await newItem("TwinA");
    const b = await newItem("TwinB");
    const bytes = await img(2000, 1500);
    const pa = (await (await upload(send("manager", bytes), ctx(a))).json()).photo as string;
    const pb = (await (await upload(send("manager", bytes), ctx(b))).json()).photo as string;
    expect(pa).toBe(pb); // content-hashed: same bytes, same asset
    await removePhoto(json("DELETE", "/x", "manager", {}), ctx(a));
    // KNOWN LIMIT: the shared asset is destroyed, so the twin's image now 404s at Cloudinary until re-uploaded.
    // Recorded in docs/preview-deploy.md; acceptable because the same photo on two items is rare and harmless.
    expect((await row(b)).photo).toBe(pb);
  });

  it("a malformed stored value shows no photo instead of a broken image", async () => {
    const id = await newItem("Odd");
    await db.update(item).set({ photo: "../../etc/passwd" }).where(eq(item.id, id));
    expect((await publicItem(id)).photo).toBeNull();
  });
});
