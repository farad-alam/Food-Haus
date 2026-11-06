import { describe, expect, it } from "vitest";
import { itemSchema, optionGroupSchema, categorySchema, itemFlagsSchema, PRICE_MAX } from "@/lib/admin/menu-schema";
import { ALLERGENS } from "@/lib/menu-constants";

const item = { name: "Classic Burger", description: "Beef", price: 799, categoryId: 1, allergens: null, dietaryTags: [], soldOut: false, visible: true };

describe("item schema", () => {
  it("accepts a normal item, including 'allergens not supplied' (null) and 'none of the 14' ([])", () => {
    expect(itemSchema.safeParse(item).success).toBe(true);
    expect(itemSchema.safeParse({ ...item, allergens: [] }).success).toBe(true);
    expect(itemSchema.safeParse({ ...item, allergens: ["milk", "gluten"], dietaryTags: ["spicy"] }).success).toBe(true);
  });
  it("knows exactly the 14 UK allergens", () => {
    expect(ALLERGENS).toHaveLength(14);
    for (const a of ALLERGENS) expect(itemSchema.safeParse({ ...item, allergens: [a.key] }).success).toBe(true);
    for (const bad of ["dairy", "wheat", "MILK", "", "nuts "]) expect(itemSchema.safeParse({ ...item, allergens: [bad] }).success).toBe(false);
    expect(itemSchema.safeParse({ ...item, allergens: ["milk", "milk"] }).success).toBe(false);
  });
  it("rejects bad prices (zero, negative, fractional pence, silly highs)", () => {
    for (const price of [0, -1, 7.99, PRICE_MAX + 1, NaN, "799"]) expect(itemSchema.safeParse({ ...item, price }).success).toBe(false);
    expect(itemSchema.safeParse({ ...item, price: PRICE_MAX }).success).toBe(true);
  });
  it("rejects blank or symbol-only names, over-long text, unknown keys and tags", () => {
    for (const name of ["", "   ", "!!!", "x".repeat(101)]) expect(itemSchema.safeParse({ ...item, name }).success).toBe(false);
    expect(itemSchema.safeParse({ ...item, description: "x".repeat(601) }).success).toBe(false);
    expect(itemSchema.safeParse({ ...item, slug: "hack" }).success).toBe(false);
    expect(itemSchema.safeParse({ ...item, dietaryTags: ["gluten-free"] }).success).toBe(false); // safety claims are not tags
  });
  it("flags need at least one field", () => {
    expect(itemFlagsSchema.safeParse({}).success).toBe(false);
    expect(itemFlagsSchema.safeParse({ soldOut: true }).success).toBe(true);
    expect(itemFlagsSchema.safeParse({ price: 1 }).success).toBe(false);
  });
  it("category name rules", () => {
    expect(categorySchema.safeParse({ name: "Burgers" }).success).toBe(true);
    expect(categorySchema.safeParse({ name: "" }).success).toBe(false);
    expect(categorySchema.safeParse({ name: "x".repeat(61) }).success).toBe(false);
  });
});

describe("option group schema", () => {
  const group = { name: "Make it a Meal", required: false, minPicks: 0, maxPicks: 1, options: [{ name: "Meal", priceChange: 349, allergens: null }] };
  it("an option's allergen entry is required (it cannot be left out by accident) and validated like an item's", () => {
    const opt = (o: Record<string, unknown>) => optionGroupSchema.safeParse({ ...group, options: [{ name: "Meal", priceChange: 349, ...o }] }).success;
    expect(optionGroupSchema.safeParse({ ...group, options: [{ name: "Meal", priceChange: 349 }] }).success).toBe(false); // missing entirely
    expect(opt({ allergens: null })).toBe(true); // explicitly "not entered"
    expect(opt({ allergens: [] })).toBe(true); // explicitly "none"
    expect(opt({ allergens: ["milk", "gluten"] })).toBe(true);
    for (const bad of [["dairy"], ["milk", "milk"], "milk", undefined]) expect(opt({ allergens: bad })).toBe(false);
  });
  it("accepts a normal group", () => expect(optionGroupSchema.safeParse(group).success).toBe(true));
  it("rejects impossible pick counts", () => {
    expect(optionGroupSchema.safeParse({ ...group, maxPicks: 2 }).success).toBe(false); // more picks than options
    expect(optionGroupSchema.safeParse({ ...group, minPicks: 2, maxPicks: 1 }).success).toBe(false);
    expect(optionGroupSchema.safeParse({ ...group, maxPicks: 0 }).success).toBe(false);
  });
  it("rejects negative or fractional extras and empty option lists", () => {
    expect(optionGroupSchema.safeParse({ ...group, options: [{ name: "Meal", priceChange: -1, allergens: null }] }).success).toBe(false);
    expect(optionGroupSchema.safeParse({ ...group, options: [{ name: "Meal", priceChange: 3.5, allergens: null }] }).success).toBe(false);
    expect(optionGroupSchema.safeParse({ ...group, options: [] }).success).toBe(false);
  });
  it("rejects option names that collapse to the same id (first 24 letters/digits)", () => {
    const long = "Extra large cheese and bacon topping";
    expect(optionGroupSchema.safeParse({ ...group, maxPicks: 1, options: [{ name: `${long} one`, priceChange: 100, allergens: null }, { name: `${long} two`, priceChange: 100, allergens: null }] }).success).toBe(false);
    expect(optionGroupSchema.safeParse({ ...group, options: [{ name: "Cheese", priceChange: 100, allergens: null }, { name: "cheese!", priceChange: 100, allergens: null }] }).success).toBe(false);
    expect(optionGroupSchema.safeParse({ ...group, options: [{ name: "Cheese", priceChange: 100, allergens: null }, { name: "Bacon", priceChange: 150, allergens: null }] }).success).toBe(true);
  });
});
