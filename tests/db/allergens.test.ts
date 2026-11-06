import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { auditLog, category, item, option, optionGroup, adminUser } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { loadMenuRows } from "@/lib/db/menu-repo";
import { createCategory, createItem, loadMenuAdmin, saveOptionGroup, updateItem } from "@/lib/admin/menu";
import { rowsToMenu } from "@/lib/menu-model";
import { readinessFromMenu } from "@/lib/allergen-readiness";
import { claimText, itemClaim } from "@/lib/allergens";

// Real database. Only its own (tagged) category is created, edited and removed.
const enabled = !!process.env.DATABASE_URL;
const tag = crypto.randomUUID().slice(0, 6);

describe.skipIf(!enabled)("allergen data in the database", () => {
  const db = enabled ? getDb() : (null as never);
  let userId: number | null = null;
  let catId = 0;
  const T = (n: number) => new Date(Date.UTC(2026, 10, 6, 10, n));
  const actor = (n: number) => ({ userId: userId!, now: T(n) });

  afterAll(async () => {
    const cats = await db.select({ id: category.id }).from(category).where(like(category.name, `%${tag}%`));
    const ids = cats.map((c) => c.id);
    if (ids.length) {
      const groups = await db.select({ id: optionGroup.id }).from(optionGroup).where(inArray(optionGroup.categoryId, ids));
      if (groups.length) await db.delete(option).where(inArray(option.groupId, groups.map((g) => g.id)));
      await db.delete(optionGroup).where(inArray(optionGroup.categoryId, ids));
      await db.delete(item).where(inArray(item.categoryId, ids));
      await db.delete(category).where(inArray(category.id, ids));
    }
    if (userId) {
      await db.delete(auditLog).where(eq(auditLog.userId, userId));
      await db.delete(adminUser).where(eq(adminUser.id, userId));
    }
  });

  /** The driver wraps the Postgres error; the constraint name is in the cause. */
  const refused = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      const err = e as Error & { cause?: Error };
      return `${err.message} ${err.cause?.message ?? ""}`;
    }
    return "";
  };
  const rowFor = async (id: number) => (await db.select().from(item).where(eq(item.id, id)))[0];
  const mine = async () => {
    const menu = rowsToMenu(await loadMenuRows(db));
    const c = menu.categories.find((x) => x.name === `Alg ${tag}`)!;
    return { menu, cat: c, opts: menu.optionGroups[`Alg ${tag}`]?.options ?? [] };
  };

  it("the database refuses a list that nobody entered (and an entry time with no list)", async () => {
    const [u] = await db.insert(adminUser).values({ email: `alg-${tag}@example.test`, passwordHash: "x", role: "manager" }).returning({ id: adminUser.id });
    userId = u.id;
    const c = await createCategory(db, actor(0), { name: `Alg ${tag}` });
    if (!c.ok) throw new Error("category");
    catId = c.id;
    const base = { categoryId: catId, name: `Raw ${tag}`, slug: `raw-${tag}`, price: 100 };
    expect(await refused(db.insert(item).values({ ...base, allergens: [] }))).toMatch(/item_allergens_provenance/);
    expect(await refused(db.insert(item).values({ ...base, slug: `raw2-${tag}`, allergens: null, allergensEnteredAt: T(0) }))).toMatch(/item_allergens_provenance/);
    const [ok] = await db.insert(item).values({ ...base, slug: `raw3-${tag}` }).returning(); // neither: fine, and means "not entered"
    expect(ok.allergens).toBeNull();
    expect(ok.allergensEnteredAt).toBeNull();
  });

  it("a new item starts as NOT ENTERED, and the public model and gate agree", async () => {
    const r = await createItem(db, actor(1), { categoryId: catId, name: `Plain ${tag}`, description: "", price: 500, allergens: null, dietaryTags: [], soldOut: false, visible: true });
    if (!r.ok) throw new Error("item");
    expect((await rowFor(r.id)).allergensEnteredAt).toBeNull();
    const { menu, cat } = await mine();
    const it_ = cat.items.find((i) => i.name === `Plain ${tag}`)!;
    expect(it_.allergens).toBeNull();
    expect(claimText(itemClaim(it_.allergens), false).ask).toBe(true);
    expect(readinessFromMenu(menu).itemsMissing.some((m) => m.name === `Plain ${tag}`)).toBe(true);
  });

  it("entering, re-saving, changing and clearing stamps the time correctly and is audited", async () => {
    const r = await createItem(db, actor(2), { categoryId: catId, name: `Stamp ${tag}`, description: "", price: 500, allergens: ["milk"], dietaryTags: [], soldOut: false, visible: true });
    if (!r.ok) throw new Error("item");
    const fields = (allergens: string[] | null) => ({ categoryId: catId, name: `Stamp ${tag}`, description: "", price: 500, allergens, dietaryTags: [], soldOut: false, visible: true });
    expect((await rowFor(r.id)).allergensEnteredAt?.getTime()).toBe(T(2).getTime());
    await updateItem(db, actor(3), r.id, { ...fields(["milk"]), price: 600 }); // a price change does not re-stamp the allergens
    expect((await rowFor(r.id)).allergensEnteredAt?.getTime()).toBe(T(2).getTime());
    await updateItem(db, actor(4), r.id, fields(["milk"])); // same list again
    expect((await rowFor(r.id)).allergensEnteredAt?.getTime()).toBe(T(2).getTime());
    await updateItem(db, actor(5), r.id, fields([])); // changed to an explicit 'none'
    let row = await rowFor(r.id);
    expect(row.allergens).toEqual([]);
    expect(row.allergensEnteredAt?.getTime()).toBe(T(5).getTime());
    await updateItem(db, actor(6), r.id, fields(null)); // cleared: back to not entered, stamp removed
    row = await rowFor(r.id);
    expect([row.allergens, row.allergensEnteredAt]).toEqual([null, null]);
    const trail = await db.select().from(auditLog).where(eq(auditLog.entity, `item:${r.id}`));
    expect(trail.length).toBe(5); // create + 4 updates, with before and after
  });

  it("options carry their own data: an unconfirmed option stops the item claiming 'none'", async () => {
    const r = await createItem(db, actor(7), { categoryId: catId, name: `Burger ${tag}`, description: "", price: 800, allergens: [], dietaryTags: [], soldOut: false, visible: true });
    if (!r.ok) throw new Error("item");
    const group = (allergens: string[] | null) => ({ name: "Meal", required: false, minPicks: 0, maxPicks: 1, options: [{ name: "Fries and drink", priceChange: 349, allergens }] });
    expect((await saveOptionGroup(db, actor(8), catId, group(null))).ok).toBe(true);
    let m = await mine();
    expect(m.opts.map((o) => o.allergens)).toEqual([null]);
    const burger = m.cat.items.find((i) => i.name === `Burger ${tag}`)!;
    expect(burger.allergens).toEqual([]); // the item itself is confirmed
    const unconfirmed = claimText(itemClaim(burger.allergens, m.opts.map((o) => o.allergens)), true);
    expect(unconfirmed.ask).toBe(true);
    expect(unconfirmed.text).not.toMatch(/^No major/);
    expect(readinessFromMenu(m.menu).optionsMissing).toContainEqual({ category: `Alg ${tag}`, name: "Fries and drink" });

    expect((await saveOptionGroup(db, actor(9), catId, group(["gluten", "milk"]))).ok).toBe(true);
    m = await mine();
    expect(m.opts[0].allergens).toEqual(["gluten", "milk"]);
    const after = claimText(itemClaim(burger.allergens, m.opts.map((o) => o.allergens)), true);
    expect(after.text).not.toMatch(/^No major/); // the option adds allergens, so never a flat "none"
    const stamped = (await loadMenuAdmin(db)).optionGroups.find((g) => g.categoryId === catId)!.options[0];
    expect(stamped.allergensEnteredAt).toBe(T(9).toISOString());

    await saveOptionGroup(db, actor(10), catId, group(["milk", "gluten"])); // same set, different order: not re-stamped
    expect((await loadMenuAdmin(db)).optionGroups.find((g) => g.categoryId === catId)!.options[0].allergensEnteredAt).toBe(T(9).toISOString());

    await saveOptionGroup(db, actor(11), catId, group([]));
    m = await mine();
    expect(claimText(itemClaim(burger.allergens, m.opts.map((o) => o.allergens)), true).text).toMatch(/^No major allergens declared/);
  });
});
