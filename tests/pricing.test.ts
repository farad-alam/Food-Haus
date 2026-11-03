import { describe, expect, it } from "vitest";
import { buildMenu } from "@/lib/menu-model";
import {
  MAX_LINES,
  parsePostcode,
  priceOrder,
  type OfferRule,
  type PricingInput,
  type Zone,
} from "@/lib/pricing";

const menu = buildMenu();
const NOW = new Date("2026-11-10T18:00:00Z");

const zones: Zone[] = [
  { district: "LU4", fee: 200, minOrder: 1000, estimatedMinutes: 35, active: true },
  { district: "LU3", fee: 300, minOrder: 1500, estimatedMinutes: 45, active: true },
  { district: "LU1", fee: 400, minOrder: 1500, estimatedMinutes: 50, active: false },
];

const wingsBogof: OfferRule = {
  id: "bogof-wings",
  name: "Buy 1 Get 1 Free on wings",
  type: "bogof",
  appliesToCategory: "Wings",
  channel: "collection",
  minSpend: 0,
  usedCount: 0,
};

const CLASSIC = "burgers-classic-burger"; // 799
const CHEESE = "burgers-cheese-burger"; // 599
const BBQ_WINGS = "wings-bbq-wings"; // 799
const mealOption = menu.optionGroups["Burgers"].options[0];

function base(over: Partial<PricingInput> = {}): PricingInput {
  return {
    menu,
    zones,
    offers: [],
    items: [{ itemId: CLASSIC, quantity: 1 }],
    orderType: "collection",
    paymentMethod: "card",
    now: NOW,
    ...over,
  };
}

function codes(r: ReturnType<typeof priceOrder>): string[] {
  return r.ok ? [] : r.errors.map((e) => e.code);
}

