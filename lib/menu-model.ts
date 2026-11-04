import seed from "@/data/menu-seed.json";

// Pure menu model: types and the builder. No Next.js imports, so the pricing
// engine and its tests can use it directly. The cached accessor lives in
// lib/menu.ts.

export type MenuOption = { id: string; name: string; priceChange: number };
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
  /** null = allergen data NOT supplied yet (launch blocker, R11.10). */
  allergens: string[] | null;
  dietaryTags: string[];
  soldOut: boolean;
  visible: boolean;
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
  categories: { name: string; sortOrder: number; visible: boolean }[];
  items: {
    category: string;
    name: string;
    slug?: string;
    description: string;
    price: number;
    allergens: string[] | null;
    dietaryTags: string[];
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
    options: { name: string; priceChange: number; sortOrder?: number }[];
  }[];
};

/** Pure: turns flat rows into the Menu the site and pricing engine use. */
export function rowsToMenu(rows: MenuRows): Menu {
  const categories: MenuCategory[] = rows.categories
    .filter((c) => c.visible)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({
      name: c.name,
      slug: slugify(c.name),
      sortOrder: c.sortOrder,
      items: rows.items
        .filter((i) => i.category === c.name && i.visible)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((i) => {
          const slug = i.slug ?? slugify(i.name);
          return {
            id: `${slugify(c.name)}-${slug}`,
            slug,
            category: c.name,
            name: i.name,
            description: i.description,
            price: i.price,
            allergens: i.allergens,
            dietaryTags: i.dietaryTags,
            soldOut: i.soldOut,
            visible: i.visible,
          };
        }),
    }));

  const optionGroups: Record<string, MenuOptionGroup> = {};
  for (const g of rows.optionGroups) {
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
