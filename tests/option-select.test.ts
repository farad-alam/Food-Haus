import { describe, expect, it } from "vitest";
import { effectiveMin, inGroupOrder, isSingleChoice, isValidSelection, optionNames, ruleText, toggleOption, unitPrice, type PickerGroup } from "@/lib/option-select";
import { priceOrder } from "@/lib/pricing";
import type { Menu, MenuOptionGroup } from "@/lib/menu-model";

const opts = [
  { id: "cheese", name: "Cheese", priceChange: 100, allergens: null },
  { id: "bacon", name: "Bacon", priceChange: 150, allergens: null },
  { id: "onion", name: "Onion", priceChange: 0, allergens: null },
];
const g = (over: Partial<PickerGroup> = {}): PickerGroup => ({ id: "t", name: "Toppings", required: false, minPicks: 0, maxPicks: 1, options: opts, ...over });

describe("rules", () => {
  it("required means at least one; single choice is radios", () => {
    expect(effectiveMin(g({ required: true, minPicks: 0 }))).toBe(1);
    expect(effectiveMin(g({ required: false, minPicks: 0 }))).toBe(0);
    expect(effectiveMin(g({ required: true, minPicks: 2, maxPicks: 3 }))).toBe(2);
    expect(isSingleChoice(g())).toBe(true);
    expect(isSingleChoice(g({ maxPicks: 2 }))).toBe(false);
  });
  it("single choice replaces; multi choice toggles and stops at the maximum", () => {
    expect(toggleOption(g(), ["cheese"], "bacon")).toEqual(["bacon"]);
    const multi = g({ maxPicks: 2 });
    let sel = toggleOption(multi, [], "bacon");
    sel = toggleOption(multi, sel, "cheese");
    expect(sel).toEqual(["cheese", "bacon"]); // always in the group's own order
    expect(toggleOption(multi, sel, "onion")).toEqual(sel); // at max: ignored
    expect(toggleOption(multi, sel, "bacon")).toEqual(["cheese"]); // untick
    expect(toggleOption(multi, [], "nope")).toEqual([]); // unknown id ignored
  });
  it("prices and names follow the selection", () => {
    expect(unitPrice(800, g({ maxPicks: 2 }), ["cheese", "bacon"])).toBe(1050);
    expect(unitPrice(800, null, [])).toBe(800);
    expect(optionNames(g({ maxPicks: 3 }), ["onion", "cheese"])).toEqual(["Cheese", "Onion"]);
    expect(inGroupOrder(g({ maxPicks: 3 }), ["onion", "cheese"])).toEqual(["cheese", "onion"]);
  });
  it("explains the rule in plain English", () => {
    expect(ruleText(g())).toBe("Choose 1 (optional)");
    expect(ruleText(g({ required: true }))).toBe("Choose 1");
    expect(ruleText(g({ maxPicks: 3 }))).toBe("Choose up to 3 (optional)");
    expect(ruleText(g({ required: true, maxPicks: 3 }))).toBe("Choose 1 to 3");
    expect(ruleText(g({ minPicks: 2, maxPicks: 2 }))).toBe("Choose 2");
  });
});

// The browser must never offer what the server refuses, and must never block what the server accepts.
describe("parity with the server's pricing engine", () => {
  const subsets = (ids: string[]): string[][] => ids.reduce<string[][]>((acc, id) => [...acc, ...acc.map((s) => [...s, id])], [[]]);
  const groups: Partial<PickerGroup>[] = [
    { required: false, minPicks: 0, maxPicks: 1 },
    { required: true, minPicks: 0, maxPicks: 1 },
    { required: false, minPicks: 0, maxPicks: 2 },
    { required: true, minPicks: 0, maxPicks: 2 },
    { required: false, minPicks: 2, maxPicks: 3 },
    { required: true, minPicks: 2, maxPicks: 2 },
    { required: false, minPicks: 0, maxPicks: 3 },
  ];
  for (const over of groups) {
    it(`every selection agrees: ${JSON.stringify(over)}`, () => {
      const group = g(over);
      const menu: Menu = {
        categories: [{ name: "Cat", slug: "cat", sortOrder: 1, items: [{ id: "cat-item", slug: "item", category: "Cat", name: "Item", description: "", price: 800, allergens: [], dietaryTags: [], soldOut: false, visible: true }] }],
        optionGroups: { Cat: group as MenuOptionGroup },
        popular: [],
      };
      // include orderings and duplicates the UI could never produce, to be sure the server's view matches ours
      for (const sel of subsets(opts.map((o) => o.id))) {
        const server = priceOrder({ menu, zones: [], offers: [], items: [{ itemId: "cat-item", quantity: 1, optionIds: sel }], orderType: "collection", paymentMethod: "cash", now: new Date() });
        expect([JSON.stringify(sel), isValidSelection(group, sel)]).toEqual([JSON.stringify(sel), server.ok]);
        if (server.ok) expect(server.total).toBe(unitPrice(800, group, sel)); // displayed price equals the charged price
      }
    });
  }
  it("rejects duplicates and unknown ids like the server does", () => {
    expect(isValidSelection(g({ maxPicks: 2 }), ["cheese", "cheese"])).toBe(false);
    expect(isValidSelection(g(), ["nope"])).toBe(false);
  });
});
