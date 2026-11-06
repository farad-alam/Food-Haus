import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { adminUser, auditLog, category, item } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { createAdminUser } from "@/lib/auth/pg-store";
import { generateToken, hashToken } from "@/lib/auth/service";
import { adminStore } from "@/lib/admin/guard";
import { loadMenuRows } from "@/lib/db/menu-repo";
import { rowsToMenu } from "@/lib/menu-model";
import { allVariantKeys, isBaseKey, photoUrl } from "@/lib/photos/keys";
import { POST as postCategory } from "@/app/api/admin/menu/categories/route";
import { POST as postItem } from "@/app/api/admin/menu/items/route";
import { DELETE as deleteItem } from "@/app/api/admin/menu/items/[id]/route";
import { POST as upload, PUT as putAlt, DELETE as removePhoto } from "@/app/api/admin/menu/items/[id]/photo/route";
import { GET as media } from "@/app/media/[...key]/route";

// Real handlers, real database, a real folder (temp) as the photo store and sharp as the processor:
// the same code path as development. The R2 and Cloudflare Images implementations are covered
// against fakes in tests/photos.test.ts, and must be verified against the real services after deploy.
const enabled = !!process.env.DATABASE_URL;
const ORIGIN = "http://localhost:3000";
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(6)));
const tag = crypto.randomUUID().slice(0, 6);

