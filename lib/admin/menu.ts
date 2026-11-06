import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { category, item, offer, option, optionGroup } from "@/db/schema";
import type { Db } from "@/lib/db/client";
import { normaliseEntry } from "@/lib/allergens";
import { slugify } from "@/lib/menu-model";
import { auditInsert, type Actor } from "./audit";
import type { OptionGroupInput } from "./menu-schema";
import type { Result } from "./settings";

// Menu manager data layer (R9.7). Each change is written together with its
// audit-log entry in ONE transaction (R9.13). Allergen edits are food-safety
// critical, which is why before/after are recorded. Callers refresh the public
// menu cache afterwards (lib/menu-cache.ts).

export type AdminCategory = { id: number; name: string; slug: string; sortOrder: number; visible: boolean };
export type AdminItem = {
  id: number;
  categoryId: number;
  name: string;
  slug: string;
  description: string;
  price: number;
  /** null = not entered. Normalised: a list without its provenance timestamp reads as null. */
  allergens: string[] | null;
  allergensEnteredAt: string | null;
  photo: string | null;
  photoAlt: string | null;
  dietaryTags: string[];
  soldOut: boolean;
  visible: boolean;
  sortOrder: number;
};
export type AdminOptionGroup = {
  id: number;
  categoryId: number;
  name: string;
  required: boolean;
  minPicks: number;
  maxPicks: number;
  options: { id: number; name: string; priceChange: number; allergens: string[] | null; allergensEnteredAt: string | null }[];
};
export type MenuAdminView = { categories: AdminCategory[]; items: AdminItem[]; optionGroups: AdminOptionGroup[] };

export async function loadMenuAdmin(db: Db): Promise<MenuAdminView> {
  const [cats, items, groups, opts] = await db.batch([
    db.select().from(category).orderBy(asc(category.sortOrder), asc(category.id)),
    db.select().from(item).orderBy(asc(item.sortOrder), asc(item.id)),
    db.select().from(optionGroup),
    db.select().from(option).orderBy(asc(option.sortOrder), asc(option.id)),
  ]);
  return {
    categories: cats.map((c) => ({ id: c.id, name: c.name, slug: c.slug, sortOrder: c.sortOrder, visible: c.visible })),
    items: items.map((i) => ({ id: i.id, categoryId: i.categoryId, name: i.name, slug: i.slug, description: i.description, price: i.price, allergens: normaliseEntry(i.allergens, i.allergensEnteredAt), allergensEnteredAt: i.allergensEnteredAt?.toISOString() ?? null, photo: i.photo, photoAlt: i.photoAlt, dietaryTags: i.dietaryTags, soldOut: i.soldOut, visible: i.visible, sortOrder: i.sortOrder })),
    // The public menu model supports ONE category-level group per category.
    optionGroups: groups
      .filter((g) => g.itemId == null && g.categoryId != null)
      .map((g) => ({
        id: g.id,
        categoryId: g.categoryId!,
        name: g.name,
        required: g.required,
        minPicks: g.minPicks,
        maxPicks: g.maxPicks,
        options: opts.filter((o) => o.groupId === g.id).map((o) => ({ id: o.id, name: o.name, priceChange: o.priceChange, allergens: normaliseEntry(o.allergens, o.allergensEnteredAt), allergensEnteredAt: o.allergensEnteredAt?.toISOString() ?? null })),
      })),
  };
}

const isUnique = (e: unknown) => /duplicate key|unique/i.test(e instanceof Error ? `${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}` : "");

