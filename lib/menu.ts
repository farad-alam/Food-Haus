import { cacheLife, cacheTag } from "next/cache";
import seed from "@/data/menu-seed.json";

// Menu repository. Today it reads the seed file extracted from the print menu
// (sample data until the owner confirms it). When DATABASE_URL is wired up,
// only the body of loadMenu() changes — pages call getMenu() and never care.
//
// Cache: the menu is tagged "menu". Every admin write to menu, prices, offers
// or sold-out flags must call revalidateTag("menu", "max") so the public site
// refreshes within seconds (R6.3, R10.3, R9 acceptance).

export type MenuOption = { name: string; priceChange: number };
export type MenuOptionGroup = {
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

const POPULAR = ["Classic Burger", "Bane Beef Burger", "The CluckerStack", "Hot Honey Wings", "Chicken Loaded Fries", "Peri Peri Tenders"];

async function loadMenu(): Promise<Menu> {
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
    for (const cat of g.applies_to_categories) {
      optionGroups[cat] = {
        name: g.name,
        required: g.required,
        minPicks: g.min_picks,
        maxPicks: g.max_picks,
        options: g.options.map((o) => ({ name: o.name, priceChange: o.price_change })),
      };
    }
  }

  const all = categories.flatMap((c) => c.items);
  const popular = POPULAR.map((n) => all.find((i) => i.name === n)).filter(
    (i): i is MenuItem => Boolean(i),
  );

  return { categories, optionGroups, popular };
}

export async function getMenu(): Promise<Menu> {
  "use cache";
  cacheTag("menu");
  cacheLife("hours"); // refreshed on demand via revalidateTag; hours is the safety net
  return loadMenu();
}
