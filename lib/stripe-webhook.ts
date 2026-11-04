import { and, eq, sql } from "drizzle-orm";
import { offer, order, stripeEvent } from "@/db/schema";
import type { Db } from "@/lib/db/client";

// Stripe event handling (R8.3, R8.5). An order becomes paid ONLY here, from a
// signature-verified event, never because the customer returned to the site.
//
// Safety properties:
//  - Replays are harmless: seen event ids are skipped, and every state change
//    is a conditional UPDATE (`status = 'pending_payment'`), so a duplicate or
//    out-of-order delivery cannot double-apply anything.
//  - The event id is recorded in the same transaction as the order change, so
//    a crash can never mark an event "seen" without its effect being applied.
//  - An event only affects an order whose stored Stripe session id matches the
//    session in the event, and only if the amount and currency match what we
//    stored: a mismatch is logged and NOT fulfilled.
//  - Pay by Bank can complete asynchronously: `checkout.session.completed`
//    with payment_status != "paid" waits for `async_payment_succeeded`.

export type StripeEvent = {
  id: string;
  type: string;
  data: { object: StripeSessionObject };
};
type StripeSessionObject = {
  id?: string;
  payment_status?: string;
  amount_total?: number;
  currency?: string;
  metadata?: Record<string, string> | null;
};

export type EventResult =
  | "duplicate"
  | "paid"
  | "awaiting_payment"
  | "cancelled"
  | "already_handled"
  | "paid_but_order_not_pending" // customer paid for an order we had cancelled: needs a refund
  | "unknown_order"
  | "amount_mismatch"
  | "ignored";

export async function processStripeEvent(db: Db, event: StripeEvent, now: Date): Promise<EventResult> {
  const [seen] = await db.select({ id: stripeEvent.id }).from(stripeEvent).where(eq(stripeEvent.id, event.id)).limit(1);
  if (seen) return "duplicate";

  const record = db.insert(stripeEvent).values({ id: event.id, type: event.type, processedAt: now }).onConflictDoNothing();

  const paidTypes = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];
  const cancelTypes = ["checkout.session.async_payment_failed", "checkout.session.expired"];
  if (!paidTypes.includes(event.type) && !cancelTypes.includes(event.type)) {
    await record;
    return "ignored";
  }

  const s = event.data?.object ?? {};
  const orderId = Number(s.metadata?.order_id);
  const [o] =
    Number.isInteger(orderId) && s.id
      ? await db.select().from(order).where(and(eq(order.id, orderId), eq(order.stripeSessionId, s.id))).limit(1)
      : [];
  if (!o) {
    console.error("stripe event for unknown order/session", event.id, event.type);
    await record;
    return "unknown_order";
  }

  if (paidTypes.includes(event.type)) {
    if (s.payment_status !== "paid") {
      await record;
      return "awaiting_payment";
    }
    if (s.amount_total !== o.total || s.currency !== "gbp") {
      console.error("stripe amount mismatch; not fulfilling", event.id, o.id);
      await record;
      return "amount_mismatch";
    }
    const [updated] = await db.batch([
      db
        .update(order)
        .set({ status: "received", paymentStatus: "paid", updatedAt: now })
        .where(and(eq(order.id, o.id), eq(order.status, "pending_payment")))
        .returning({ id: order.id }),
      record,
    ]);
    if (updated.length === 1) return "paid";
    if (o.paymentStatus === "paid") return "already_handled";
    // Paid, but the order is no longer pending (cancelled/rejected meanwhile).
    // Keep its status, record the money, and flag it for a manual refund.
    await db.update(order).set({ paymentStatus: "paid", updatedAt: now }).where(and(eq(order.id, o.id), eq(order.paymentStatus, "unpaid")));
    console.error("PAID ORDER NOT PENDING: refund or reinstate manually", o.id, o.status);
    return "paid_but_order_not_pending";
  }

  // async_payment_failed / expired: cancel, and give the promo use back, both
  // in one transaction. The offer release runs FIRST so its subquery still
  // sees the order as pending; both are no-ops if it already left that state.
  const failed = event.type === "checkout.session.async_payment_failed";
  const pending = and(eq(order.id, o.id), eq(order.status, "pending_payment"));
  const [, cancelled] = await db.batch([
    db
      .update(offer)
      .set({ usedCount: sql`greatest(${offer.usedCount} - 1, 0)` })
      .where(eq(offer.id, sql`(select ${order.offerId} from ${order} where ${pending})`)),
    db
      .update(order)
      .set({ status: "cancelled", ...(failed ? { paymentStatus: "failed" as const } : {}), updatedAt: now })
      .where(pending)
      .returning({ id: order.id }),
    record,
  ]);
  return cancelled.length === 1 ? "cancelled" : "already_handled";
}
