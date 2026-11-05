import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { adminUser, auditLog, category, item, option, optionGroup } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { createAdminUser } from "@/lib/auth/pg-store";
import { generateToken, hashToken } from "@/lib/auth/service";
import { adminStore } from "@/lib/admin/guard";
import { loadMenuRows } from "@/lib/db/menu-repo";
import { rowsToMenu } from "@/lib/menu-model";
import { priceOrder } from "@/lib/pricing";
import { GET as getMenu } from "@/app/api/admin/menu/route";
import { POST as postCategory } from "@/app/api/admin/menu/categories/route";
import { PUT as putCategory, DELETE as deleteCategory } from "@/app/api/admin/menu/categories/[id]/route";
import { POST as reorderCategories } from "@/app/api/admin/menu/categories/reorder/route";
import { POST as postItem } from "@/app/api/admin/menu/items/route";
import { PUT as putItem, PATCH as patchItem, DELETE as deleteItem } from "@/app/api/admin/menu/items/[id]/route";
import { POST as reorderItems } from "@/app/api/admin/menu/items/reorder/route";
import { PUT as putOptions, DELETE as deleteOptions } from "@/app/api/admin/menu/options/[id]/route";

// Real handlers + real database. Creates only its own categories/items (names
// carry a random tag), never edits seeded data, and deletes everything after.
const enabled = !!process.env.DATABASE_URL;
const ORIGIN = "http://localhost:3000";
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(8)));
const tag = crypto.randomUUID().slice(0, 6);
const j = (r: Response) => r.json();

