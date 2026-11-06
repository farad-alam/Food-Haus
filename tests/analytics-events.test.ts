import { afterEach, describe, expect, it, vi } from "vitest";
import { addToCartEvent, beginCheckoutEvent, CLICK_EVENTS, clickEvent, promoAppliedEvent, purchaseEvent, viewMenuEvent } from "@/lib/analytics-events";
import { gridCell } from "@/lib/allergens";

describe("GA4 event payloads (R11.8)", () => {
  it("money is in pounds with GBP, and add_to_cart carries the chosen options as the variant", () => {
    expect(addToCartEvent({ id: "burgers-classic-burger", name: "Classic Burger", price: 1148, optionNames: ["Meal"] })).toEqual({
      name: "add_to_cart",
      params: { currency: "GBP", value: 11.48, items: [{ item_id: "burgers-classic-burger", item_name: "Classic Burger", price: 11.48, quantity: 1, item_variant: "Meal" }] },
    });
    expect(addToCartEvent({ id: "x", name: "X", price: 799 }).params.items).toEqual([{ item_id: "x", item_name: "X", price: 7.99, quantity: 1 }]);
  });
  it("begin_checkout, view_menu and promo_applied", () => {
    expect(beginCheckoutEvent(2399)).toEqual({ name: "begin_checkout", params: { currency: "GBP", value: 23.99 } });
    expect(viewMenuEvent().name).toBe("view_menu");
    expect(promoAppliedEvent("Buy 1 Get 1 Free on Wings").params).toEqual({ promotion_name: "Buy 1 Get 1 Free on Wings" });
  });
  it("purchase has the value, payment type and the PUBLIC order number, and nothing personal", () => {
    const e = purchaseEvent({ number: 1042, total: 2398, deliveryFee: 300, discount: 100, paymentMethod: "card", items: [{ name: "Classic Burger", quantity: 2, lineTotal: 2298 }] });
    expect(e.name).toBe("purchase");
    expect(e.params).toMatchObject({ transaction_id: "1042", currency: "GBP", value: 23.98, shipping: 3, payment_type: "card", coupon: "offer" });
    expect((e.params.items as { price: number; quantity: number }[])[0]).toMatchObject({ item_name: "Classic Burger", price: 11.49, quantity: 2 });
    expect(JSON.stringify(e)).not.toMatch(/@|\+44|token|phone|email|address/i);
    expect(purchaseEvent({ number: 1, total: 100, deliveryFee: 0, discount: 0, paymentMethod: "cash", items: [] }).params.coupon).toBeUndefined();
  });
  it("only the two click events exist", () => {
    expect([...CLICK_EVENTS]).toEqual(["click_call", "click_directions"]);
    expect(clickEvent("click_call")).toEqual({ name: "click_call", params: {} });
  });
});

describe("track() sends nothing without consent", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
  const load = async (cookie: string, hasGtag: boolean) => {
    const gtag = vi.fn();
    vi.stubGlobal("window", { gtag: hasGtag ? gtag : undefined, location: { protocol: "https:" } });
    vi.stubGlobal("document", { cookie });
    const { track, viewMenuEvent: v } = await import("@/lib/analytics-events");
    return { sent: track(v()), gtag };
  };
  const ts = Math.floor(Date.now() / 1000);
  it("unanswered, rejected, or accepted but not yet set up: nothing is sent", async () => {
    for (const [cookie, g] of [["", true], [`fh_consent=1.r.${ts}`, true], [`fh_consent=1.a.${ts}`, false]] as const) {
      const r = await load(cookie, g);
      expect([cookie, g, r.sent, r.gtag.mock.calls.length]).toEqual([cookie, g, false, 0]);
    }
  });
  it("accepted and set up: exactly one event goes to gtag", async () => {
    const r = await load(`fh_consent=1.a.${ts}`, true);
    expect(r.sent).toBe(true);
    expect(r.gtag).toHaveBeenCalledWith("event", "view_menu", {});
  });
});

describe("allergen grid cells never say 'no' without full data", () => {
  it("covers every case", () => {
    expect(gridCell("milk", null)).toBe("unknown");
    expect(gridCell("milk", ["milk"])).toBe("yes");
    expect(gridCell("milk", ["milk"], [null])).toBe("yes"); // a positive claim stays true
    expect(gridCell("fish", ["milk"], [null])).toBe("unknown"); // an unconfirmed option blocks 'no'
    expect(gridCell("fish", [])).toBe("no");
    expect(gridCell("fish", [], [[], []])).toBe("no");
    expect(gridCell("fish", [], [["fish"]])).toBe("via-option");
    expect(gridCell("fish", [], [[], null])).toBe("unknown");
  });
});

import { openingHoursSpec } from "@/components/json-ld";
import { cleanNotice, MAX_NOTICE } from "@/lib/notice-text";

describe("opening hours in structured data and the notice text", () => {
  it("structured data lists exactly the hours the owner entered, and nothing when there are none", () => {
    expect(openingHoursSpec([])).toEqual([]);
    expect(openingHoursSpec([{ weekday: 1, opensAt: "12:00:00", closesAt: "23:00:00" }, { weekday: 0, opensAt: "13:00", closesAt: "00:30" }])).toEqual([
      { "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/Monday", opens: "12:00", closes: "23:00" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/Sunday", opens: "13:00", closes: "00:30" },
    ]);
  });
  it("the notice is one tidy plain-text line, empty means none, and it is capped", () => {
    expect(cleanNotice("  Closed   this\n Sunday ")).toBe("Closed this Sunday");
    for (const none of ["", "   ", null, undefined]) expect(cleanNotice(none)).toBeNull();
    expect(cleanNotice("x".repeat(500))).toHaveLength(MAX_NOTICE);
    expect(cleanNotice("<b>Sale</b>")).toBe("<b>Sale</b>"); // kept as text; React escapes it when drawn, it is never HTML
  });
});
