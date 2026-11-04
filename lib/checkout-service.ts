import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import { closure, offer, openingHours, order, orderItem } from "@/db/schema";
import type { Db } from "@/lib/db/client";
import { loadMenuRows, loadOffers, loadSettings, loadZones } from "@/lib/db/menu-repo";
import { isOpenAt, type ClosureRow, type HoursRow } from "@/lib/hours";
import { rowsToMenu, type Menu } from "@/lib/menu-model";
import { parsePostcode, priceOrder, type OfferRule, type PricingError, type Zone } from "@/lib/pricing";
import type { CheckoutInput } from "@/lib/checkout-schema";
import { createCheckoutSession, retrieveCheckoutSession } from "@/lib/stripe";
import { newOrderToken } from "@/lib/token";
import { verifyTurnstile } from "@/lib/turnstile";

// Order creation (R8.2, R8.6, R13.7). Flow:
//   idempotency lookup -> bot check -> open/paused -> server-side pricing ->
//   cash caps -> reserve promo use -> insert order + lines atomically ->
//   cash: received | card: create Stripe Checkout Session, return its URL.
// The browser's prices are never read: only ids and quantities reach pricing.
// Card orders stay `pending_payment` until the Stripe webhook (separate
// handler) marks them paid; they never reach the kitchen board before that.

export type CheckoutContext = {
  menu: Menu;
  zones: Zone[];
  offers: OfferRule[];
  hours: HoursRow[];
  closures: ClosureRow[];
  settings: {
    paused: boolean;
    pausedMessage: string | null;
    cashMaxPence: number | null;
    cashDailyCapPerPhone: number;
    cashDailyCapPerIp: number;
  };
};

export async function loadCheckoutContext(db: Db): Promise<CheckoutContext> {
  const [rows, zones, offers, hours, closures, settings] = await Promise.all([
    loadMenuRows(db),
    loadZones(db),
    loadOffers(db),
    db.select().from(openingHours),
    db.select().from(closure),
    loadSettings(db),
  ]);
  return {
    menu: rowsToMenu(rows),
    zones,
    offers,
    hours,
    closures,
    settings: {
      paused: settings?.paused ?? false,
      pausedMessage: settings?.pausedMessage ?? null,
      cashMaxPence: settings?.cashMaxPence ?? null,
      cashDailyCapPerPhone: settings?.cashDailyCapPerPhone ?? 3,
      cashDailyCapPerIp: settings?.cashDailyCapPerIp ?? 5,
    },
  };
}

export type CheckoutDeps = {
  db: Db;
  now: Date;
  siteUrl: string;
  clientIp: string | null;
  /** HMAC key for the IP hash (R6.15). Without it, per-IP caps are skipped. */
  ipHashKey?: string;
  stripeSecretKey?: string;
  turnstileSecret?: string;
  fetchImpl?: typeof fetch;
  loadContext?: (db: Db) => Promise<CheckoutContext>;
};

export type CheckoutOutcome =
  | { status: 200 | 201; body: { ok: true; token: string; number: number; checkoutUrl?: string } }
  | { status: number; body: { ok: false; code: string; message: string; errors?: PricingError[] } };

const fail = (status: number, code: string, message: string, errors?: PricingError[]): CheckoutOutcome => ({
  status,
  body: { ok: false, code, message, errors },
});

export async function ipHash(ip: string, key: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`ip:${ip}`)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function releaseOffer(db: Db, offerId: number) {
  await db.update(offer).set({ usedCount: sql`greatest(${offer.usedCount} - 1, 0)` }).where(eq(offer.id, offerId));
}

type OrderRow = typeof order.$inferSelect;

