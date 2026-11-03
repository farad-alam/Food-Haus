import type { Menu, MenuItem, MenuOption } from "./menu-model";

// Server-side order pricing (requirements R6.6, R6.7, R6.10, R6.14, R13.7).
//
// The browser sends ONLY item ids, quantities and option ids. Every price,
// fee, discount and total here is computed from the menu, delivery zones and
// offers the server loaded itself — a price sent by the client is never read.
// All money is whole pence. This file is pure (no I/O, no clock): the caller
// passes `now`, which keeps it deterministic and testable.

export const MAX_LINES = 30;
export const MAX_QUANTITY = 20;

export type OrderType = "delivery" | "collection";
export type PaymentMethod = "card" | "cash";

export type CartInput = { itemId: string; quantity: number; optionIds?: string[] };

export type Zone = {
  district: string; // outward code, e.g. "LU4"
  fee: number;
  minOrder: number;
  estimatedMinutes: number;
  active: boolean;
};

export type OfferRule = {
  id: string | number;
  name: string;
  type: "percentage" | "fixed" | "free_delivery" | "bogof";
  value?: number | null; // percent (1-100) or pence
  appliesToCategory?: string | null; // bogof: category name
  channel: "any" | OrderType;
  code?: string | null; // null/empty = automatic offer
  minSpend: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
  usageLimit?: number | null;
  usedCount: number;
};

export type PricingInput = {
  menu: Menu;
  zones: Zone[];
  offers: OfferRule[];
  items: CartInput[];
  orderType: OrderType;
  postcode?: string;
  promoCode?: string;
  paymentMethod: PaymentMethod;
  cashMaxPence?: number | null;
  now: Date;
};

export type PricingErrorCode =
  | "EMPTY_BASKET"
  | "TOO_MANY_LINES"
  | "BAD_QUANTITY"
  | "UNKNOWN_ITEM"
  | "SOLD_OUT"
  | "BAD_OPTION"
  | "OPTION_COUNT"
  | "POSTCODE_REQUIRED"
  | "POSTCODE_INVALID"
  | "OUTSIDE_ZONE"
  | "BELOW_MIN_ORDER"
  | "PROMO_INVALID"
  | "PROMO_EXPIRED"
  | "PROMO_NOT_STARTED"
  | "PROMO_MIN_SPEND"
  | "PROMO_USED_UP"
  | "PROMO_NOT_APPLICABLE"
  | "CASH_OVER_CAP";

export type PricingError = { code: PricingErrorCode; message: string; itemId?: string };

export type PricedLine = {
  itemId: string;
  category: string;
  name: string; // copied at order time
  unitPrice: number; // pence, includes option price changes
  quantity: number;
  options: { id: string; name: string; priceChange: number }[];
  lineTotal: number;
};

export type PricingResult =
  | {
      ok: true;
      lines: PricedLine[];
      subtotal: number;
      deliveryFee: number;
      discount: number;
      total: number;
      appliedOffer: { id: string | number; name: string } | null;
      estimatedMinutes: number | null;
    }
  | { ok: false; errors: PricingError[] };

// UK postcode: outward code (area + district) then inward code (digit + 2 letters).
const POSTCODE_RE = /^([A-Z]{1,2}[0-9][A-Z0-9]?)([0-9][A-Z]{2})$/;

export function parsePostcode(raw: string): { outward: string; inward: string; formatted: string } | null {
  const compact = raw.toUpperCase().replace(/\s+/g, "");
  const m = POSTCODE_RE.exec(compact);
  if (!m) return null;
  return { outward: m[1], inward: m[2], formatted: `${m[1]} ${m[2]}` };
}

function err(code: PricingErrorCode, message: string, itemId?: string): PricingError {
  return { code, message, itemId };
}

function findItem(menu: Menu, id: string): MenuItem | undefined {
  for (const c of menu.categories) {
    const hit = c.items.find((i) => i.id === id);
    if (hit) return hit;
  }
  return undefined;
}