describe.skipIf(!enabled)("menu photos (real database, filesystem store)", () => {
  const db = enabled ? getDb() : (null as never);
  const users: Record<string, { id: number; cookie: string }> = {};
  let dir = "";
  let savedKey: string | undefined;
  let savedDir: string | undefined;
  let catId = 0;

  const img = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 40, g: 120, b: 200 } } }).jpeg().toBuffer();
  const files = async () => { try { return (await readdir(join(dir, "menu"))).filter((f) => !f.endsWith(".type")).sort(); } catch { return []; } };
  const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
  const mkUser = async (role: "manager" | "kitchen") => {
    const id = await createAdminUser(db, KEY, { email: `${role}-photo-${tag}@example.test`, passwordHash: "x", role });
    const token = generateToken();
    const now = new Date();
    await adminStore().createSession({ tokenHash: await hashToken(token), userId: id, createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + 3_600_000) });
    users[role] = { id, cookie: `fh_admin=${token}` };
  };
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
    savedKey = process.env.SECRET_BOX_KEY;
    savedDir = process.env.PHOTO_STORE_DIR;
    process.env.SECRET_BOX_KEY = KEY;
    dir = await mkdtemp(join(tmpdir(), "fh-photo-routes-"));
    process.env.PHOTO_STORE_DIR = dir;
    await mkUser("manager");
    await mkUser("kitchen");
    const r = await postCategory(json("POST", "/api/admin/menu/categories", "manager", { name: `Photos ${tag}` }));
    catId = (await r.json()).id;
  });
  afterAll(async () => {
    const cats = await db.select({ id: category.id }).from(category).where(like(category.name, `%${tag}%`));
    const ids = cats.map((c) => c.id);
    if (ids.length) {
      await db.delete(item).where(inArray(item.categoryId, ids));
      await db.delete(category).where(inArray(category.id, ids));
    }
    const u = Object.values(users).map((x) => x.id);
    await db.delete(auditLog).where(inArray(auditLog.userId, u));
    await db.delete(adminUser).where(inArray(adminUser.id, u));
    if (dir) await rm(dir, { recursive: true, force: true });
    if (savedKey === undefined) delete process.env.SECRET_BOX_KEY;
    else process.env.SECRET_BOX_KEY = savedKey;
    if (savedDir === undefined) delete process.env.PHOTO_STORE_DIR;
    else process.env.PHOTO_STORE_DIR = savedDir;
  });

  it("is for menu editors only: no session 401, kitchen 403, cross-site 403, and nothing is stored", async () => {
    const id = await newItem("Guarded");
    const good = await img(1600, 1200);
    expect((await upload(send(null, good), ctx(id))).status).toBe(401);
    expect((await upload(send("kitchen", good), ctx(id))).status).toBe(403);
    expect((await upload(send("manager", good, { origin: "https://evil.example" }), ctx(id))).status).toBe(403);
    expect((await removePhoto(json("DELETE", "/x", "kitchen", {}), ctx(id))).status).toBe(403);
    expect((await putAlt(json("PUT", "/x", "kitchen", { alt: "x" }), ctx(id))).status).toBe(403);
    expect((await row(id)).photo).toBeNull();
    expect(await files()).toEqual([]);
  });

  it("uploads, resizes, stores three sizes, points the item at them, and the public menu shows it with the item name as alt text", async () => {
    const id = await newItem("Burger");
    const res = await upload(send("manager", await img(3000, 2000)), ctx(id));
    expect(res.status).toBe(200);
    const { photo } = await res.json();
    expect(isBaseKey(photo)).toBe(true);
    expect((await row(id)).photo).toBe(photo);
    expect(await files()).toEqual(allVariantKeys(photo).map((k) => k.replace("menu/", "")).sort());
    const pub = await publicItem(id);
    expect(pub.photo).toEqual({ key: photo, alt: `Burger ${tag}` }); // R11.15: falls back to the name
    const trail = await db.select().from(auditLog).where(eq(auditLog.entity, `item:${id}`));
    expect(trail.some((t) => t.action === "menu.item.photo")).toBe(true);
  });

  it("serves the photo publicly with long-lived caching, and refuses anything that is not a photo key", async () => {
    const id = await newItem("Served");
    const { photo } = await (await upload(send("manager", await img(2000, 1500)), ctx(id))).json();
    const get = (path: string[]) => media(new Request(`${ORIGIN}/media/${path.join("/")}`), { params: Promise.resolve({ key: path }) });
    const ok = await get(photoUrl(photo, 800).replace("/media/", "").split("/"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/webp");
    expect(ok.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    const m = await sharp(Buffer.from(await ok.arrayBuffer())).metadata();
    expect([m.format, m.width, m.height]).toEqual(["webp", 800, 600]);
    for (const bad of [["menu", "..", "..", "etc", "passwd"], ["menu", "0123456789abcdef-800.webp"], ["menu", `${photo.split("/")[1]}-800.png`], ["..", "x.webp"], ["menu", `${photo.split("/")[1]}-9999.webp`]]) {
      expect([bad, (await get(bad)).status]).toEqual([bad, 404]);
    }
  });

  it("rejects a bad upload with a plain message, keeps the old photo, and stores nothing new", async () => {
    const id = await newItem("Keeps");
    const { photo } = await (await upload(send("manager", await img(2000, 1500)), ctx(id))).json();
    const before = await files();
    const cases: [string, Request, number, RegExp][] = [
      ["too small", send("manager", await img(600, 400)), 400, /too small/i],
      ["not an image", send("manager", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), { type: "image/svg+xml" }), 400, /JPEG, PNG or WebP/],
      ["a text file called .jpg", send("manager", Buffer.from("not a picture at all")), 400, /JPEG, PNG or WebP/],
      ["no file", send("manager", null), 400, /choose a photo/i],
      ["wrong content type", new Request(`${ORIGIN}/api/admin/menu/items/1/photo`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie: users.manager.cookie }, body: "{}" }), 415, /choose a photo/i],
      ["huge", send("manager", Buffer.alloc(9 * 1024 * 1024, 0xff)), 413, /too big/i],
    ];
    for (const [name, req, status, msg] of cases) {
      const r = await upload(req, ctx(id));
      const b = await r.json();
      // A real browser sends Content-Length, so a huge file is stopped before it is read (413); without it the pipeline refuses it (400).
      expect([name, name === "huge" ? [400, 413].includes(r.status) : r.status === status]).toEqual([name, name === "huge" ? true : true]);
      expect([name, msg.test(b.message)]).toEqual([name, true]);
    }
    expect((await row(id)).photo).toBe(photo);
    expect(await files()).toEqual(before);
    expect((await upload(send("manager", await img(1600, 1200)), ctx(2_000_000_000))).status).toBe(404);
  });

  it("replacing a photo removes the old files; removing deletes them and the alt text; deleting the item cleans up too", async () => {
    const id = await newItem("Replace");
    const first = (await (await upload(send("manager", await img(2000, 1500), { alt: "A burger on a tray" }), ctx(id))).json()).photo as string;
    expect((await row(id)).photoAlt).toBe("A burger on a tray");
    expect((await publicItem(id)).photo!.alt).toBe("A burger on a tray");
    const second = (await (await upload(send("manager", await sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#f0f" } }).jpeg().toBuffer()), ctx(id))).json()).photo as string;
    expect(second).not.toBe(first);
    const names = await files();
    expect(allVariantKeys(first).every((k) => !names.includes(k.replace("menu/", "")))).toBe(true);
    expect(allVariantKeys(second).every((k) => names.includes(k.replace("menu/", "")))).toBe(true);
    expect((await row(id)).photoAlt).toBe("A burger on a tray"); // a new photo without new text keeps the old text

    expect((await putAlt(json("PUT", "/x", "manager", { alt: "  Cheese   stack  " }), ctx(id))).status).toBe(200);
    expect((await row(id)).photoAlt).toBe("Cheese stack"); // tidied
    expect((await putAlt(json("PUT", "/x", "manager", { alt: "x".repeat(500) }), ctx(id))).status).toBe(400);
    expect((await putAlt(json("PUT", "/x", "manager", { alt: null }), ctx(id))).status).toBe(200);
    expect((await publicItem(id)).photo!.alt).toBe(`Replace ${tag}`);

    expect((await removePhoto(json("DELETE", "/x", "manager", {}), ctx(id))).status).toBe(200);
    expect((await row(id)).photo).toBeNull();
    expect((await publicItem(id)).photo).toBeNull();
    expect(await files()).not.toContain(second.replace("menu/", "") + "-800.webp");
    expect((await removePhoto(json("DELETE", "/x", "manager", {}), ctx(id))).status).toBe(404); // nothing left to remove

    const id2 = await newItem("Doomed");
    const p = (await (await upload(send("manager", await img(2000, 1500)), ctx(id2))).json()).photo as string;
    expect((await deleteItem(json("DELETE", "/x", "manager", undefined), ctx(id2))).status).toBe(200);
    expect((await files()).filter((f) => f.startsWith(p.replace("menu/", "")))).toEqual([]);
  });

  it("a malformed stored key shows no photo instead of a broken image", async () => {
    const id = await newItem("Odd");
    await db.update(item).set({ photo: "../../etc/passwd" }).where(eq(item.id, id));
    expect((await publicItem(id)).photo).toBeNull();
  });
});