async function freeSlug(db: Db, table: typeof category | typeof item, base: string): Promise<string> {
  const rows = await db.select({ slug: table.slug }).from(table).where(sql`${table.slug} = ${base} or ${table.slug} like ${base + "-%"}`);
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

// ---- categories -------------------------------------------------------------------

// The public menu matches items and options to a category by NAME, so two
// categories must never share one (case-insensitively).
async function nameTaken(db: Db, name: string, exceptId?: number): Promise<boolean> {
  const rows = await db.select({ id: category.id }).from(category).where(sql`lower(${category.name}) = lower(${name})`);
  return rows.some((r) => r.id !== exceptId);
}

export async function createCategory(db: Db, a: Actor, c: { name: string; visible?: boolean }): Promise<Result<{ id: number }>> {
  if (await nameTaken(db, c.name)) return { ok: false, code: "DUPLICATE", message: "A category with that name already exists." };
  const slug = await freeSlug(db, category, slugify(c.name));
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${category.sortOrder}), 0)::int` }).from(category);
  try {
    const [row] = await db.insert(category).values({ name: c.name, slug, sortOrder: max + 1, visible: c.visible ?? true }).returning({ id: category.id });
    await auditInsert(db, a, "menu.category.create", `category:${row.id}`, null, { name: c.name, slug });
    return { ok: true, id: row.id };
  } catch (e) {
    if (isUnique(e)) return { ok: false, code: "DUPLICATE", message: "A category with that name already exists." };
    throw e;
  }
}

export async function updateCategory(db: Db, a: Actor, id: number, c: { name: string; visible?: boolean }): Promise<Result> {
  const [before] = await db.select().from(category).where(eq(category.id, id)).limit(1);
  if (!before) return { ok: false, code: "NOT_FOUND", message: "Category not found." };
  if (await nameTaken(db, c.name, id)) return { ok: false, code: "DUPLICATE", message: "A category with that name already exists." };
  const after = { name: c.name, visible: c.visible ?? before.visible };
  await db.batch([db.update(category).set(after).where(eq(category.id, id)), auditInsert(db, a, "menu.category.update", `category:${id}`, { name: before.name, visible: before.visible }, after)]);
  return { ok: true };
}

export async function deleteCategory(db: Db, a: Actor, id: number): Promise<Result> {
  const [before] = await db.select().from(category).where(eq(category.id, id)).limit(1);
  if (!before) return { ok: false, code: "NOT_FOUND", message: "Category not found." };
  const [items, offers] = await Promise.all([
    db.select({ id: item.id }).from(item).where(eq(item.categoryId, id)).limit(1),
    db.select({ id: offer.id }).from(offer).where(eq(offer.appliesToCategoryId, id)).limit(1),
  ]);
  if (items.length) return { ok: false, code: "INVALID", message: "This category still has items. Move or delete them first, or hide the category instead." };
  if (offers.length) return { ok: false, code: "INVALID", message: "An offer uses this category. Change or delete that offer first." };
  const groupIds = db.select({ id: optionGroup.id }).from(optionGroup).where(eq(optionGroup.categoryId, id));
  await db.batch([
    db.delete(option).where(inArray(option.groupId, groupIds)),
    db.delete(optionGroup).where(eq(optionGroup.categoryId, id)),
    db.delete(category).where(eq(category.id, id)),
    auditInsert(db, a, "menu.category.delete", `category:${id}`, before, null),
  ]);
  return { ok: true };
}

export async function reorderCategories(db: Db, a: Actor, ids: number[]): Promise<Result> {
  const existing = await db.select({ id: category.id }).from(category);
  if (!samePermutation(existing.map((c) => c.id), ids)) return { ok: false, code: "INVALID", message: "The list changed. Reload and try again." };
  await db.batch([...ids.map((id, n) => db.update(category).set({ sortOrder: n + 1 }).where(eq(category.id, id))), auditInsert(db, a, "menu.category.reorder", "category", null, ids)] as unknown as [ReturnType<typeof auditInsert>]);
  return { ok: true };
}

const samePermutation = (a: number[], b: number[]) => a.length === b.length && new Set(b).size === b.length && a.every((x) => b.includes(x));

// ---- items ----------------------------------------------------------------------------

type ItemFields = Omit<AdminItem, "id" | "slug" | "sortOrder" | "allergensEnteredAt" | "photo" | "photoAlt">;

export async function createItem(db: Db, a: Actor, f: ItemFields): Promise<Result<{ id: number; slug: string }>> {
  const [cat] = await db.select({ id: category.id }).from(category).where(eq(category.id, f.categoryId)).limit(1);
  if (!cat) return { ok: false, code: "INVALID", message: "Choose a category." };
  const slug = await freeSlug(db, item, slugify(f.name));
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${item.sortOrder}), 0)::int` }).from(item).where(eq(item.categoryId, f.categoryId));
  // An entered list is stamped with the time a person entered it; null stays null (the database requires the pair).
  const [row] = await db.insert(item).values({ ...f, allergensEnteredAt: f.allergens === null ? null : a.now, slug, sortOrder: max + 1 }).returning({ id: item.id });
  await auditInsert(db, a, "menu.item.create", `item:${row.id}`, null, f);
  return { ok: true, id: row.id, slug };
}

