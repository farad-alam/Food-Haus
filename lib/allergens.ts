import { ALLERGEN_KEYS, ALLERGENS } from "./menu-constants";

// Allergen data is SAFETY-CRITICAL. The rules in this file are the only place that decides
// what may be said about an item, and they are deliberately strict:
//
//  1. "Not yet entered" is its own state (null). It is never read as "none".
//  2. A list counts as ENTERED only when it was explicitly saved by a person: the stored value is
//     a valid list AND it carries an `enteredAt` timestamp (the database also enforces this pair).
//     Anything else, including a stray empty list or a list with an unknown key, is NOT entered.
//  3. An item has a complete claim only when the item AND every option a customer could add to
//     it are entered. Options (for example "Make it a Meal") can add allergens, so an item
//     whose options are unconfirmed can never be described as "contains none".
//  4. Nothing is ever inferred from an item's name, description, category or another item.
//
// The public pages render ONLY what itemClaim()/optionClaim() return.

export type AllergenEntry = string[] | null; // null = not yet entered

const KEYS = new Set<string>(ALLERGEN_KEYS);

/**
 * Turns whatever is stored into a trustworthy entry, or null. `enteredAt` is the provenance
 * timestamp: no timestamp means nobody explicitly entered this, so it is null.
 */
export function normaliseEntry(stored: unknown, enteredAt: Date | string | null | undefined): AllergenEntry {
  if (!enteredAt) return null;
  if (!Array.isArray(stored)) return null;
  if (!stored.every((k) => typeof k === "string" && KEYS.has(k))) return null;
  if (new Set(stored).size !== stored.length) return null;
  return ALLERGEN_KEYS.filter((k) => stored.includes(k)); // fixed, legal order
}

export const allergenLabel = (key: string) => ALLERGENS.find((a) => a.key === key)?.label ?? key;

/** What may be said about one option. */
export type OptionClaim = { kind: "unknown" } | { kind: "contains"; keys: string[] } | { kind: "none" };
export function optionClaim(entry: AllergenEntry): OptionClaim {
  if (entry === null) return { kind: "unknown" };
  return entry.length ? { kind: "contains", keys: entry } : { kind: "none" };
}

/**
 * What may be said about one item.
 *  - unknown:  nothing. The item's own data is missing.
 *  - contains: the item's own allergens (always safe to state), plus `optionsUnconfirmed` when at
 *              least one option's data is missing, and `optionKeys` for allergens options add.
 *  - none:     only when the item AND every option are entered, and none of them has an allergen.
 */
export type ItemClaim =
  | { kind: "unknown" }
  | { kind: "contains"; keys: string[]; optionsUnconfirmed: boolean }
  | { kind: "none" };

export function itemClaim(own: AllergenEntry, options: AllergenEntry[] = []): ItemClaim {
  if (own === null) return { kind: "unknown" };
  const optionsUnconfirmed = options.some((o) => o === null);
  if (own.length === 0 && !optionsUnconfirmed) {
    // "none" for the item itself; options are all entered, so say so only if they add nothing either.
    return options.every((o) => o !== null && o.length === 0) ? { kind: "none" } : { kind: "contains", keys: [], optionsUnconfirmed: false };
  }
  return { kind: "contains", keys: own, optionsUnconfirmed };
}

/** True when everything a customer could be told about this item has been entered. */
export const itemComplete = (own: AllergenEntry, options: AllergenEntry[] = []) => own !== null && options.every((o) => o !== null);

// ---- readiness (the go-live gate) ----------------------------------------------------------

export type ReadinessInput = {
  items: { name: string; category: string; allergens: AllergenEntry }[];
  /** Options keyed by category name: the group's options apply to every item in the category. */
  options: Record<string, { name: string; allergens: AllergenEntry }[]>;
};
export type Readiness = {
  ready: boolean;
  itemsTotal: number;
  itemsMissing: { name: string; category: string }[];
  optionsMissing: { category: string; name: string }[];
};

/** Which items and options are still missing data. `ready` only when there is nothing missing AND there is a menu. */
export function allergenReadiness(input: ReadinessInput): Readiness {
  const itemsMissing = input.items.filter((i) => i.allergens === null).map((i) => ({ name: i.name, category: i.category }));
  const optionsMissing = Object.entries(input.options).flatMap(([category, opts]) => opts.filter((o) => o.allergens === null).map((o) => ({ category, name: o.name })));
  return { ready: input.items.length > 0 && itemsMissing.length === 0 && optionsMissing.length === 0, itemsTotal: input.items.length, itemsMissing, optionsMissing };
}

// ---- the words ---------------------------------------------------------------------------------

/**
 * The one place that turns a claim into a sentence for the menu cards. `ask` means the reader
 * should be told to call before ordering.
 */
export function claimText(claim: ItemClaim, hasOptions: boolean): { text: string; ask: boolean } {
  if (claim.kind === "unknown") return { text: "Allergen information is not available for this item yet. Please ask before ordering.", ask: true };
  if (claim.kind === "none") return { text: "No major allergens declared.", ask: false };
  const own = claim.keys.length ? `Contains: ${claim.keys.map(allergenLabel).join(", ")}.` : "The item itself declares no major allergens.";
  if (claim.optionsUnconfirmed) return { text: `${own} Allergens for some options are not confirmed yet. Please ask before ordering.`, ask: true };
  return { text: hasOptions ? `${own} Options can add allergens: see the allergen information.` : own, ask: false };
}

export function optionText(claim: OptionClaim): { text: string; ask: boolean } {
  if (claim.kind === "unknown") return { text: "Allergens not confirmed yet. Please ask.", ask: true };
  if (claim.kind === "none") return { text: "No major allergens declared.", ask: false };
  return { text: `Contains: ${claim.keys.map(allergenLabel).join(", ")}.`, ask: false };
}

// ---- the grid (R11.10): one cell per item and allergen -------------------------------------------

/**
 *  yes         the item itself contains it
 *  via-option  the item does not, but an option a customer can add does
 *  no          the item AND every option are entered and none contains it
 *  unknown     anything else: nothing may be said (the item or an option is not entered)
 */
export type GridCell = "yes" | "via-option" | "no" | "unknown";
export function gridCell(key: string, own: AllergenEntry, options: AllergenEntry[] = []): GridCell {
  if (own === null) return "unknown";
  if (own.includes(key)) return "yes";
  if (options.some((o) => o === null)) return "unknown";
  return options.some((o) => o!.includes(key)) ? "via-option" : "no";
}
