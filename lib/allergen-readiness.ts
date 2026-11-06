import { allergenReadiness, type Readiness } from "./allergens";
import type { Menu } from "./menu-model";

/** Readiness of the whole visible menu: every item AND every option a customer can add. */
export function readinessFromMenu(menu: Menu): Readiness {
  return allergenReadiness({
    items: menu.categories.flatMap((c) => c.items.map((i) => ({ name: i.name, category: c.name, allergens: i.allergens }))),
    options: Object.fromEntries(Object.entries(menu.optionGroups).map(([cat, g]) => [cat, g.options.map((o) => ({ name: o.name, allergens: o.allergens }))])),
  });
}
