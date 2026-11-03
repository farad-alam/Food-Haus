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

export function buildMenu(): Menu {
  const categories: MenuCategory[] = seed.categories
    .filter((c) => c.visible)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => ({
      name: c.name,
      slug: slugify(c.name),
      sortOrder: c.sort_order,
      items: seed.items
        .filter((i) => i.category === c.name && i.visible)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((i) => ({
          id: `${slugify(c.name)}-${slugify(i.name)}`,
          slug: slugify(i.name),
          category: c.name,
          name: i.name,
          description: i.description,
          price: i.price,
          allergens: i.allergens,
          dietaryTags: i.dietary_tags,
          soldOut: i.sold_out,
          visible: i.visible,
        })),
    }));

  const optionGroups: Record<string, MenuOptionGroup> = {};
  for (const g of seed.option_groups) {
    const groupId = slugify(g.name);
    for (const cat of g.applies_to_categories) {
      optionGroups[cat] = {
        id: groupId,
        name: g.name,
        required: g.required,
        minPicks: g.min_picks,
        maxPicks: g.max_picks,
        options: g.options.map((o) => ({
          id: `${groupId}-${slugify(o.name).slice(0, 24)}`,
          name: o.name,
          priceChange: o.price_change,
        })),
      };
    }
  }

  const all = categories.flatMap((c) => c.items);
  const popular = POPULAR.map((n) => all.find((i) => i.name === n)).filter(
    (i): i is MenuItem => Boolean(i),
  );

  return { categories, optionGroups, popular };
}
