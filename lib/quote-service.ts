import type { Db } from "@/lib/db/client";
import { isOpenAt } from "@/lib/hours";
import { loadCheckoutContext, ipHash, type CheckoutContext } from "@/lib/checkout-service";
import { isPromoError, promoBlocked, recordPromoFailure } from "@/lib/promo-throttle";
import { parsePostcode, priceOrder, type PricedLine, type PricingError } from "@/lib/pricing";
import type { QuoteInput } from "@/lib/checkout-schema";

// Price preview for the checkout form (R6.6). Read-only: it never writes an
// order and never consumes a promo use. The numbers come from the same
// priceOrder() the real checkout uses, so what the customer sees is what they
// are charged.

export type QuoteDeps = {
  db: Db;
  now: Date;
  clientIp: string | null;
  ipHashKey?: string;
  loadContext?: (db: Db) => Promise<CheckoutContext>;
};

export type QuoteOutcome = {
  status: number;
  body:
    | {
        ok: true;
        open: boolean;
        closedMessage?: string;
        lines: PricedLine[];
        subtotal: number;
        deliveryFee: number;
        discount: number;
        total: number;
        appliedOffer: { id: string | number; name: string } | null;
        estimatedMinutes: number | null;
        zone: Zone | null;
      }
    | { ok: false; open: boolean; closedMessage?: string; errors: PricingError[]; zone: Zone | null };
};
type Zone = { district: string; fee: number; minOrder: number; estimatedMinutes: number };

export async function quoteOrder(deps: QuoteDeps, input: QuoteInput): Promise<QuoteOutcome> {
  const { db, now } = deps;
  const ctx = await (deps.loadContext ?? loadCheckoutContext)(db);

  const paused = ctx.settings.paused;
  const open = !paused && isOpenAt(ctx.hours, ctx.closures, now);
  const closedMessage = open
    ? undefined
    : paused
      ? ctx.settings.pausedMessage || "We are not taking orders right now."
      : "We are closed right now. You can browse the menu and order when we reopen.";

  // Zone info is shown as soon as the postcode is valid, even if the basket is below the minimum.
  const pc = input.orderType === "delivery" && input.postcode ? parsePostcode(input.postcode) : null;
  const z = pc ? ctx.zones.find((x) => x.active && x.district.toUpperCase() === pc.outward) : undefined;
  const zone = z ? { district: z.district, fee: z.fee, minOrder: z.minOrder, estimatedMinutes: z.estimatedMinutes } : null;

  const hash = deps.clientIp && deps.ipHashKey ? await ipHash(deps.clientIp, deps.ipHashKey) : null;
  const promoCode = input.promoCode || undefined;
  if (promoCode && hash && (await promoBlocked(db, hash, now))) {
    return {
      status: 429,
      body: {
        ok: false,
        open,
        closedMessage,
        zone,
        errors: [{ code: "PROMO_INVALID", message: "Too many promo code attempts. Please try again in a few minutes." }],
      },
    };
  }

  const priced = priceOrder({
    menu: ctx.menu,
    zones: ctx.zones,
    offers: ctx.offers,
    items: input.items,
    orderType: input.orderType,
    postcode: input.postcode,
    promoCode,
    paymentMethod: input.paymentMethod,
    cashMaxPence: ctx.settings.cashMaxPence,
    now,
  });

  if (!priced.ok) {
    if (promoCode && hash && priced.errors.some((e) => isPromoError(e.code))) await recordPromoFailure(db, hash, now);
    return { status: 200, body: { ok: false, open, closedMessage, errors: priced.errors, zone } };
  }
  return {
    status: 200,
    body: {
      ok: true,
      open,
      closedMessage,
      lines: priced.lines,
      subtotal: priced.subtotal,
      deliveryFee: priced.deliveryFee,
      discount: priced.discount,
      total: priced.total,
      appliedOffer: priced.appliedOffer,
      estimatedMinutes: priced.estimatedMinutes,
      zone,
    },
  };
}