describe("basic pricing", () => {
  it("prices from the server-side menu, in whole pence", () => {
    const r = priceOrder(base({ items: [{ itemId: CLASSIC, quantity: 2 }, { itemId: CHEESE, quantity: 1 }] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.subtotal).toBe(799 * 2 + 599);
    expect(r.total).toBe(799 * 2 + 599);
    expect(r.lines[0]).toMatchObject({ name: "Classic Burger", unitPrice: 799, quantity: 2, lineTotal: 1598 });
    expect(Number.isInteger(r.total)).toBe(true);
  });

  it("Make it a Meal adds £3.49 to the line", () => {
    const r = priceOrder(base({ items: [{ itemId: CLASSIC, quantity: 1, optionIds: [mealOption.id] }] }));
    expect(r.ok && r.subtotal).toBe(799 + 349);
  });

  it("rejects an empty basket and an oversized one", () => {
    expect(codes(priceOrder(base({ items: [] })))).toEqual(["EMPTY_BASKET"]);
    const many = Array.from({ length: MAX_LINES + 1 }, () => ({ itemId: CLASSIC, quantity: 1 }));
    expect(codes(priceOrder(base({ items: many })))).toEqual(["TOO_MANY_LINES"]);
  });
});

describe("tampering and bad input", () => {
  it("rejects unknown items", () => {
    expect(codes(priceOrder(base({ items: [{ itemId: "burgers-free-burger", quantity: 1 }] })))).toEqual(["UNKNOWN_ITEM"]);
  });

  it.each([0, -1, 21, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects quantity %s", (q) => {
    expect(codes(priceOrder(base({ items: [{ itemId: CLASSIC, quantity: q }] })))).toEqual(["BAD_QUANTITY"]);
  });

  it("rejects sold-out and hidden items", () => {
    const m = structuredClone(menu);
    m.categories[0].items[0].soldOut = true; // Classic Burger
    m.categories[0].items[1].visible = false; // Fino Burger
    expect(codes(priceOrder(base({ menu: m })))).toEqual(["SOLD_OUT"]);
    expect(codes(priceOrder(base({ menu: m, items: [{ itemId: "burgers-fino-burger", quantity: 1 }] })))).toEqual(["UNKNOWN_ITEM"]);
  });

  it("rejects unknown, duplicate and misplaced options", () => {
    expect(codes(priceOrder(base({ items: [{ itemId: CLASSIC, quantity: 1, optionIds: ["free-meal"] }] })))).toEqual(["BAD_OPTION"]);
    expect(codes(priceOrder(base({ items: [{ itemId: CLASSIC, quantity: 1, optionIds: [mealOption.id, mealOption.id] }] })))).toEqual(["BAD_OPTION"]);
    // Wings have no option group, so the meal option must not attach to them.
    expect(codes(priceOrder(base({ items: [{ itemId: BBQ_WINGS, quantity: 1, optionIds: [mealOption.id] }] })))).toEqual(["BAD_OPTION"]);
  });

  it("enforces required option groups and pick limits", () => {
    const m = structuredClone(menu);
    m.optionGroups["Burgers"].required = true;
    expect(codes(priceOrder(base({ menu: m })))).toEqual(["OPTION_COUNT"]);
    expect(priceOrder(base({ menu: m, items: [{ itemId: CLASSIC, quantity: 1, optionIds: [mealOption.id] }] })).ok).toBe(true);
  });
});

describe("delivery", () => {
  const delivery = (over: Partial<PricingInput> = {}) =>
    base({ orderType: "delivery", items: [{ itemId: CLASSIC, quantity: 2 }], ...over });

  it("adds the zone fee and returns the estimate", () => {
    const r = priceOrder(delivery({ postcode: "lu4 8nu" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deliveryFee).toBe(200);
    expect(r.total).toBe(1598 + 200);
    expect(r.estimatedMinutes).toBe(35);
  });

  it("requires a valid postcode inside an active zone", () => {
    expect(codes(priceOrder(delivery()))).toEqual(["POSTCODE_REQUIRED"]);
    expect(codes(priceOrder(delivery({ postcode: "  " })))).toEqual(["POSTCODE_REQUIRED"]);
    expect(codes(priceOrder(delivery({ postcode: "hello" })))).toEqual(["POSTCODE_INVALID"]);
    expect(codes(priceOrder(delivery({ postcode: "SW1A 1AA" })))).toEqual(["OUTSIDE_ZONE"]);
    expect(codes(priceOrder(delivery({ postcode: "LU1 2AB" })))).toEqual(["OUTSIDE_ZONE"]); // inactive zone
  });

  it("enforces the zone's minimum order", () => {
    expect(codes(priceOrder(delivery({ postcode: "LU3 1AA", items: [{ itemId: CLASSIC, quantity: 1 }] })))).toEqual(["BELOW_MIN_ORDER"]);
  });

  it("collection ignores postcode and charges no fee", () => {
    const r = priceOrder(base({ postcode: "garbage" }));
    expect(r.ok && r.deliveryFee).toBe(0);
  });
});

describe("postcode parsing", () => {
  it.each([
    ["LU4 8NU", "LU4"],
    ["lu48nu", "LU4"],
    [" SW1A 1AA ", "SW1A"],
    ["M1 1AE", "M1"],
    ["EC1A 1BB", "EC1A"],
  ])("%s → %s", (input, outward) => {
    expect(parsePostcode(input)?.outward).toBe(outward);
  });
  it.each(["", "LU4", "12345", "LU4 8N", "LU4 8NUU", "LU4; DROP TABLE"])("rejects %j", (input) => {
    expect(parsePostcode(input)).toBeNull();
  });
});

describe("offers", () => {
  const wings = (quantity: number, over: Partial<PricingInput> = {}) =>
    base({ items: [{ itemId: BBQ_WINGS, quantity }], offers: [wingsBogof], ...over });

  it("BOGOF on wings: one free per pair, collection", () => {
    expect(priceOrder(wings(1))).toMatchObject({ ok: true, discount: 0, total: 799 });
    expect(priceOrder(wings(2))).toMatchObject({ ok: true, discount: 799, total: 799 });
    expect(priceOrder(wings(3))).toMatchObject({ ok: true, discount: 799, total: 1598 });
    expect(priceOrder(wings(4))).toMatchObject({ ok: true, discount: 1598, total: 1598 });
  });

  it("BOGOF frees the cheaper unit and only counts the offer's category", () => {
    const m = structuredClone(menu);
    const wingsCat = m.categories.find((c) => c.name === "Wings")!;
    wingsCat.items[1].price = 599; // a cheaper wing
    const r = priceOrder(
      base({
        menu: m,
        offers: [wingsBogof],
        items: [
          { itemId: wingsCat.items[0].id, quantity: 1 }, // 799
          { itemId: wingsCat.items[1].id, quantity: 1 }, // 599
          { itemId: CLASSIC, quantity: 2 }, // not wings: ignored
        ],
      }),
    );
    expect(r.ok && r.discount).toBe(599);
  });

  it("collection-only BOGOF does not apply to a delivery order", () => {
    const r = priceOrder(wings(2, { orderType: "delivery", postcode: "LU4 8NU" }));
    expect(r).toMatchObject({ ok: true, discount: 0, appliedOffer: null });
  });

  const pct10: OfferRule = { id: 1, name: "10% off", type: "percentage", value: 10, channel: "any", code: "TEN", minSpend: 1000, usedCount: 0 };

  it("promo codes are case-insensitive and trimmed", () => {
    const r = priceOrder(base({ offers: [pct10], promoCode: "  ten ", items: [{ itemId: CLASSIC, quantity: 2 }] }));
    expect(r).toMatchObject({ ok: true, discount: 159, total: 1598 - 159, appliedOffer: { id: 1 } });
  });

  it("an invalid code is an error, never silently ignored", () => {
    expect(codes(priceOrder(base({ offers: [pct10], promoCode: "NOPE" })))).toEqual(["PROMO_INVALID"]);
  });

  it("enforces minimum spend, dates and usage limits", () => {
    expect(codes(priceOrder(base({ offers: [pct10], promoCode: "TEN" })))).toEqual(["PROMO_MIN_SPEND"]);
    const two = { items: [{ itemId: CLASSIC, quantity: 2 }], promoCode: "TEN" };
    expect(codes(priceOrder(base({ ...two, offers: [{ ...pct10, endsAt: new Date("2026-11-01") }] })))).toEqual(["PROMO_EXPIRED"]);
    expect(codes(priceOrder(base({ ...two, offers: [{ ...pct10, startsAt: new Date("2026-12-01") }] })))).toEqual(["PROMO_NOT_STARTED"]);
    expect(codes(priceOrder(base({ ...two, offers: [{ ...pct10, usageLimit: 5, usedCount: 5 }] })))).toEqual(["PROMO_USED_UP"]);
  });

  it("fixed discounts can never exceed the subtotal", () => {
    const big: OfferRule = { id: 2, name: "£50 off", type: "fixed", value: 5000, channel: "any", code: "BIG", minSpend: 0, usedCount: 0 };
    const r = priceOrder(base({ offers: [big], promoCode: "BIG", items: [{ itemId: CHEESE, quantity: 1 }] }));
    expect(r).toMatchObject({ ok: true, discount: 599, total: 0 });
  });

  it("free delivery removes the fee on delivery and is not applicable to collection", () => {
    const fd: OfferRule = { id: 3, name: "Free delivery", type: "free_delivery", channel: "any", code: "FREEDEL", minSpend: 0, usedCount: 0 };
    const d = priceOrder(base({ offers: [fd], promoCode: "FREEDEL", orderType: "delivery", postcode: "LU4 8NU", items: [{ itemId: CLASSIC, quantity: 2 }] }));
    expect(d).toMatchObject({ ok: true, deliveryFee: 200, discount: 200, total: 1598 });
    expect(codes(priceOrder(base({ offers: [fd], promoCode: "FREEDEL" })))).toEqual(["PROMO_NOT_APPLICABLE"]);
  });

  it("only the single best automatic offer applies — offers never stack", () => {
    const auto10: OfferRule = { id: 4, name: "auto 10%", type: "percentage", value: 10, channel: "any", minSpend: 0, usedCount: 0 };
    const auto50p: OfferRule = { id: 5, name: "50p off", type: "fixed", value: 50, channel: "any", minSpend: 0, usedCount: 0 };
    const r = priceOrder(base({ offers: [auto50p, auto10], items: [{ itemId: CLASSIC, quantity: 2 }] }));
    expect(r.ok && r.discount).toBe(159);
    expect(r.ok && r.appliedOffer?.id).toBe(4);
  });

  it("a coded offer is never applied automatically", () => {
    const r = priceOrder(base({ offers: [pct10], items: [{ itemId: CLASSIC, quantity: 2 }] }));
    expect(r).toMatchObject({ ok: true, discount: 0 });
  });
});

describe("cash cap (R6.10)", () => {
  it("rejects cash orders over the cap but lets card through", () => {
    const items = [{ itemId: CLASSIC, quantity: 5 }]; // 3995
    expect(codes(priceOrder(base({ items, paymentMethod: "cash", cashMaxPence: 3000 })))).toEqual(["CASH_OVER_CAP"]);
    expect(priceOrder(base({ items, paymentMethod: "card", cashMaxPence: 3000 })).ok).toBe(true);
    expect(priceOrder(base({ items, paymentMethod: "cash", cashMaxPence: null })).ok).toBe(true);
  });
});

describe("invariants over random baskets", () => {
  it("total is a non-negative integer and equals subtotal + fee - discount", () => {
    const ids = menu.categories.flatMap((c) => c.items.map((i) => i.id));
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const offers: OfferRule[] = [
      wingsBogof,
      { id: "p", name: "p", type: "percentage", value: 37, channel: "any", minSpend: 0, usedCount: 0 },
      { id: "f", name: "f", type: "fixed", value: 9999, channel: "any", code: "F", minSpend: 0, usedCount: 0 },
    ];
    for (let n = 0; n < 500; n++) {
      const items = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => ({
        itemId: ids[Math.floor(rnd() * ids.length)],
        quantity: 1 + Math.floor(rnd() * 20),
      }));
      const delivery = rnd() < 0.5;
      const r = priceOrder(
        base({
          items,
          offers,
          promoCode: rnd() < 0.3 ? "F" : undefined,
          orderType: delivery ? "delivery" : "collection",
          postcode: delivery ? "LU4 8NU" : undefined,
        }),
      );
      if (!r.ok) continue; // e.g. below minimum order — fine
      expect(Number.isInteger(r.total)).toBe(true);
      expect(r.total).toBeGreaterThanOrEqual(0);
      expect(r.total).toBe(r.subtotal + r.deliveryFee - r.discount);
      expect(r.discount).toBeLessThanOrEqual(r.subtotal + r.deliveryFee);
    }
  });
});
