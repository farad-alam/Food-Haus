import seed from "@/data/menu-seed.json";
import { normaliseEntry } from "./allergens";
import { isBaseKey } from "./photos/keys";

// Pure menu model: types and the builder. No Next.js imports, so the pricing
// engine and its tests can use it directly. The cached accessor lives in
// lib/menu.ts.

/** allergens: null = NOT yet entered by the owner (never "none"). See lib/allergens.ts. */
export type MenuOption = { id: string; name: string; priceChange: number; allergens: string[] | null };
export type MenuOptionGroup = {
  id: string;
  name: string;
  required: boolean;
  minPicks: number;
  maxPicks: number;
  options: MenuOption[];
};
export type MenuItem = {
  id: string;
  slug: string;
  category: string;
  name: string;
  description: string;
  price: number; // pence
  /** null = allergen data NOT entered yet (launch blocker, R11.10); [] = the owner confirmed none. Only ever set through normaliseEntry. */
  allergens: string[] | null;
  dietaryTags: string[];
  soldOut: boolean;
  visible: boolean;
  /** Base key of the photo (see lib/photos/keys.ts) and its alt text (R11.15: falls back to the item name). null = no photo. */
  photo: { key: string; alt: string } | null;
};
export type MenuCategory = {
  name: string;
  slug: string;
  sortOrder: number;
  items: MenuItem[];
};
export type Menu = {
  categories: MenuCategory[];
  optionGroups: Record<string, MenuOptionGroup>; // keyed by category name
  popular: MenuItem[];
};

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const POPULAR = [
  "Classic Burger",
  "Bane Beef Burger",
  "The CluckerStack",
  "Hot Honey Wings",
  "Chicken Loaded Fries",
  "Peri Peri Tenders",
];

/** Flat rows as stored in Postgres (or derived from the seed file). */
export type MenuRows = {
  categories: { name: string; slug?: string; sortOrder: number; visible: boolean }[];
  items: {
    category: string;
    name: string;
    slug?: string;
    description: string;
    price: number;
    allergens: string[] | null;
    /** When a person explicitly entered `allergens`. Missing = not entered, whatever `allergens` holds. */
    allergensEnteredAt?: Date | string | null;
    dietaryTags: string[];
    photo?: string | null;
    photoAlt?: string | null;
    soldOut: boolean;
    visible: boolean;
    sortOrder: number;
  }[];
  optionGroups: {
    category: string; // category the group applies to
    name: string;
    required: boolean;
    minPicks: number;
    maxPicks: number;
    options: { name: string; priceChange: number; sortOrder?: number; allergens?: string[] | null; allergensEnteredAt?: Date | string | null }[];
  }[];
};

/** Pure: turns flat rows into the Menu the site and pricing engine use. */
export function rowsToMenu(rows: MenuRows): Menu {
  const categories: MenuCategory[] = rows.categories
    .filter((c) => c.visible)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => {
      // The stored slug is stable across renames, so item ids (kept in customers'
      // baskets) do not change when an admin renames a category.
      const catSlug = c.slug ?? slugify(c.name);
      const items = rows.items
        .filter((i) => i.category === c.name && i.visible)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((i) => {
          const slug = i.slug ?? slugify(i.name);
          return {
            id: `${catSlug}-${slug}`,
            slug,
            category: c.name,
            name: i.name,
            description: i.description,
            price: i.price,
            allergens: normaliseEntry(i.allergens, i.allergensEnteredAt),
            dietaryTags: i.dietaryTags,
            soldOut: i.soldOut,
            visible: i.visible,
            photo: isBaseKey(i.photo) ? { key: i.photo, alt: i.photoAlt?.trim() || i.name } : null, // a malformed stored key shows no photo
          };
        });
      return { name: c.name, slug: catSlug, sortOrder: c.sortOrder, items };
    });

  const optionGroups: Record<string, MenuOptionGroup> = {};
  const visibleNames = new Set(categories.map((c) => c.name));
  for (const g of rows.optionGroups) {
    if (!visibleNames.has(g.category)) continue; // a hidden or unknown category's options are not part of the menu
    const groupId = slugify(g.name);
    optionGroups[g.category] = {
      id: groupId,
      name: g.name,
      required: g.required,
      minPicks: g.minPicks,
      maxPicks: g.maxPicks,
      options: [...g.options]
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((o) => ({
          id: `${groupId}-${slugify(o.name).slice(0, 24)}`,
          name: o.name,
          priceChange: o.priceChange,
          allergens: normaliseEntry(o.allergens, o.allergensEnteredAt),
        })),
    };
  }

  const all = categories.flatMap((c) => c.items);
  const popular = POPULAR.map((n) => all.find((i) => i.name === n)).filter((i): i is MenuItem => Boolean(i));

  return { categories, optionGroups, popular };
}

/** Rows equivalent to data/menu-seed.json: used by tests and by db:seed. */
export function seedRows(): MenuRows {
  return {
    categories: seed.categories.map((c) => ({ name: c.name, sortOrder: c.sort_order, visible: c.visible })),
    items: seed.items.map((i) => ({
      category: i.category,
      name: i.name,
      description: i.description,
      price: i.price,
      allergens: i.allergens,
      dietaryTags: i.dietary_tags,
      soldOut: i.sold_out,
      visible: i.visible,
      sortOrder: i.sort_order,
    })),
    optionGroups: seed.option_groups.flatMap((g) =>
      g.applies_to_categories.map((category) => ({
        category,
        name: g.name,
        required: g.required,
        minPicks: g.min_picks,
        maxPicks: g.max_picks,
        options: g.options.map((o, n) => ({ name: o.name, priceChange: o.price_change, sortOrder: n })),
      })),
    ),
  };
}

/** Menu straight from the seed file (tests, local fallback-free tooling). */
export function buildMenu(): Menu {
  return rowsToMenu(seedRows());
}