/** Existing order for this idempotency key: hand back the same result (R13.7). */
async function resume(deps: CheckoutDeps, existing: OrderRow): Promise<CheckoutOutcome> {
  const base = { ok: true as const, token: existing.token, number: existing.number! };
  if (existing.paymentMethod !== "card" || existing.paymentStatus === "paid" || existing.status !== "pending_payment") {
    return { status: 200, body: base };
  }
  if (!deps.stripeSecretKey) return fail(503, "PAYMENTS_UNAVAILABLE", "Card payment is not available right now.");
  try {
    const s = existing.stripeSessionId
      ? await retrieveCheckoutSession(deps.stripeSecretKey, existing.stripeSessionId, deps.fetchImpl)
      : await createAndAttachSession(deps, existing);
    return { status: 200, body: { ...base, checkoutUrl: s.url } };
  } catch {
    return fail(502, "PAYMENT_START_FAILED", "We could not start the payment. Please try again.");
  }
}

async function createAndAttachSession(deps: CheckoutDeps, o: OrderRow) {
  const s = await createCheckoutSession({
    secretKey: deps.stripeSecretKey!,
    orderId: o.id,
    orderNumber: o.number!,
    amountPence: o.total,
    email: o.email,
    successUrl: `${deps.siteUrl}/order/${o.token}`,
    cancelUrl: `${deps.siteUrl}/checkout?cancelled=1`,
    now: deps.now,
    fetchImpl: deps.fetchImpl,
  });
  await deps.db.update(order).set({ stripeSessionId: s.id, updatedAt: deps.now }).where(eq(order.id, o.id));
  return s;
}

