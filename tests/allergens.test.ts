import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allergenReadiness, claimText, itemClaim, itemComplete, normaliseEntry, optionClaim, optionText } from "@/lib/allergens";
import { readinessFromMenu } from "@/lib/allergen-readiness";
import { ALLERGEN_KEYS } from "@/lib/menu-constants";
import { rowsToMenu, seedRows, type MenuRows } from "@/lib/menu-model";

const T = new Date("2026-11-06T10:00:00Z");

describe("what counts as ENTERED", () => {
  it("nothing is entered without the provenance timestamp, whatever the stored list says", () => {
    for (const stored of [null, [], ["milk"], undefined]) expect(normaliseEntry(stored, null)).toBeNull();
    expect(normaliseEntry([], undefined)).toBeNull();
    expect(normaliseEntry(["milk"], "")).toBeNull();
  });
  it("an explicit empty list is 'none', and a list is put in the legal order", () => {
    expect(normaliseEntry([], T)).toEqual([]);
    expect(normaliseEntry(["sesame", "milk", "celery"], T)).toEqual(["celery", "milk", "sesame"]);
  });
  it("anything malformed is 'not entered', never partly trusted", () => {
    for (const bad of ["milk", {}, 5, ["dairy"], ["milk", "milk"], ["milk", 3], [null]]) expect([bad, normaliseEntry(bad, T)]).toEqual([bad, null]);
  });
  it("accepts exactly the 14 keys", () => {
    expect(ALLERGEN_KEYS).toHaveLength(14);
    expect(normaliseEntry([...ALLERGEN_KEYS], T)).toHaveLength(14);
  });
});

describe("what may be CLAIMED about an item", () => {
  it("an item with no data says nothing, whatever its options hold", () => {
    expect(itemClaim(null)).toEqual({ kind: "unknown" });
    expect(itemClaim(null, [[], ["milk"], null])).toEqual({ kind: "unknown" });
  });
  it("'none' needs the item AND every option entered, with nothing in any of them", () => {
    expect(itemClaim([])).toEqual({ kind: "none" });
    expect(itemClaim([], [[], []])).toEqual({ kind: "none" });
    expect(itemClaim([], [[], null]).kind).not.toBe("none"); // an unconfirmed option blocks "none"
    expect(itemClaim([], [["milk"]]).kind).not.toBe("none"); // an option adds an allergen
  });
  it("states the item's own allergens and flags unconfirmed options", () => {
    expect(itemClaim(["gluten"], [null])).toEqual({ kind: "contains", keys: ["gluten"], optionsUnconfirmed: true });
    expect(itemClaim(["gluten"], [[]])).toEqual({ kind: "contains", keys: ["gluten"], optionsUnconfirmed: false });
  });
  it("complete means item and options are all entered", () => {
    expect(itemComplete(null)).toBe(false);
    expect(itemComplete([], [null])).toBe(false);
    expect(itemComplete([], [[], ["milk"]])).toBe(true);
  });
  it("the words: unknown is a request to ask, never a claim", () => {
    const u = claimText({ kind: "unknown" }, true);
    expect(u.ask).toBe(true);
    expect(u.text).not.toMatch(/contains|no major|none|free/i);
    expect(claimText({ kind: "none" }, false)).toEqual({ text: "No major allergens declared.", ask: false });
    expect(claimText({ kind: "contains", keys: ["milk", "nuts"], optionsUnconfirmed: false }, false).text).toBe("Contains: Milk, Tree nuts.");
    const w = claimText({ kind: "contains", keys: [], optionsUnconfirmed: true }, true);
    expect(w.ask).toBe(true);
    expect(w.text).not.toMatch(/^no major/i);
    expect(optionText(optionClaim(null)).ask).toBe(true);
    expect(optionText(optionClaim(null)).text).not.toMatch(/contains|no major/i);
  });
  it("EVERY combination: any text that says 'none' implies item and options were all entered as empty", () => {
    const entries = [null, [], ["milk"]] as const;
    for (const own of entries) for (const a of entries) for (const b of entries) {
      const text = claimText(itemClaim(own as string[] | null, [a as string[] | null, b as string[] | null]), true).text;
      if (/^No major allergens declared/.test(text)) expect([own, a, b]).toEqual([[], [], []]);
      if (own === null) expect(text).toMatch(/not available/);
    }
  });
});

describe("the menu model never invents an entry", () => {
  const rows: MenuRows = {
    categories: [{ name: "Burgers", sortOrder: 1, visible: true }],
    items: [
      { category: "Burgers", name: "A", description: "", price: 100, allergens: [], dietaryTags: [], soldOut: false, visible: true, sortOrder: 1 }, // list but no timestamp
      { category: "Burgers", name: "B", description: "", price: 100, allergens: ["milk"], allergensEnteredAt: T, dietaryTags: [], soldOut: false, visible: true, sortOrder: 2 },
      { category: "Burgers", name: "C", description: "", price: 100, allergens: null, allergensEnteredAt: T, dietaryTags: [], soldOut: false, visible: true, sortOrder: 3 },
    ],
    optionGroups: [{ category: "Burgers", name: "Meal", required: false, minPicks: 0, maxPicks: 1, options: [{ name: "Fries", priceChange: 100, allergens: [] }, { name: "Drink", priceChange: 50, allergens: [], allergensEnteredAt: T }] }],
  };
  it("a list without a timestamp is not entered; with one it is", () => {
    const m = rowsToMenu(rows);
    expect(m.categories[0].items.map((i) => i.allergens)).toEqual([null, ["milk"], null]);
    expect(m.optionGroups.Burgers.options.map((o) => o.allergens)).toEqual([null, []]);
  });
  it("the shipped seed menu has no allergen data at all, and nothing is ready", () => {
    const menu = rowsToMenu(seedRows());
    const all = menu.categories.flatMap((c) => c.items);
    expect(all.length).toBeGreaterThan(30);
    expect(all.every((i) => i.allergens === null)).toBe(true);
    expect(Object.values(menu.optionGroups).flatMap((g) => g.options).every((o) => o.allergens === null)).toBe(true);
    expect(readinessFromMenu(menu).ready).toBe(false);
  });
});

describe("readiness (the go-live gate)", () => {
  const item = (name: string, allergens: string[] | null) => ({ name, category: "C", allergens });
  it("lists exactly what is missing", () => {
    const r = allergenReadiness({ items: [item("A", []), item("B", null), item("C", ["milk"])], options: { C: [{ name: "Meal", allergens: null }, { name: "Cheese", allergens: ["milk"] }] } });
    expect(r.ready).toBe(false);
    expect(r.itemsMissing).toEqual([{ name: "B", category: "C" }]);
    expect(r.optionsMissing).toEqual([{ category: "C", name: "Meal" }]);
  });
  it("is ready only with everything entered, and never for an empty menu", () => {
    expect(allergenReadiness({ items: [item("A", []), item("B", ["fish"])], options: { C: [{ name: "Meal", allergens: [] }] } }).ready).toBe(true);
    expect(allergenReadiness({ items: [], options: {} }).ready).toBe(false);
  });
});

describe("source guard: no allergen claim is written anywhere else", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
  const files = ["app", "components"].flatMap((d) => walk(d)).filter((f) => /\.(tsx|ts)$/.test(f) && !f.startsWith(join("components", "admin")));
  it("public code never hard-codes 'no allergens' or 'free from' wording (only lib/allergens.ts decides)", () => {
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect([f, /no major allergens|allergen[- ]free|gluten[- ]free|nut[- ]free|dairy[- ]free|free from/i.test(text)]).toEqual([f, false]);
    }
  });
});
