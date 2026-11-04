import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { category, item, offer, option, optionGroup, settings } from "../db/schema";
import { seedRows, slugify } from "../lib/menu-model";
import seed from "../data/menu-seed.json";

// Loads the print-menu seed into an EMPTY database. Refuses to run if the menu
// already has categories, so it can never overwrite prices the owner edited.
// The data is SAMPLE data from the print menu: allergens are null (not yet
// supplied) and several descriptions carry the print typos.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
const db = drizzle(neon(url));

if ((await db.select({ id: category.id }).from(category).limit(1)).length > 0) {
  console.log("Menu already has data; nothing seeded.");
  process.exit(0);
}

const rows = seedRows();
const cats = await db
  .insert(category)
  .values(rows.categories.map((c) => ({ name: c.name, slug: slugify(c.name), sortOrder: c.sortOrder, visible: c.visible })))
  .returning();
const catId = new Map(cats.map((c) => [c.name, c.id]));

await db.insert(item).values(
  rows.items.map((i) => ({
    categoryId: catId.get(i.category)!,
    name: i.name,
    slug: slugify(i.name),
    description: i.description,
    price: i.price,
    allergens: i.allergens,
    dietaryTags: i.dietaryTags,
    soldOut: i.soldOut,
    visible: i.visible,
    sortOrder: i.sortOrder,
  })),
);

for (const g of rows.optionGroups) {
  const [grp] = await db
    .insert(optionGroup)
    .values({ categoryId: catId.get(g.category)!, name: g.name, required: g.required, minPicks: g.minPicks, maxPicks: g.maxPicks })
    .returning({ id: optionGroup.id });
  await db.insert(option).values(g.options.map((o, n) => ({ groupId: grp.id, name: o.name, priceChange: o.priceChange, sortOrder: n })));
}

const offerType = { buy_one_get_one_free: "bogof" } as const;
const offerChannel = { collection_only: "collection", delivery_only: "delivery" } as const;
for (const o of seed.offers) {
  await db.insert(offer).values({
    name: o.name,
    type: offerType[o.type as keyof typeof offerType],
    appliesToCategoryId: o.applies_to_category ? catId.get(o.applies_to_category) : null,
    channel: offerChannel[o.channel as keyof typeof offerChannel] ?? "any",
    code: o.code,
    minSpend: o.minimum_spend,
    usageLimit: o.usage_limit,
    showOnSite: o.show_on_site,
  });
}

if ((await db.select().from(settings).where(eq(settings.id, 1))).length === 0) await db.insert(settings).values({ id: 1 });
console.log(`Seeded ${cats.length} categories, ${rows.items.length} items, ${seed.offers.length} offer(s).`);