export async function createOrder(deps: CheckoutDeps, input: CheckoutInput): Promise<CheckoutOutcome> {
  const { db, now } = deps;

  const [existing] = await db.select().from(order).where(eq(order.idempotencyKey, input.idempotencyKey)).limit(1);
  if (existing) return resume(deps, existing);

  if (deps.turnstileSecret && !(await verifyTurnstile(input.turnstileToken, deps.turnstileSecret, deps.clientIp, deps.fetchImpl))) {
    return fail(403, "BOT_CHECK_FAILED", "We could not verify you are human. Please try again.");
  }

  const ctx = await (deps.loadContext ?? loadCheckoutContext)(db);

  if (ctx.settings.paused) {
    return fail(409, "SHOP_PAUSED", ctx.settings.pausedMessage || "We are not taking orders right now.");
  }
  if (!isOpenAt(ctx.hours, ctx.closures, now)) {
    return fail(409, "SHOP_CLOSED", "We are closed right now. You can browse the menu and order when we reopen.");
  }

  const priced = priceOrder({
    menu: ctx.menu,
    zones: ctx.zones,
    offers: ctx.offers,
    items: input.items,
    orderType: input.orderType,
    postcode: input.postcode,
    promoCode: input.promoCode,
    paymentMethod: input.paymentMethod,
    cashMaxPence: ctx.settings.cashMaxPence,
    now,
  });
  if (!priced.ok) return fail(422, "INVALID_ORDER", priced.errors[0]?.message ?? "Your order could not be priced.", priced.errors);

  const hash = deps.clientIp && deps.ipHashKey ? await ipHash(deps.clientIp, deps.ipHashKey) : null;

  // R6.15: daily caps on cash orders per phone and per IP (rolling 24h).
  if (input.paymentMethod === "cash") {
    const since = new Date(now.getTime() - 24 * 3_600_000);
    const live = and(eq(order.paymentMethod, "cash"), gte(order.createdAt, since), ne(order.status, "cancelled"));
    const [[p], [i]] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(order).where(and(live, eq(order.phone, input.phone))),
      hash ? db.select({ n: sql<number>`count(*)::int` }).from(order).where(and(live, eq(order.ipHash, hash))) : Promise.resolve([{ n: 0 }]),
    ]);
    if (p.n >= ctx.settings.cashDailyCapPerPhone || i.n >= ctx.settings.cashDailyCapPerIp) {
      return fail(429, "CASH_LIMIT", "You have reached today's limit for cash orders. Please pay by card.");
    }
  }

  // Reserve a promo use atomically: the conditional UPDATE only succeeds while
  // the limit has room, so two simultaneous orders cannot both take the last use.
  let reservedOffer: number | null = null;
  if (priced.appliedOffer) {
    const offerId = Number(priced.appliedOffer.id);
    const got = await db
      .update(offer)
      .set({ usedCount: sql`${offer.usedCount} + 1` })
      .where(and(eq(offer.id, offerId), sql`(${offer.usageLimit} is null or ${offer.usedCount} < ${offer.usageLimit})`))
      .returning({ id: offer.id });
    if (got.length === 0) return fail(422, "PROMO_USED_UP", "That offer has been fully used.");
    reservedOffer = offerId;
  }

  const token = newOrderToken();
  let created: OrderRow;
  try {
    // Pre-allocate the id so the order and its lines go in ONE transaction.
    const seq = await db.execute<{ id: string }>(sql`select nextval(pg_get_serial_sequence('"order"', 'id'))::text as id`);
    const id = Number(seq.rows[0].id);
    const [row] = await db.batch([
      db
        .insert(order)
        .values({
          id,
          token,
          idempotencyKey: input.idempotencyKey,
          type: input.orderType,
          status: input.paymentMethod === "cash" ? "received" : "pending_payment",
          paymentMethod: input.paymentMethod,
          paymentStatus: "unpaid",
          subtotal: priced.subtotal,
          deliveryFee: priced.deliveryFee,
          discount: priced.discount,
          total: priced.total,
          customerName: input.name,
          phone: input.phone,
          email: input.email,
          address: input.orderType === "delivery" ? input.address : null,
          postcode: input.orderType === "delivery" ? (parsePostcode(input.postcode ?? "")?.formatted ?? input.postcode) : null,
          note: input.note || null,
          ipHash: hash,
          offerId: reservedOffer,
        })
        .returning(),
      db.insert(orderItem).values(
        priced.lines.map((l) => ({
          orderId: id,
          name: l.name,
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          options: l.options.map((o) => ({ name: o.name, priceChange: o.priceChange })),
          lineTotal: l.lineTotal,
        })),
      ),
    ]);
    created = row[0];
  } catch (e) {
    if (reservedOffer !== null) await releaseOffer(db, reservedOffer);
    // A concurrent request with the same key won the unique index: return its order.
    const [winner] = await db.select().from(order).where(eq(order.idempotencyKey, input.idempotencyKey)).limit(1);
    if (winner) return resume(deps, winner);
    throw e;
  }

  if (input.paymentMethod === "cash") return { status: 201, body: { ok: true, token, number: created.number! } };

  if (!deps.stripeSecretKey) return fail(503, "PAYMENTS_UNAVAILABLE", "Card payment is not available right now.");
  try {
    const s = await createAndAttachSession(deps, created);
    return { status: 201, body: { ok: true, token, number: created.number!, checkoutUrl: s.url } };
  } catch {
    // Order stays pending_payment; a retry with the same key creates the session.
    return fail(502, "PAYMENT_START_FAILED", "We could not start the payment. Please try again.");
  }
}

/**
 * R8.7: card orders never paid are cancelled (and their promo use released) so
 * they cannot linger. Stripe sessions expire at ~31 minutes, so anything older
 * than `olderThanMinutes` (default 45) can no longer be paid. Run on a Cron Trigger.
 */
export async function expireUnpaidOrders(db: Db, now: Date, olderThanMinutes = 45): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanMinutes * 60_000);
  const expired = await db
    .update(order)
    .set({ status: "cancelled", updatedAt: now })
    .where(and(eq(order.status, "pending_payment"), eq(order.paymentMethod, "card"), lt(order.createdAt, cutoff)))
    .returning({ id: order.id, offerId: order.offerId });
  const offerIds = [...new Set(expired.map((o) => o.offerId).filter((x): x is number => x !== null))];
  for (const id of offerIds) {
    const n = expired.filter((o) => o.offerId === id).length;
    await db.update(offer).set({ usedCount: sql`greatest(${offer.usedCount} - ${n}, 0)` }).where(eq(offer.id, id));
  }
  return expired.length;
}