describe.skipIf(!enabled)("admin menu manager (real database)", () => {
  const db = enabled ? getDb() : (null as never);
  let savedKey: string | undefined;
  const users: Record<string, { id: number; cookie: string }> = {};

  async function mkUser(role: "manager" | "kitchen") {
    const id = await createAdminUser(db, KEY, { email: `${role}-menu-${tag}@example.test`, passwordHash: "x", role });
    const token = generateToken();
    const now = new Date();
    await adminStore().createSession({ tokenHash: await hashToken(token), userId: id, createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + 3_600_000) });
    users[role] = { id, cookie: `fh_admin=${token}` };
  }
  beforeAll(async () => {
    savedKey = process.env.SECRET_BOX_KEY;
    process.env.SECRET_BOX_KEY = KEY;
    await mkUser("manager");
    await mkUser("kitchen");
  });
  afterAll(async () => {
    const cats = await db.select({ id: category.id }).from(category).where(like(category.name, `%${tag}%`));
    const catIds = cats.map((c) => c.id);
    if (catIds.length) {
      const groups = await db.select({ id: optionGroup.id }).from(optionGroup).where(inArray(optionGroup.categoryId, catIds));
      if (groups.length) await db.delete(option).where(inArray(option.groupId, groups.map((g) => g.id)));
      await db.delete(optionGroup).where(inArray(optionGroup.categoryId, catIds));
      await db.delete(item).where(inArray(item.categoryId, catIds));
      await db.delete(category).where(inArray(category.id, catIds));
    }
    await db.delete(item).where(like(item.name, `%${tag}%`)); // items moved into seeded categories, if any
    const ids = Object.values(users).map((u) => u.id);
    await db.delete(auditLog).where(inArray(auditLog.userId, ids));
    await db.delete(adminUser).where(inArray(adminUser.id, ids));
    if (savedKey === undefined) delete process.env.SECRET_BOX_KEY;
    else process.env.SECRET_BOX_KEY = savedKey;
  });

  const req = (method: string, path: string, who: string | null, body?: unknown, origin: string | null = ORIGIN) =>
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(origin ? { origin } : {}), ...(who ? { cookie: users[who].cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
  const view = async () => j(await getMenu(req("GET", "/api/admin/menu", "manager")));
  const publicMenu = async () => rowsToMenu(await loadMenuRows(db));
  const audits = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action));

  const newCat = async (name: string, visible = true) => {
    const r = await postCategory(req("POST", "/api/admin/menu/categories", "manager", { name, visible }));
    expect(r.status).toBe(201);
    return (await j(r)).id as number;
  };
  const itemBody = (categoryId: number, over: Record<string, unknown> = {}) => ({
    name: `Item ${tag}`, description: "Test item", price: 799, categoryId, allergens: null, dietaryTags: [], soldOut: false, visible: true, ...over,
  });
  const newItem = async (categoryId: number, over: Record<string, unknown> = {}) => {
    const r = await postItem(req("POST", "/api/admin/menu/items", "manager", itemBody(categoryId, over)));
    expect(r.status).toBe(201);
    return (await j(r)) as { id: number; slug: string };
  };

  it("is owner/manager only: no session 401, kitchen 403 on every route, cross-site 403, nothing changes", async () => {
    const before = await view();
    const calls: [string, (who: string | null, origin?: string | null) => Promise<Response>][] = [
      ["GET", (w) => getMenu(req("GET", "/api/admin/menu", w))],
      ["POST category", (w, o) => postCategory(req("POST", "/api/admin/menu/categories", w, { name: `Nope ${tag}` }, o))],
      ["PUT category", (w, o) => putCategory(req("PUT", "/api/admin/menu/categories/1", w, { name: `Nope ${tag}` }, o), ctx(1))],
      ["DELETE category", (w, o) => deleteCategory(req("DELETE", "/api/admin/menu/categories/1", w, undefined, o), ctx(1))],
      ["reorder categories", (w, o) => reorderCategories(req("POST", "/api/admin/menu/categories/reorder", w, { ids: [1] }, o))],
      ["POST item", (w, o) => postItem(req("POST", "/api/admin/menu/items", w, itemBody(1), o))],
      ["PUT item", (w, o) => putItem(req("PUT", "/api/admin/menu/items/1", w, itemBody(1), o), ctx(1))],
      ["PATCH item", (w, o) => patchItem(req("PATCH", "/api/admin/menu/items/1", w, { soldOut: true }, o), ctx(1))],
      ["DELETE item", (w, o) => deleteItem(req("DELETE", "/api/admin/menu/items/1", w, undefined, o), ctx(1))],
      ["PUT options", (w, o) => putOptions(req("PUT", "/api/admin/menu/options/1", w, { name: "x", required: false, minPicks: 0, maxPicks: 1, options: [{ name: "a", priceChange: 0 }] }, o), ctx(1))],
      ["DELETE options", (w, o) => deleteOptions(req("DELETE", "/api/admin/menu/options/1", w, undefined, o), ctx(1))],
    ];
    for (const [name, call] of calls) {
      expect([name, (await call(null)).status]).toEqual([name, 401]);
      expect([name, (await call("kitchen")).status]).toEqual([name, 403]);
      if (name !== "GET") expect([name, (await call("manager", "https://evil.example")).status]).toEqual([name, 403]);
    }
    expect(await view()).toEqual(before);
  });

  describe("categories", () => {
    it("creates (slug from name, at the end), refuses case-insensitive duplicates, keeps the slug on rename", async () => {
      const name = `Sides ${tag}`;
      const id = await newCat(name);
      const v = await view();
      const c = v.categories.find((x: { id: number }) => x.id === id);
      expect(c.slug).toBe(`sides-${tag.toLowerCase()}`);
      expect(c.sortOrder).toBe(Math.max(...v.categories.map((x: { sortOrder: number }) => x.sortOrder)));
      const dup = await postCategory(req("POST", "/api/admin/menu/categories", "manager", { name: name.toUpperCase() }));
      expect(dup.status).toBe(409);
      expect((await putCategory(req("PUT", `/api/admin/menu/categories/${id}`, "manager", { name: `Renamed ${tag}`, visible: true }), ctx(id))).status).toBe(200);
      const after = (await view()).categories.find((x: { id: number }) => x.id === id);
      expect(after).toMatchObject({ name: `Renamed ${tag}`, slug: c.slug });
      expect((await putCategory(req("PUT", `/api/admin/menu/categories/${id}`, "manager", { name: "Burgers" }), ctx(id))).status).toBe(409); // clashes with a seeded name
      for (const bad of [{ name: "" }, { name: "!!!" }, { name: "x".repeat(61) }, { name: "ok", extra: 1 }]) {
        expect((await postCategory(req("POST", "/api/admin/menu/categories", "manager", bad))).status).toBe(400);
      }
      expect((await putCategory(req("PUT", "/api/admin/menu/categories/abc", "manager", { name: "x" }), ctx("abc"))).status).toBe(404);
      expect((await putCategory(req("PUT", "/api/admin/menu/categories/2000000000", "manager", { name: "x" }), ctx(2_000_000_000))).status).toBe(404);
    });

    it("renaming a category does not change its items' ids (customers' baskets keep working)", async () => {
      const catId = await newCat(`Wraps ${tag}`);
      const it = await newItem(catId, { name: `Wrap ${tag}` });
      const before = (await publicMenu()).categories.find((c) => c.name === `Wraps ${tag}`)!.items[0].id;
      await putCategory(req("PUT", `/api/admin/menu/categories/${catId}`, "manager", { name: `Roll-ups ${tag}` }), ctx(catId));
      const after = (await publicMenu()).categories.find((c) => c.name === `Roll-ups ${tag}`)!;
      expect(after.items[0].id).toBe(before);
      expect(before).toBe(`wraps-${tag.toLowerCase()}-${it.slug}`);
    });

    it("hiding a category removes it and its items from the public menu", async () => {
      const catId = await newCat(`Hide me ${tag}`);
      await newItem(catId, { name: `Hidden thing ${tag}` });
      expect((await publicMenu()).categories.some((c) => c.name === `Hide me ${tag}`)).toBe(true);
      await putCategory(req("PUT", `/api/admin/menu/categories/${catId}`, "manager", { name: `Hide me ${tag}`, visible: false }), ctx(catId));
      expect((await publicMenu()).categories.some((c) => c.name === `Hide me ${tag}`)).toBe(false);
    });

    it("delete is refused while the category has items, works when empty, and is audited", async () => {
      const catId = await newCat(`Temp ${tag}`);
      const it = await newItem(catId, { name: `Temp item ${tag}` });
      const refused = await deleteCategory(req("DELETE", `/api/admin/menu/categories/${catId}`, "manager"), ctx(catId));
      expect(refused.status).toBe(400);
      expect((await j(refused)).message).toMatch(/still has items/);
      await deleteItem(req("DELETE", `/api/admin/menu/items/${it.id}`, "manager"), ctx(it.id));
      expect((await deleteCategory(req("DELETE", `/api/admin/menu/categories/${catId}`, "manager"), ctx(catId))).status).toBe(200);
      expect((await deleteCategory(req("DELETE", `/api/admin/menu/categories/${catId}`, "manager"), ctx(catId))).status).toBe(404);
      expect((await audits("menu.category.delete")).length).toBeGreaterThanOrEqual(1);
    });

    it("reorder needs the exact full list; swapping two categories sticks; seeded order is untouched", async () => {
      const a = await newCat(`Order A ${tag}`);
      const b = await newCat(`Order B ${tag}`);
      const ids = (await view()).categories.map((c: { id: number }) => c.id) as number[];
      expect((await reorderCategories(req("POST", "/api/admin/menu/categories/reorder", "manager", { ids: ids.slice(1) }))).status).toBe(400); // missing one
      expect((await reorderCategories(req("POST", "/api/admin/menu/categories/reorder", "manager", { ids: [...ids, ids[0]] }))).status).toBe(400); // duplicate
      expect((await reorderCategories(req("POST", "/api/admin/menu/categories/reorder", "manager", { ids: [...ids, 2_000_000_000] }))).status).toBe(400);
      const swapped = ids.map((id) => (id === a ? b : id === b ? a : id));
      expect((await reorderCategories(req("POST", "/api/admin/menu/categories/reorder", "manager", { ids: swapped }))).status).toBe(200);
      const order = (await view()).categories.map((c: { id: number }) => c.id);
      expect(order.indexOf(b)).toBeLessThan(order.indexOf(a));
      expect(order.slice(0, ids.indexOf(a))).toEqual(ids.slice(0, ids.indexOf(a))); // everything before is unchanged
    });
  });

  describe("items", () => {
    it("creates an item with price, allergens and tags; slug is unique and stable; public menu shows it", async () => {
      const catId = await newCat(`Mains ${tag}`);
      const a = await newItem(catId, { name: `Stack ${tag}`, price: 1099, allergens: ["gluten", "milk"], dietaryTags: ["spicy"] });
      const b = await newItem(catId, { name: `Stack ${tag}` });
      expect(a.slug).toBe(`stack-${tag.toLowerCase()}`);
      expect(b.slug).toBe(`stack-${tag.toLowerCase()}-2`);
      const pub = (await publicMenu()).categories.find((c) => c.name === `Mains ${tag}`)!;
      expect(pub.items.map((i) => i.id)).toEqual([`mains-${tag.toLowerCase()}-${a.slug}`, `mains-${tag.toLowerCase()}-${b.slug}`]);
      expect(pub.items[0]).toMatchObject({ price: 1099, allergens: ["gluten", "milk"], dietaryTags: ["spicy"], soldOut: false });
      expect(pub.items[1].allergens).toBeNull(); // not supplied stays null, never guessed
    });

    it("rejects bad input and unknown categories without writing", async () => {
      const catId = await newCat(`Bad ${tag}`);
      const before = (await view()).items.length;
      const bads: Record<string, unknown>[] = [
        { price: 0 }, { price: 7.5 }, { price: 50_001 }, { name: "" }, { name: "###" }, { allergens: ["dairy"] }, { allergens: ["milk", "milk"] },
        { dietaryTags: ["gluten-free"] }, { slug: "hack" }, { id: 1 }, { categoryId: 2_000_000_000 }, { soldOut: "no" },
      ];
      for (const b of bads) {
        const r = await postItem(req("POST", "/api/admin/menu/items", "manager", itemBody(catId, b)));
        expect([JSON.stringify(b), r.status === 400]).toEqual([JSON.stringify(b), true]);
      }
      expect((await view()).items.length).toBe(before);
    });

    it("edits keep the slug; allergen changes are audited with before and after; null -> [] -> list", async () => {
      const catId = await newCat(`Edit ${tag}`);
      const it = await newItem(catId, { name: `Edit me ${tag}` });
      const put = (over: Record<string, unknown>) => putItem(req("PUT", `/api/admin/menu/items/${it.id}`, "manager", itemBody(catId, { name: `Renamed ${tag}`, ...over })), ctx(it.id));
      expect((await put({ allergens: [] })).status).toBe(200);
      expect((await view()).items.find((x: { id: number }) => x.id === it.id)).toMatchObject({ name: `Renamed ${tag}`, slug: it.slug, allergens: [] });
      expect((await put({ allergens: ["peanuts", "sesame"] })).status).toBe(200);
      const log = (await audits("menu.item.update")).filter((l) => l.entity === `item:${it.id}`);
      const last = log[log.length - 1];
      expect((last.before as { allergens: unknown }).allergens).toEqual([]);
      expect((last.after as { allergens: unknown }).allergens).toEqual(["peanuts", "sesame"]);
      expect(last.userId).toBe(users.manager.id);
    });

    it("a price change is live in the public menu AND is what the pricing engine charges", async () => {
      const catId = await newCat(`Price ${tag}`);
      const it = await newItem(catId, { name: `Priced ${tag}`, price: 700 });
      const id = `price-${tag.toLowerCase()}-${it.slug}`;
      const charge = async () => {
        const r = priceOrder({ menu: await publicMenu(), zones: [], offers: [], items: [{ itemId: id, quantity: 2 }], orderType: "collection", paymentMethod: "cash", now: new Date() });
        return r.ok ? r.total : r.errors[0].code;
      };
      expect(await charge()).toBe(1400);
      await putItem(req("PUT", `/api/admin/menu/items/${it.id}`, "manager", itemBody(catId, { name: `Priced ${tag}`, price: 850 })), ctx(it.id));
      expect(await charge()).toBe(1700);
    });

    it("sold out and hidden switches: orderable only when visible and in stock (R6.3)", async () => {
      const catId = await newCat(`Flags ${tag}`);
      const it = await newItem(catId, { name: `Flagged ${tag}` });
      const id = `flags-${tag.toLowerCase()}-${it.slug}`;
      const code = async () => {
        const r = priceOrder({ menu: await publicMenu(), zones: [], offers: [], items: [{ itemId: id, quantity: 1 }], orderType: "collection", paymentMethod: "cash", now: new Date() });
        return r.ok ? "OK" : r.errors[0].code;
      };
      expect(await code()).toBe("OK");
      expect((await patchItem(req("PATCH", `/api/admin/menu/items/${it.id}`, "manager", { soldOut: true }), ctx(it.id))).status).toBe(200);
      expect(await code()).toBe("SOLD_OUT");
      expect((await publicMenu()).categories.find((c) => c.name === `Flags ${tag}`)!.items[0].soldOut).toBe(true); // still listed, marked sold out
      await patchItem(req("PATCH", `/api/admin/menu/items/${it.id}`, "manager", { soldOut: false, visible: false }), ctx(it.id));
      expect(await code()).toBe("UNKNOWN_ITEM");
      expect((await publicMenu()).categories.find((c) => c.name === `Flags ${tag}`)!.items).toHaveLength(0);
      expect((await patchItem(req("PATCH", `/api/admin/menu/items/${it.id}`, "manager", {}), ctx(it.id))).status).toBe(400);
      expect((await patchItem(req("PATCH", `/api/admin/menu/items/${it.id}`, "manager", { price: 1 }), ctx(it.id))).status).toBe(400);
    });

    it("moving an item to another category sends it to the end of that category", async () => {
      const a = await newCat(`From ${tag}`);
      const b = await newCat(`To ${tag}`);
      const x = await newItem(a, { name: `Mover ${tag}` });
      const y = await newItem(b, { name: `Stayer ${tag}` });
      await putItem(req("PUT", `/api/admin/menu/items/${x.id}`, "manager", itemBody(b, { name: `Mover ${tag}` })), ctx(x.id));
      const items = (await view()).items.filter((i: { categoryId: number }) => i.categoryId === b);
      expect(items.map((i: { id: number }) => i.id)).toEqual([y.id, x.id]);
    });

    it("reorders within a category; a stale list is refused; delete removes it", async () => {
      const catId = await newCat(`Sort ${tag}`);
      const a = await newItem(catId, { name: `A ${tag}` });
      const b = await newItem(catId, { name: `B ${tag}` });
      const c = await newItem(catId, { name: `C ${tag}` });
      expect((await reorderItems(req("POST", "/api/admin/menu/items/reorder", "manager", { categoryId: catId, ids: [c.id, a.id, b.id] }))).status).toBe(200);
      expect((await publicMenu()).categories.find((x) => x.name === `Sort ${tag}`)!.items.map((i) => i.name)).toEqual([`C ${tag}`, `A ${tag}`, `B ${tag}`]);
      expect((await reorderItems(req("POST", "/api/admin/menu/items/reorder", "manager", { categoryId: catId, ids: [c.id, a.id] }))).status).toBe(400);
      expect((await deleteItem(req("DELETE", `/api/admin/menu/items/${b.id}`, "manager"), ctx(b.id))).status).toBe(200);
      expect((await deleteItem(req("DELETE", `/api/admin/menu/items/${b.id}`, "manager"), ctx(b.id))).status).toBe(404);
      expect((await view()).items.some((i: { id: number }) => i.id === b.id)).toBe(false);
    });
  });

  describe("option groups (Make it a Meal)", () => {
    const group = { name: "Make it a Meal", required: false, minPicks: 0, maxPicks: 1, options: [{ name: "Regular meal", priceChange: 349 }, { name: "Large meal", priceChange: 449 }] };
    it("saves a group that the public menu and the pricing engine use; saving again replaces it", async () => {
      const catId = await newCat(`Meals ${tag}`);
      const it = await newItem(catId, { name: `Combo ${tag}`, price: 800 });
      const id = `meals-${tag.toLowerCase()}-${it.slug}`;
      expect((await putOptions(req("PUT", `/api/admin/menu/options/${catId}`, "manager", group), ctx(catId))).status).toBe(200);
      let g = (await publicMenu()).optionGroups[`Meals ${tag}`];
      expect(g).toMatchObject({ name: "Make it a Meal", required: false, minPicks: 0, maxPicks: 1 });
      expect(g.options.map((o) => o.priceChange)).toEqual([349, 449]);
      const menu = await publicMenu();
      const r = priceOrder({ menu, zones: [], offers: [], items: [{ itemId: id, quantity: 1, optionIds: [g.options[1].id] }], orderType: "collection", paymentMethod: "cash", now: new Date() });
      expect(r.ok && r.total).toBe(800 + 449);

      const replaced = { ...group, name: "Add a drink", options: [{ name: "Cola", priceChange: 150 }] };
      expect((await putOptions(req("PUT", `/api/admin/menu/options/${catId}`, "manager", replaced), ctx(catId))).status).toBe(200);
      g = (await publicMenu()).optionGroups[`Meals ${tag}`];
      expect(g.name).toBe("Add a drink");
      expect(g.options.map((o) => o.name)).toEqual(["Cola"]);
      const groups = (await view()).optionGroups.filter((x: { categoryId: number }) => x.categoryId === catId);
      expect(groups).toHaveLength(1); // exactly one group per category
      expect((await audits("menu.options.save")).length).toBeGreaterThanOrEqual(2);
    });

    it("required forces at least one pick; invalid groups are refused and change nothing", async () => {
      const catId = await newCat(`Req ${tag}`);
      await putOptions(req("PUT", `/api/admin/menu/options/${catId}`, "manager", { ...group, required: true, minPicks: 0 }), ctx(catId));
      expect((await publicMenu()).optionGroups[`Req ${tag}`].minPicks).toBe(1);
      const before = await view();
      const bads = [
        { ...group, maxPicks: 3 }, { ...group, minPicks: 2 }, { ...group, options: [] },
        { ...group, options: [{ name: "A", priceChange: -5 }] }, { ...group, options: [{ name: "Same", priceChange: 1 }, { name: "same", priceChange: 2 }] },
        { ...group, extra: 1 }, { ...group, name: "" },
      ];
      for (const b of bads) expect((await putOptions(req("PUT", `/api/admin/menu/options/${catId}`, "manager", b), ctx(catId))).status).toBe(400);
      expect(await view()).toEqual(before);
      expect((await putOptions(req("PUT", "/api/admin/menu/options/2000000000", "manager", group), ctx(2_000_000_000))).status).toBe(404);
    });

    it("deleting the group removes it everywhere; a hidden category's options never reach the public menu", async () => {
      const catId = await newCat(`Gone ${tag}`);
      await putOptions(req("PUT", `/api/admin/menu/options/${catId}`, "manager", group), ctx(catId));
      expect((await deleteOptions(req("DELETE", `/api/admin/menu/options/${catId}`, "manager"), ctx(catId))).status).toBe(200);
      expect((await publicMenu()).optionGroups[`Gone ${tag}`]).toBeUndefined();
      expect((await deleteOptions(req("DELETE", `/api/admin/menu/options/${catId}`, "manager"), ctx(catId))).status).toBe(404);
      const hidden = await newCat(`Hidden opts ${tag}`, false);
      await putOptions(req("PUT", `/api/admin/menu/options/${hidden}`, "manager", group), ctx(hidden));
      expect((await publicMenu()).optionGroups[`Hidden opts ${tag}`]).toBeUndefined();
    });

    it("deleting a category with a group (and no items) also removes the group and its options", async () => {
      const catId = await newCat(`Cascade ${tag}`);
      await putOptions(req("PUT", `/api/admin/menu/options/${catId}`, "manager", group), ctx(catId));
      expect((await deleteCategory(req("DELETE", `/api/admin/menu/categories/${catId}`, "manager"), ctx(catId))).status).toBe(200);
      expect((await view()).optionGroups.some((x: { categoryId: number }) => x.categoryId === catId)).toBe(false);
    });
  });
});
