import type { MenuOptionGroup } from "./menu-model";

// Option selection rules for the picker. They mirror priceOrder() in
// lib/pricing.ts exactly (a test checks the two agree), so the browser never
// offers a choice the server will refuse. The server remains the authority:
// a price shown here is a preview only.

export type PickerGroup = Pick<MenuOptionGroup, "id" | "name" | "required" | "minPicks" | "maxPicks" | "options">;

/** Fewest options a customer must pick ("required" means at least one). */
export const effectiveMin = (g: PickerGroup): number => (g.required ? Math.max(g.minPicks, 1) : g.minPicks);

/** Single choice shown as radio buttons; anything else as checkboxes. */
export const isSingleChoice = (g: PickerGroup): boolean => g.maxPicks === 1;

/** Selected ids in the group's own option order (stable names, stable line keys). */
export function inGroupOrder(g: PickerGroup, selected: string[]): string[] {
  return g.options.filter((o) => selected.includes(o.id)).map((o) => o.id);
}

/** Toggles one option. Single-choice replaces; multi-choice stops at the maximum. */
export function toggleOption(g: PickerGroup, selected: string[], id: string): string[] {
  if (!g.options.some((o) => o.id === id)) return selected;
  if (isSingleChoice(g)) return [id];
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  if (selected.length >= g.maxPicks) return selected;
  return inGroupOrder(g, [...selected, id]);
}

export function isValidSelection(g: PickerGroup, selected: string[]): boolean {
  if (new Set(selected).size !== selected.length) return false;
  if (!selected.every((id) => g.options.some((o) => o.id === id))) return false;
  return selected.length >= effectiveMin(g) && selected.length <= g.maxPicks;
}

/** Display-only unit price: base plus the chosen extras. */
export function unitPrice(base: number, g: PickerGroup | null, selected: string[]): number {
  if (!g) return base;
  return base + g.options.filter((o) => selected.includes(o.id)).reduce((n, o) => n + o.priceChange, 0);
}

export function optionNames(g: PickerGroup, selected: string[]): string[] {
  return g.options.filter((o) => selected.includes(o.id)).map((o) => o.name);
}

/** Plain-English rule shown above the options, e.g. "Choose up to 2". */
export function ruleText(g: PickerGroup): string {
  const min = effectiveMin(g);
  if (g.maxPicks === 1) return min === 1 ? "Choose 1" : "Choose 1 (optional)";
  if (min === g.maxPicks) return `Choose ${min}`;
  return min === 0 ? `Choose up to ${g.maxPicks} (optional)` : `Choose ${min} to ${g.maxPicks}`;
}
