import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { adminSession, adminUser, authEvent, offer, order, orderItem, passwordResetToken, stripeEvent } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { runMaintenance, RETENTION } from "@/lib/maintenance";
import { newOrderToken } from "@/lib/token";
import { POST } from "@/app/api/cron/maintenance/route";

// Real database. Every row carries a random tag and is removed afterwards. Rows
// are AGED by writing old timestamps, never by moving the clock, so other test
// files' fresh rows are untouched.
const enabled = !!process.env.DATABASE_URL;
const tag = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
const MIN = 60_000;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms);

describe.skipIf(!enabled)("maintenance (real database)", () => {
  const db = enabled ? getDb() : (null as never);
  const made = { orders: [] as number[], offers: [] as number[], users: [] as number[] };
  let userId = 0;

  beforeAll(async () => {
    const [u] = await db.insert(adminUser).values({ email: `maint-${tag}@example.test`, passwordHash: "x", role: "kitchen" }).returning({ id: adminUser.id });
    userId = u.id;
    made.users.push(u.id);
  });
  afterAll(async () => {
    if (made.orders.length) {
      await db.delete(orderItem).where(inArray(orderItem.orderId, made.orders));
      await db.delete(order).where(inArray(order.id, made.orders));
    }
    if (made.offers.length) await db.delete(offer).where(inArray(offer.id, made.offers));
    await db.delete(authEvent).where(inArray(authEvent.key, [`maint-old-${tag}`, `maint-new-${tag}`]));
    await db.delete(stripeEvent).where(inArray(stripeEvent.id, [`evt_old_${tag}`, `evt_new_${tag}`]));
    await db.delete(adminUser).where(inArray(adminUser.id, made.users)); // sessions + reset tokens cascade
  });

  async function mkOrder(over: Partial<typeof order.$inferInsert>) {
    const [o] = await db
      .insert(order)
      .values({ token: newOrderToken(), idempotencyKey: crypto.randomUUID(), type: "collection", paymentMethod: "card", status: "pending_payment", subtotal: 1000, total: 1000, customerName: "M", phone: "+447000000003", email: "m@example.test", ...over })
      .returning();
    made.orders.push(o.id);
    return o;
  }
  const get = async (id: number) => (await db.select().from(order).where(eq(order.id, id)))[0];

  it("cancels unpaid card orders older than 45 minutes, frees their promo use, and leaves everything else alone", async () => {
    const [off] = await db.insert(offer).values({ name: `Maint ${tag}`, type: "percentage", value: 10, code: `M${tag}`, usageLimit: 5, usedCount: 2, showOnSite: false }).returning();
    made.offers.push(off.id);
    const stale = await mkOrder({ createdAt: ago(60 * MIN), offerId: off.id });
    const fresh = await mkOrder({ createdAt: ago(10 * MIN) });
    const justUnder = await mkOrder({ createdAt: ago(40 * MIN) });
    const cash = await mkOrder({ createdAt: ago(5 * DAY), paymentMethod: "cash", status: "received" });
    const paid = await mkOrder({ createdAt: ago(5 * DAY), status: "received", paymentStatus: "paid" });

    const r = await runMaintenance(db, new Date());
    expect(r.ok).toBe(true);
    expect(r.expiredOrders).toBeGreaterThanOrEqual(1);
    expect((await get(stale.id)).status).toBe("cancelled");
    expect((await db.select().from(offer).where(eq(offer.id, off.id)))[0].usedCount).toBe(1); // promo use released
    expect((await get(fresh.id)).status).toBe("pending_payment"); // still payable
    expect((await get(justUnder.id)).status).toBe("pending_payment"); // inside the 45-minute window
    expect((await get(cash.id)).status).toBe("received"); // cash orders are never expired
    expect((await get(paid.id)).status).toBe("received"); // paid orders are never expired

    // running again changes nothing (and does not release the promo twice)
    await runMaintenance(db, new Date());
    expect((await db.select().from(offer).where(eq(offer.id, off.id)))[0].usedCount).toBe(1);
    expect((await get(stale.id)).status).toBe("cancelled");
  });

  it("prunes only OLD counters, expired sessions, dead reset links and old Stripe events", async () => {
    await db.insert(authEvent).values([{ key: `maint-old-${tag}`, at: ago(RETENTION.authEventsMs + DAY) }, { key: `maint-new-${tag}`, at: ago(10 * MIN) }]);
    await db.insert(adminSession).values([
      { tokenHash: `old-${tag}`, userId, createdAt: ago(10 * DAY), lastSeenAt: ago(10 * DAY), expiresAt: ago(RETENTION.sessionsMs + DAY) },
      { tokenHash: `live-${tag}`, userId, createdAt: ago(MIN), lastSeenAt: ago(MIN), expiresAt: new Date(Date.now() + DAY) },
      { tokenHash: `justexpired-${tag}`, userId, createdAt: ago(DAY), lastSeenAt: ago(DAY), expiresAt: ago(MIN) }, // expired but within the grace day
    ]);
    await db.insert(passwordResetToken).values([
      { tokenHash: `old-${tag}`, userId, expiresAt: ago(RETENTION.resetTokensMs + DAY), usedAt: ago(3 * DAY) },
      { tokenHash: `live-${tag}`, userId, expiresAt: new Date(Date.now() + 20 * MIN), usedAt: null },
    ]);
    await db.insert(stripeEvent).values([
      { id: `evt_old_${tag}`, type: "x", processedAt: ago(RETENTION.stripeEventsMs + DAY) },
      { id: `evt_new_${tag}`, type: "x", processedAt: ago(DAY) },
    ]);

    const r = await runMaintenance(db, new Date());
    expect(r.ok).toBe(true);
    expect(r.prunedAuthEvents).toBeGreaterThanOrEqual(1);
    expect(r.prunedSessions).toBeGreaterThanOrEqual(1);
    expect(r.prunedResetTokens).toBeGreaterThanOrEqual(1);
    expect(r.prunedStripeEvents).toBeGreaterThanOrEqual(1);

    const events = (await db.select().from(authEvent).where(inArray(authEvent.key, [`maint-old-${tag}`, `maint-new-${tag}`]))).map((e) => e.key);
    expect(events).toEqual([`maint-new-${tag}`]);
    const sessions = (await db.select().from(adminSession).where(eq(adminSession.userId, userId))).map((s) => s.tokenHash).sort();
    expect(sessions).toEqual([`justexpired-${tag}`, `live-${tag}`]); // a live session is never touched
    const resets = (await db.select().from(passwordResetToken).where(eq(passwordResetToken.userId, userId))).map((t) => t.tokenHash);
    expect(resets).toEqual([`live-${tag}`]); // an unused, unexpired reset link survives
    const evts = (await db.select().from(stripeEvent).where(inArray(stripeEvent.id, [`evt_old_${tag}`, `evt_new_${tag}`]))).map((e) => e.id);
    expect(evts).toEqual([`evt_new_${tag}`]);
  });

  describe("the HTTP endpoint", () => {
    const secret = `cron-secret-${tag}-xxxxxxxx`;
    const call = (headers: Record<string, string> = {}, method = "POST") => POST(new Request("http://localhost:3000/api/cron/maintenance", { method, headers }));
    let saved: string | undefined;
    beforeAll(() => { saved = process.env.CRON_SECRET; });
    afterAll(() => { if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved; });

    it("refuses everything when no secret is configured (or a short one), so it cannot be left open", async () => {
      delete process.env.CRON_SECRET;
      expect((await call({ authorization: "Bearer anything-at-all-here" })).status).toBe(503);
      process.env.CRON_SECRET = "short";
      expect((await call({ authorization: "Bearer short" })).status).toBe(503);
    });

    it("rejects missing, wrong and malformed credentials, and does no work", async () => {
      process.env.CRON_SECRET = secret;
      const stale = await mkOrder({ createdAt: ago(90 * MIN) });
      for (const headers of [{}, { authorization: "" }, { authorization: secret }, { authorization: `Basic ${secret}` }, { authorization: `Bearer ${secret}x` }, { authorization: `Bearer ${secret.slice(0, -1)}` }, { authorization: "Bearer " }] as Record<string, string>[]) {
        expect([JSON.stringify(headers), (await call(headers)).status]).toEqual([JSON.stringify(headers), 401]);
      }
      expect((await get(stale.id)).status).toBe("pending_payment"); // nothing ran
    });

    it("runs the job with the right secret and reports counts only (no customer data)", async () => {
      process.env.CRON_SECRET = secret;
      const stale = await mkOrder({ createdAt: ago(90 * MIN) });
      const res = await call({ authorization: `Bearer ${secret}` });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, errors: [] });
      expect(Object.keys(body).sort()).toEqual(["dailyReports", "errors", "expiredOrders", "ok", "prunedAuthEvents", "prunedResetTokens", "prunedSessions", "prunedStripeEvents"]);
      expect(Array.isArray(body.dailyReports)).toBe(true);
      expect((await get(stale.id)).status).toBe("cancelled");
    });
  });
});
