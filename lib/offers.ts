import { formatPence } from "./money";
import { formatLondonDate } from "./london-time";

// Offer wording and status, shared by the admin screen (so the owner sees what
// customers will see) and the public pages. Pure: callers pass `now`.

export type OfferType = "percentage" | "fixed" | "free_delivery" | "bogof";
export type OfferChannel = "any" | "delivery" | "collection";

export type OfferFacts = {
  type: OfferType;
  value: number | null;
  categoryName: string | null; // bogof: the category it applies to
  channel: OfferChannel;
  code: string | null;
  minSpend: number;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  usedCount: number;
};

export type OfferStatus = "active" | "scheduled" | "ended" | "used_up";

/** Matches the pricing engine's eligibility checks (lib/pricing.ts), minus order-specific ones. */
export function offerStatus(o: Pick<OfferFacts, "startsAt" | "endsAt" | "usageLimit" | "usedCount">, now: Date): OfferStatus {
  if (o.endsAt && now > o.endsAt) return "ended";
  if (o.startsAt && now < o.startsAt) return "scheduled";
  if (o.usageLimit != null && o.usedCount >= o.usageLimit) return "used_up";
  return "active";
}

/** The deal itself, e.g. "10% off your order", "Buy 1 get 1 free on Wings". */
export function describeDeal(o: Pick<OfferFacts, "type" | "value" | "categoryName">): string {
  switch (o.type) {
    case "percentage":
      return `${o.value}% off your order`;
    case "fixed":
      return `${formatPence(o.value ?? 0)} off your order`;
    case "free_delivery":
      return "Free delivery";
    case "bogof":
      return `Buy 1 get 1 free on ${o.categoryName ?? "selected items"}`;
  }
}

/** The small print, e.g. ["Collection orders only", "Spend £15 or more", "Ends 30 Nov"]. */
export function describeConditions(o: OfferFacts): string[] {
  const out: string[] = [];
  if (o.channel === "collection") out.push("Collection orders only");
  if (o.channel === "delivery") out.push("Delivery orders only");
  if (o.minSpend > 0) out.push(`Spend ${formatPence(o.minSpend)} or more`);
  if (o.startsAt) out.push(`From ${formatLondonDate(o.startsAt)}`);
  if (o.endsAt) out.push(`Ends ${formatLondonDate(o.endsAt)}`);
  if (o.usageLimit != null) out.push("While offers last");
  return out;
}

/** One line for a banner or badge, e.g. "Buy 1 get 1 free on Wings — collection only · code WINGS". */
export function describeShort(o: OfferFacts & { name?: string }): string {
  const channel = o.channel === "collection" ? " — collection only" : o.channel === "delivery" ? " — delivery only" : "";
  const code = o.code ? ` · code ${o.code}` : "";
  return `${describeDeal(o)}${channel}${code}`;
}