export function priceOrder(input: PricingInput): PricingResult {
  const errors: PricingError[] = [];
  const { menu, items } = input;

  // ---- 1. Lines ----------------------------------------------------------
  if (items.length === 0) return { ok: false, errors: [err("EMPTY_BASKET", "Your basket is empty.")] };
  if (items.length > MAX_LINES) {
    return { ok: false, errors: [err("TOO_MANY_LINES", `A single order can have at most ${MAX_LINES} lines.`)] };
  }

  const lines: PricedLine[] = [];
  for (const raw of items) {
    const item = findItem(menu, raw.itemId);
    if (!item || !item.visible) {
      errors.push(err("UNKNOWN_ITEM", "An item in your basket is no longer on the menu.", raw.itemId));
      continue;
    }
    if (item.soldOut) {
      errors.push(err("SOLD_OUT", `${item.name} is sold out.`, item.id));
      continue;
    }
    if (!Number.isInteger(raw.quantity) || raw.quantity < 1 || raw.quantity > MAX_QUANTITY) {
      errors.push(err("BAD_QUANTITY", `Quantity for ${item.name} must be 1 to ${MAX_QUANTITY}.`, item.id));
      continue;
    }

    // Options are validated against the group the SERVER attaches to the item's category.
    const selected = raw.optionIds ?? [];
    const group = menu.optionGroups[item.category];
    const chosen: MenuOption[] = [];
    let optionsOk = true;

    if (new Set(selected).size !== selected.length) {
      errors.push(err("BAD_OPTION", `Duplicate option selected for ${item.name}.`, item.id));
      optionsOk = false;
    } else if (selected.length > 0 && !group) {
      errors.push(err("BAD_OPTION", `${item.name} has no options.`, item.id));
      optionsOk = false;
    } else if (group) {
      for (const id of selected) {
        const opt = group.options.find((o) => o.id === id);
        if (!opt) {
          errors.push(err("BAD_OPTION", `Unknown option for ${item.name}.`, item.id));
          optionsOk = false;
          break;
        }
        chosen.push(opt);
      }
      if (optionsOk) {
        const min = group.required ? Math.max(group.minPicks, 1) : group.minPicks;
        if (chosen.length < min || chosen.length > group.maxPicks) {
          errors.push(err("OPTION_COUNT", `Choose ${min === group.maxPicks ? min : `${min}-${group.maxPicks}`} for ${group.name}.`, item.id));
          optionsOk = false;
        }
      }
    }
    if (!optionsOk) continue;

    const unitPrice = item.price + chosen.reduce((n, o) => n + o.priceChange, 0);
    lines.push({
      itemId: item.id,
      category: item.category,
      name: item.name,
      unitPrice,
      quantity: raw.quantity,
      options: chosen.map((o) => ({ id: o.id, name: o.name, priceChange: o.priceChange })),
      lineTotal: unitPrice * raw.quantity,
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  const subtotal = lines.reduce((n, l) => n + l.lineTotal, 0);

  // ---- 2. Delivery -------------------------------------------------------
  let deliveryFee = 0;
  let estimatedMinutes: number | null = null;
  if (input.orderType === "delivery") {
    if (!input.postcode || input.postcode.trim() === "") {
      errors.push(err("POSTCODE_REQUIRED", "Enter your postcode for delivery."));
    } else {
      const pc = parsePostcode(input.postcode);
      if (!pc) {
        errors.push(err("POSTCODE_INVALID", "That doesn’t look like a UK postcode."));
      } else {
        const zone = input.zones.find((z) => z.active && z.district.toUpperCase() === pc.outward);
        if (!zone) {
          errors.push(err("OUTSIDE_ZONE", "Sorry, we don’t deliver to that postcode. You can still collect."));
        } else {
          deliveryFee = zone.fee;
          estimatedMinutes = zone.estimatedMinutes;
          if (subtotal < zone.minOrder) {
            errors.push(err("BELOW_MIN_ORDER", `The minimum order for delivery to ${pc.outward} is ${(zone.minOrder / 100).toFixed(2)} pounds.`));
          }
        }
      }
    }
  }

  // ---- 3. Offer (one discount per order; offers never stack) ------------
  let discount = 0;
  let appliedOffer: { id: string | number; name: string } | null = null;

  const code = input.promoCode?.trim();
  if (code) {
    const offer = input.offers.find((o) => o.code && o.code.trim().toLowerCase() === code.toLowerCase());
    if (!offer) {
      errors.push(err("PROMO_INVALID", "That promo code isn’t valid."));
    } else {
      const check = eligibility(offer, input, subtotal);
      if (check) errors.push(check);
      else {
        const d = discountFor(offer, lines, subtotal, deliveryFee, input.orderType);
        if (d === 0) errors.push(err("PROMO_NOT_APPLICABLE", "That code doesn’t apply to this order."));
        else {
          discount = d;
          appliedOffer = { id: offer.id, name: offer.name };
        }
      }
    }
  } else {
    // Automatic offers: silently skip any that don't apply; take the best.
    for (const offer of input.offers) {
      if (offer.code && offer.code.trim() !== "") continue;
      if (eligibility(offer, input, subtotal)) continue;
      const d = discountFor(offer, lines, subtotal, deliveryFee, input.orderType);
      if (d > discount) {
        discount = d;
        appliedOffer = { id: offer.id, name: offer.name };
      }
    }
  }

  const total = subtotal + deliveryFee - discount;

  // ---- 4. Cash cap (R6.10) ----------------------------------------------
  if (input.paymentMethod === "cash" && input.cashMaxPence != null && total > input.cashMaxPence) {
    errors.push(err("CASH_OVER_CAP", `Cash orders are limited to ${(input.cashMaxPence / 100).toFixed(2)} pounds. Please pay by card.`));
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, lines, subtotal, deliveryFee, discount, total, appliedOffer, estimatedMinutes };
}

/** Returns an error if the offer cannot apply to this order right now, else null. */
function eligibility(offer: OfferRule, input: PricingInput, subtotal: number): PricingError | null {
  if (offer.startsAt && input.now < offer.startsAt) return err("PROMO_NOT_STARTED", "That offer hasn’t started yet.");
  if (offer.endsAt && input.now > offer.endsAt) return err("PROMO_EXPIRED", "That offer has ended.");
  if (offer.usageLimit != null && offer.usedCount >= offer.usageLimit) {
    return err("PROMO_USED_UP", "That offer has been fully used.");
  }
  if (offer.channel !== "any" && offer.channel !== input.orderType) {
    return err("PROMO_NOT_APPLICABLE", `That offer is for ${offer.channel} orders only.`);
  }
  if (subtotal < offer.minSpend) {
    return err("PROMO_MIN_SPEND", `Spend at least ${(offer.minSpend / 100).toFixed(2)} pounds to use that offer.`);
  }
  return null;
}

/** Discount in pence. Never exceeds what it applies to. Returns 0 when nothing qualifies. */
function discountFor(
  offer: OfferRule,
  lines: PricedLine[],
  subtotal: number,
  deliveryFee: number,
  orderType: OrderType,
): number {
  switch (offer.type) {
    case "percentage": {
      const pct = offer.value ?? 0;
      if (!Number.isInteger(pct) || pct < 1 || pct > 100) return 0;
      return Math.floor((subtotal * pct) / 100);
    }
    case "fixed": {
      const off = offer.value ?? 0;
      if (!Number.isInteger(off) || off < 1) return 0;
      return Math.min(off, subtotal);
    }
    case "free_delivery":
      return orderType === "delivery" ? deliveryFee : 0;
    case "bogof": {
      if (!offer.appliesToCategory) return 0;
      // One unit price per unit ordered in the category, dearest first. Pair them
      // up: the cheaper unit in each pair is free (positions 1, 3, 5 ...).
      const units: number[] = [];
      for (const l of lines) {
        if (l.category === offer.appliesToCategory) {
          for (let i = 0; i < l.quantity; i++) units.push(l.unitPrice);
        }
      }
      units.sort((a, b) => b - a);
      let free = 0;
      for (let i = 1; i < units.length; i += 2) free += units[i];
      return free;
    }
  }
}
