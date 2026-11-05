import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { offer, order, stripeEvent } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { processStripeEvent, type StripeEvent } from "@/lib/stripe-webhook";
import { POST } from "@/app/api/stripe/webhook/route";

const enabled = !!process.env.DATABASE_URL;
const tag = crypto.randomUUID().slice(0, 8);
const made = { orders: [] as number[], events: [] as string[], offers: [] as number[] };
const NOW = new Date("2026-11-04T15:00:00Z");

describe.skipIf(!enabled)("Stripe webhook (real database)", () => {
  const db = enabled ? getDb() : (null as never);

  async function mkOrder(over: Partial<typeof order.$inferInsert> = {}) {
    const [o] = await db
      .insert(order)
      .values({
        token: `tok-${crypto.randomUUID()}`,
        idempotencyKey: crypto.randomUUID(),
        type: "collection",
        paymentMethod: "card",
        subtotal: 1500,
        total: 1500,
        customerName: "T",
        phone: "+447000000000",
        email: "t@example.test",
        stripeSessionId: `cs_${tag}_${crypto.randomUUID().slice(0, 8)}`,
        ...over,
      })
      .returning();
    made.orders.push(o.id);
    return o;
  }
  const ev = (type: string, o: { id: number; stripeSessionId: string | null }, over: Record<string, unknown> = {}): StripeEvent => {
    const id = `evt_${tag}_${crypto.randomUUID().slice(0, 8)}`;
    made.events.push(id);
    return {
      id,
      type,
      data: { object: { id: o.stripeSessionId!, payment_status: "paid", amount_total: 1500, currency: "gbp", metadata: { order_id: String(o.id) }, ...over } },
    };
  };
  const get = async (id: number) => (await db.select().from(order).where(eq(order.id, id)))[0];

  afterAll(async () => {
    if (made.orders.length) await db.delete(order).where(inArray(order.id, made.orders));
    if (made.events.length) await db.delete(stripeEvent).where(inArray(stripeEvent.id, made.events));
    if (made.offers.length) await db.delete(offer).where(inArray(offer.id, made.offers));
  });

  it("marks a card order paid and received from a paid completed event; replays are ignored", async () => {
    const o = await mkOrder();
    const e = ev("checkout.session.completed", o);
    expect(await processStripeEvent(db, e, NOW)).toBe("paid");
    expect(await get(o.id)).toMatchObject({ status: "received", paymentStatus: "paid" });
    expect(await processStripeEvent(db, e, NOW)).toBe("duplicate");
  });

  it("calls onPaid exactly once per paid order, never for replays or no-ops", async () => {
    const o = await mkOrder();
    const paid: number[] = [];
    const e = ev("checkout.session.completed", o);
    await processStripeEvent(db, e, NOW, (id) => paid.push(id));
    await processStripeEvent(db, e, NOW, (id) => paid.push(id));
    await processStripeEvent(db, ev("checkout.session.async_payment_succeeded", o), NOW, (id) => paid.push(id));
    expect(paid).toEqual([o.id]);
  });

  it("a different event id for an already-paid order is a harmless no-op", async () => {
    const o = await mkOrder();
    await processStripeEvent(db, ev("checkout.session.completed", o), NOW);
    expect(await processStripeEvent(db, ev("checkout.session.async_payment_succeeded", o), NOW)).toBe("already_handled");
    expect(await get(o.id)).toMatchObject({ status: "received", paymentStatus: "paid" });
  });

  it("concurrent deliveries of the same event apply once", async () => {
    const o = await mkOrder();
    const e = ev("checkout.session.completed", o);
    const r = await Promise.all([1, 2, 3].map(() => processStripeEvent(db, e, NOW)));
    expect(r.filter((x) => x === "paid")).toHaveLength(1);
    expect((await get(o.id)).paymentStatus).toBe("paid");
  });

  it("unpaid completed event (Pay by Bank) waits; the async success then fulfils", async () => {
    const o = await mkOrder();
    expect(await processStripeEvent(db, ev("checkout.session.completed", o, { payment_status: "unpaid" }), NOW)).toBe("awaiting_payment");
    expect(await get(o.id)).toMatchObject({ status: "pending_payment", paymentStatus: "unpaid" });
    expect(await processStripeEvent(db, ev("checkout.session.async_payment_succeeded", o), NOW)).toBe("paid");
    expect(await get(o.id)).toMatchObject({ status: "received", paymentStatus: "paid" });
  });

  it("does not fulfil on amount or currency mismatch", async () => {
    const o = await mkOrder();
    expect(await processStripeEvent(db, ev("checkout.session.completed", o, { amount_total: 1 }), NOW)).toBe("amount_mismatch");
    expect(await processStripeEvent(db, ev("checkout.session.completed", o, { currency: "usd" }), NOW)).toBe("amount_mismatch");
    expect(await get(o.id)).toMatchObject({ status: "pending_payment", paymentStatus: "unpaid" });
  });

  it("ignores events whose session id does not match the order's stored session", async () => {
    const o = await mkOrder();
    const e = ev("checkout.session.completed", o, { id: "cs_someone_elses" });
    expect(await processStripeEvent(db, e, NOW)).toBe("unknown_order");
    expect(await get(o.id)).toMatchObject({ status: "pending_payment" });
  });

  it("async failure and expiry cancel the order and release the promo use, once", async () => {
    const [off] = await db.insert(offer).values({ name: "t", type: "percentage", value: 10, code: `W${tag}`, usageLimit: 5, usedCount: 2, showOnSite: false }).returning();
    made.offers.push(off.id);
    const a = await mkOrder({ offerId: off.id });
    expect(await processStripeEvent(db, ev("checkout.session.async_payment_failed", a), NOW)).toBe("cancelled");
    expect(await get(a.id)).toMatchObject({ status: "cancelled", paymentStatus: "failed" });
    expect((await db.select().from(offer).where(eq(offer.id, off.id)))[0].usedCount).toBe(1);
    // second event for the same order must not release again
    expect(await processStripeEvent(db, ev("checkout.session.expired", a), NOW)).toBe("already_handled");
    expect((await db.select().from(offer).where(eq(offer.id, off.id)))[0].usedCount).toBe(1);
    const b = await mkOrder({ offerId: off.id });
    expect(await processStripeEvent(db, ev("checkout.session.expired", b), NOW)).toBe("cancelled");
    expect(await get(b.id)).toMatchObject({ status: "cancelled", paymentStatus: "unpaid" });
    expect((await db.select().from(offer).where(eq(offer.id, off.id)))[0].usedCount).toBe(0);
  });

  it("payment arriving for an already-cancelled order is recorded and flagged, not reinstated", async () => {
    const o = await mkOrder({ status: "cancelled" });
    expect(await processStripeEvent(db, ev("checkout.session.completed", o), NOW)).toBe("paid_but_order_not_pending");
    expect(await get(o.id)).toMatchObject({ status: "cancelled", paymentStatus: "paid" });
  });

  it("records and ignores unrelated event types", async () => {
    const o = await mkOrder();
    expect(await processStripeEvent(db, ev("charge.refunded", o), NOW)).toBe("ignored");
  });

  describe("route", () => {
    const secret = "whsec_test_" + tag;
    const sign = async (body: string, t = Math.floor(Date.now() / 1000)) => {
      const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${t}.${body}`)));
      return `t=${t},v1=${[...mac].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    };
    const post = (body: string, sig: string | null) =>
      POST(new Request("http://x/api/stripe/webhook", { method: "POST", body, headers: sig ? { "stripe-signature": sig } : {} }));

    it("rejects missing/forged/stale signatures and unconfigured secret; accepts a valid one", async () => {
      const o = await mkOrder();
      const body = JSON.stringify(ev("checkout.session.completed", o));
      delete process.env.STRIPE_WEBHOOK_SECRET;
      expect((await post(body, await sign(body))).status).toBe(503);
      process.env.STRIPE_WEBHOOK_SECRET = secret;
      try {
        expect((await post(body, null)).status).toBe(400);
        const genuine = await sign(body);
        // change the last hex digit to a DIFFERENT one (a fixed "0" equals the real signature 1 time in 16)
        const forged = genuine.slice(0, -1) + (genuine.endsWith("0") ? "1" : "0");
        expect(forged).not.toBe(genuine);
        expect((await post(body, forged)).status).toBe(400);
        expect((await post(body + " ", await sign(body))).status).toBe(400); // body altered after signing
        expect((await post(body, await sign(body, Math.floor(Date.now() / 1000) - 3600))).status).toBe(400);
        expect((await get(o.id)).paymentStatus).toBe("unpaid"); // nothing applied yet
        const ok = await post(body, await sign(body));
        expect(ok.status).toBe(200);
        expect((await get(o.id)).paymentStatus).toBe("paid");
        const junk = "not json";
        expect((await post(junk, await sign(junk))).status).toBe(400);
      } finally {
        delete process.env.STRIPE_WEBHOOK_SECRET;
      }
    });
  });
});
