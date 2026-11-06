import { asc, eq } from "drizzle-orm";
import { category, item, offer, optionGroup, option, deliveryZone, settings } from "@/db/schema";
import type { OfferRule, Zone } from "@/lib/pricing";
import type { MenuRows } from "@/lib/menu-model";
import type { Db } from "./client";

// Reads for the public menu and the pricing engine. Writes (admin) come later
// and must call revalidateTag("menu", "max").

export async function loadMenuRows(db: Db): Promise<MenuRows> {
  const [cats, items, groups, opts] = await db.batch([
    db.select().from(category).orderBy(asc(category.sortOrder)),
    db.select().from(item).orderBy(asc(item.sortOrder)),
    db.select().from(optionGroup),
    db.select().from(option).orderBy(asc(option.sortOrder)),
  ]);
  const catName = new Map(cats.map((c) => [c.id, c.name]));

  return {
    categories: cats.map((c) => ({ name: c.name, slug: c.slug, sortOrder: c.sortOrder, visible: c.visible })),
    items: items.map((i) => ({
      category: catName.get(i.categoryId) ?? "",
      name: i.name,
      slug: i.slug,
      description: i.description,
      price: i.price,
      allergens: i.allergens,
      allergensEnteredAt: i.allergensEnteredAt,
      photo: i.photo,
      photoAlt: i.photoAlt,
      dietaryTags: i.dietaryTags,
      soldOut: i.soldOut,
      visible: i.visible,
      sortOrder: i.sortOrder,
    })),
    // Item-level groups are not supported by the Menu shape yet; only
    // category-level groups ("Make it a Meal") are loaded.
    optionGroups: groups
      .filter((g) => g.itemId == null && g.categoryId != null)
      .map((g) => ({
        category: catName.get(g.categoryId!) ?? "",
        name: g.name,
        required: g.required,
        minPicks: g.minPicks,
        maxPicks: g.maxPicks,
        options: opts
          .filter((o) => o.groupId === g.id)
          .map((o) => ({ name: o.name, priceChange: o.priceChange, sortOrder: o.sortOrder, allergens: o.allergens, allergensEnteredAt: o.allergensEnteredAt })),
      })),
  };
}

export async function loadZones(db: Db): Promise<Zone[]> {
  const rows = await db.select().from(deliveryZone);
  return rows.map((z) => ({
    district: z.district,
    fee: z.fee,
    minOrder: z.minOrder,
    estimatedMinutes: z.estimatedMinutes,
    active: z.active,
  }));
}

export async function loadOffers(db: Db): Promise<OfferRule[]> {
  const [offers, cats] = await db.batch([db.select().from(offer), db.select().from(category)]);
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  return offers.map((o) => ({
    id: o.id,
    name: o.name,
    type: o.type,
    value: o.value,
    appliesToCategory: o.appliesToCategoryId ? (catName.get(o.appliesToCategoryId) ?? null) : null,
    channel: o.channel,
    code: o.code,
    minSpend: o.minSpend,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    usageLimit: o.usageLimit,
    usedCount: o.usedCount,
  }));
}

export async function loadSettings(db: Db) {
  const [s] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  return s ?? null;
}
