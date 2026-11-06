import { currentConsent } from "./consent-store";

// GA4 events (R11.8): view_menu, add_to_cart, begin_checkout, purchase (value and payment type),
// promo_applied, click_call, click_directions.
//
// Nothing is sent unless the visitor pressed Accept AND Google's tag has been set up (see
// components/cookie-consent.tsx). Before that, track() does nothing at all, so no event is queued
// or remembered for later. No name, phone, email, address or order token is ever put in an event.

export type GaItem = { item_id: string; item_name: string; price: number; quantity: number; item_variant?: string };
export type GaEvent = { name: string; params: Record<string, unknown> };

const pounds = (pence: number) => Math.round(pence) / 100;
const CURRENCY = "GBP";

export const viewMenuEvent = (): GaEvent => ({ name: "view_menu", params: {} });

export function addToCartEvent(line: { id: string; name: string; price: number; optionNames?: string[] }): GaEvent {
  return {
    name: "add_to_cart",
    params: {
      currency: CURRENCY,
      value: pounds(line.price),
      items: [{ item_id: line.id, item_name: line.name, price: pounds(line.price), quantity: 1, ...(line.optionNames?.length ? { item_variant: line.optionNames.join(", ") } : {}) } satisfies GaItem],
    },
  };
}

export const beginCheckoutEvent = (totalPence: number): GaEvent => ({ name: "begin_checkout", params: { currency: CURRENCY, value: pounds(totalPence) } });

export const promoAppliedEvent = (offerName: string): GaEvent => ({ name: "promo_applied", params: { promotion_name: offerName.slice(0, 100) } });

export function purchaseEvent(o: { number: number; total: number; deliveryFee: number; discount: number; paymentMethod: "card" | "cash"; items: { name: string; quantity: number; lineTotal: number }[] }): GaEvent {
  return {
    name: "purchase",
    params: {
      transaction_id: String(o.number), // the public order number, never the private link token
      currency: CURRENCY,
      value: pounds(o.total),
      shipping: pounds(o.deliveryFee),
      payment_type: o.paymentMethod,
      ...(o.discount > 0 ? { coupon: "offer" } : {}),
      items: o.items.map((i) => ({ item_id: i.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), item_name: i.name, price: pounds(Math.round(i.lineTotal / Math.max(1, i.quantity))), quantity: i.quantity }) satisfies GaItem),
    },
  };
}

/** The `data-event` values that links may carry. Anything else is ignored. */
export const CLICK_EVENTS = ["click_call", "click_directions"] as const;
export const clickEvent = (name: (typeof CLICK_EVENTS)[number]): GaEvent => ({ name, params: {} });

/** Sends the event if, and only if, analytics is accepted and set up. Returns whether it was sent. */
export function track(e: GaEvent): boolean {
  try {
    if (typeof window === "undefined" || currentConsent() !== "granted" || typeof window.gtag !== "function") return false;
    window.gtag("event", e.name, e.params);
    return true;
  } catch {
    return false; // analytics must never break the page
  }
}