const sameSet = (x: string[], y: string[]) => x.length === y.length && x.every((k) => y.includes(k));

const editable = (i: typeof item.$inferSelect): ItemFields => ({
  categoryId: i.categoryId, name: i.name, description: i.description, price: i.price, allergens: i.allergens, dietaryTags: i.dietaryTags, soldOut: i.soldOut, visible: i.visible,
});

export async function updateItem(db: Db, a: Actor, id: number, f: ItemFields): Promise<Result> {
  const [before] = await db.select().from(item).where(eq(item.id, id)).limit(1);
  if (!before) return { ok: false, code: "NOT_FOUND", message: "Item not found." };
  const [cat] = await db.select({ id: category.id }).from(category).where(eq(category.id, f.categoryId)).limit(1);
  if (!cat) return { ok: false, code: "INVALID", message: "Choose a category." };
  // The slug never changes on rename: it is part of the item's id, which baskets keep.
  let sortOrder = before.sortOrder;
  if (f.categoryId !== before.categoryId) {
    const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${item.sortOrder}), 0)::int` }).from(item).where(eq(item.categoryId, f.categoryId));
    sortOrder = max + 1; // moved: goes to the end of its new category
  }
  // Re-saving the same list keeps its original entry time; changing it, or entering it for the first time, stamps now; clearing it removes the stamp.
  const same = f.allergens !== null && before.allergens !== null && before.allergensEnteredAt !== null && sameSet(f.allergens, before.allergens);
  const allergensEnteredAt = f.allergens === null ? null : same ? before.allergensEnteredAt : a.now;
  await db.batch([db.update(item).set({ ...f, allergensEnteredAt, sortOrder }).where(eq(item.id, id)), auditInsert(db, a, "menu.item.update", `item:${id}`, editable(before), f)]);
  return { ok: true };
}

export async function patchItemFlags(db: Db, a: Actor, id: number, p: { soldOut?: boolean; visible?: boolean }): Promise<Result> {
  const [before] = await db.select().from(item).where(eq(item.id, id)).limit(1);
  if (!before) return { ok: false, code: "NOT_FOUND", message: "Item not found." };
  const after = { soldOut: p.soldOut ?? before.soldOut, visible: p.visible ?? before.visible };
  await db.batch([db.update(item).set(after).where(eq(item.id, id)), auditInsert(db, a, "menu.item.flags", `item:${id}`, { soldOut: before.soldOut, visible: before.visible }, after)]);
  return { ok: true };
}

export async function deleteItem(db: Db, a: Actor, id: number, opts: { onPhotoRemoved?: (base: string) => Promise<void> } = {}): Promise<Result> {
  const [before] = await db.select().from(item).where(eq(item.id, id)).limit(1);
  if (!before) return { ok: false, code: "NOT_FOUND", message: "Item not found." };
  // Past orders keep their own copy of name and price, so deleting is safe for history.
  const itemGroups = db.select({ id: optionGroup.id }).from(optionGroup).where(eq(optionGroup.itemId, id));
  await db.batch([
    db.delete(option).where(inArray(option.groupId, itemGroups)),
    db.delete(optionGroup).where(eq(optionGroup.itemId, id)),
    db.delete(item).where(eq(item.id, id)),
    auditInsert(db, a, "menu.item.delete", `item:${id}`, editable(before), null),
  ]);
  // The photo files are removed after the item is gone; a failure here only leaves an unused file behind.
  if (before.photo && opts.onPhotoRemoved) await opts.onPhotoRemoved(before.photo).catch(() => undefined);
  return { ok: true };
}

export async function reorderItems(db: Db, a: Actor, categoryId: number, ids: number[]): Promise<Result> {
  const existing = await db.select({ id: item.id }).from(item).where(eq(item.categoryId, categoryId));
  if (!samePermutation(existing.map((i) => i.id), ids)) return { ok: false, code: "INVALID", message: "The list changed. Reload and try again." };
  await db.batch([...ids.map((id, n) => db.update(item).set({ sortOrder: n + 1 }).where(and(eq(item.id, id), eq(item.categoryId, categoryId)))), auditInsert(db, a, "menu.item.reorder", `category:${categoryId}`, null, ids)] as unknown as [ReturnType<typeof auditInsert>]);
  return { ok: true };
}

// ---- option group (one per category: "Make it a Meal", extras) -------------------------------

export async function saveOptionGroup(db: Db, a: Actor, categoryId: number, g: OptionGroupInput): Promise<Result> {
  const [cat] = await db.select({ id: category.id }).from(category).where(eq(category.id, categoryId)).limit(1);
  if (!cat) return { ok: false, code: "NOT_FOUND", message: "Category not found." };
  const before = (await loadMenuAdmin(db)).optionGroups.find((x) => x.categoryId === categoryId) ?? null;
  // Pre-allocate the id so the group and its options go in ONE transaction.
  const seq = await db.execute<{ id: string }>(sql`select nextval(pg_get_serial_sequence('option_group', 'id'))::text as id`);
  const groupId = Number(seq.rows[0].id);
  const oldGroups = db.select({ id: optionGroup.id }).from(optionGroup).where(and(eq(optionGroup.categoryId, categoryId), sql`${optionGroup.itemId} is null`));
  const minPicks = g.required ? Math.max(g.minPicks, 1) : g.minPicks; // required means at least one
  const prevOptions = await db.select().from(option).where(inArray(option.groupId, oldGroups));
  await db.batch([
    db.delete(option).where(inArray(option.groupId, oldGroups)),
    db.delete(optionGroup).where(and(eq(optionGroup.categoryId, categoryId), sql`${optionGroup.itemId} is null`)),
    db.insert(optionGroup).values({ id: groupId, categoryId, name: g.name, required: g.required, minPicks, maxPicks: g.maxPicks }),
    db.insert(option).values(
      g.options.map((o, n) => {
        const was = prevOptions.find((p) => p.name === o.name);
        const kept = o.allergens !== null && was?.allergens != null && was.allergensEnteredAt != null && sameSet(o.allergens, was.allergens);
        return { groupId, name: o.name, priceChange: o.priceChange, sortOrder: n, allergens: o.allergens, allergensEnteredAt: o.allergens === null ? null : kept ? was!.allergensEnteredAt : a.now };
      }),
    ),
    auditInsert(db, a, "menu.options.save", `category:${categoryId}`, before, { ...g, minPicks }),
  ]);
  return { ok: true };
}

export async function deleteOptionGroup(db: Db, a: Actor, categoryId: number): Promise<Result> {
  const before = (await loadMenuAdmin(db)).optionGroups.find((x) => x.categoryId === categoryId);
  if (!before) return { ok: false, code: "NOT_FOUND", message: "This category has no options." };
  await db.batch([
    db.delete(option).where(eq(option.groupId, before.id)),
    db.delete(optionGroup).where(eq(optionGroup.id, before.id)),
    auditInsert(db, a, "menu.options.delete", `category:${categoryId}`, before, null),
  ]);
  return { ok: true };
}
