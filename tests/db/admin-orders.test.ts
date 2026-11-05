import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { adminUser, auditLog, offer, order, orderItem } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { applyOrderAction, loadBoard } from "@/lib/admin/orders";
import { newOrderToken } from "@/lib/token";

const enabled = !!process.env.DATABASE_URL;
const NOW = new Date();
const made = { orders: [] as number[], offers: [] as number[], users: [] as number[] };

describe.skipIf(!enabled)("order board data + actions (real database)", () => {
  const db = enabled ? getDb() : (null as never);
  let userId = 0;
  const ready = (async () => {
    const [u] = await db.insert(adminUser).values({ email: `board-${crypto.randomUUID()}@example.test`, passwordHash: "x", role: "kitchen" }).returning({ id: adminUser.id });
    userId = u.id;
    made.users.push(u.id);
  })();

  async function mk(over: Partial<typeof order.$inferInsert> = {}) {
    const [o] = await db
      .insert(order)
      .values({
        token: newOrderToken(),
        idempotencyKey: crypto.randomUUID(),
        type: "collection",
        paymentMethod: "cash",
        status: "received",
        subtotal: 1500,
        total: 1500,
        customerName: "Board Test",
        phone: "+447000000001",
        email: "board@example.test",
        ...over,
      })
      .returning();
    made.orders.push(o.id);
    await db.insert(orderItem).values({ orderId: o.id, name: "Classic Burger", unitPrice: 750, quantity: 2, options: [{ name: "Meal", priceChange: 349 }], lineTotal: 1500 });
    return o;
  }
  const get = async (id: number) => (await db.select().from(order).where(eq(order.id, id)))[0];
  const act = (orderId: number, action: Parameters<typeof applyOrderAction>[1]["action"], extra: Partial<Parameters<typeof applyOrderAction>[1]> = {}) =>
    applyOrderAction(db, { orderId, action, userId, now: NOW, ...extra });

  afterAll(async () => {
    if (made.orders.length) {
      await db.delete(orderItem).where(inArray(orderItem.orderId, made.orders));
      await db.delete(order).where(inArray(order.id, made.orders));
    }
    if (made.offers.length) await db.delete(offer).where(inArray(offer.id, made.offers));
    if (made.users.length) {
      await db.delete(auditLog).where(inArray(auditLog.userId, made.users));
      await db.delete(adminUser).where(inArray(adminUser.id, made.users));
    }
  });

  it("collection: received -> preparing -> ready -> completed, with audit entries", async () => {
    await ready;
    const o = await mk();
    expect(await act(o.id, "accept", { prepMinutes: 20 })).toMatchObject({ ok: true, status: "preparing" });
    expect(await get(o.id)).toMatchObject({ status: "preparing", prepMinutes: 20 });
    expect(await act(o.id, "ready")).toMatchObject({ ok: true, status: "ready" });
    expect(await act(o.id, "completed")).toMatchObject({ ok: true, status: "completed" });
    const log = await db.select().from(auditLog).where(eq(auditLog.entity, `order:${o.id}`));
    expect(log.map((l) => l.action).sort()).toEqual(["order.accept", "order.completed", "order.ready"]);
    expect(log.every((l) => l.userId === userId)).toBe(true);
  });

  it("delivery goes through out_for_delivery; collection cannot", async () => {
    await ready;
    const d = await mk({ type: "delivery", address: "1 St", postcode: "LU4 8NU" });
    await act(d.id, "accept", { prepMinutes: 15 });
    await act(d.id, "ready");
    expect(await act(d.id, "completed")).toMatchObject({ ok: false, code: "BAD_TRANSITION" }); // must go out for delivery first
    expect(await act(d.id, "out_for_delivery")).toMatchObject({ ok: true });
    expect(await act(d.id, "completed")).toMatchObject({ ok: true });
    const c = await mk();
    await act(c.id, "accept", { prepMinutes: 15 });
    await act(c.id, "ready");
    expect(await act(c.id, "out_for_delivery")).toMatchObject({ ok: false, code: "BAD_TRANSITION" });
  });

  it("validates accept (prep time) and reject (reason), and unknown orders", async () => {
    await ready;
    const o = await mk();
    for (const prepMinutes of [undefined, 0, 181, 1.5]) expect(await act(o.id, "accept", { prepMinutes })).toMatchObject({ ok: false, code: "INVALID" });
    expect(await act(o.id, "reject", { reason: "  " })).toMatchObject({ ok: false, code: "INVALID" });
    expect(await act(o.id, "reject", { reason: "x".repeat(201) })).toMatchObject({ ok: false, code: "INVALID" });
    expect(await act(2_000_000_000, "ready")).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect((await get(o.id)).status).toBe("received"); // nothing changed
  });

  it("two tablets tapping Accept at once: exactly one wins, the other is told it moved on, one audit row", async () => {
    await ready;
    const o = await mk();
    const r = await Promise.all([1, 2, 3].map(() => act(o.id, "accept", { prepMinutes: 10 })));
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(r.filter((x) => !x.ok).every((x) => !x.ok && x.code === "BAD_TRANSITION")).toBe(true);
    const log = await db.select().from(auditLog).where(eq(auditLog.entity, `order:${o.id}`));
    expect(log).toHaveLength(1);
  });

  it("reject stores the customer-visible reason, frees the promo use, and flags paid card orders for refund", async () => {
    await ready;
    const [off] = await db.insert(offer).values({ name: "t", type: "percentage", value: 10, code: `B${crypto.randomUUID().slice(0, 8)}`, usageLimit: 5, usedCount: 3, showOnSite: false }).returning();
    made.offers.push(off.id);
    const cash = await mk({ offerId: off.id });
    expect(await act(cash.id, "reject", { reason: "Out of chicken" })).toMatchObject({ ok: true, status: "rejected", refundNeeded: false });
    expect(await get(cash.id)).toMatchObject({ status: "rejected", rejectionReason: "Out of chicken" });
    expect((await db.select().from(offer).where(eq(offer.id, off.id)))[0].usedCount).toBe(2);
    // a second reject is a no-op: the promo is not released twice
    expect(await act(cash.id, "reject", { reason: "again" })).toMatchObject({ ok: false });
    expect((await db.select().from(offer).where(eq(offer.id, off.id)))[0].usedCount).toBe(2);

    const paid = await mk({ paymentMethod: "card", paymentStatus: "paid" });
    expect(await act(paid.id, "reject", { reason: "Closing" })).toMatchObject({ ok: true, refundNeeded: true });
  });

  it("an unpaid card order (pending_payment) cannot be acted on from the board", async () => {
    await ready;
    const p = await mk({ paymentMethod: "card", status: "pending_payment" });
    for (const a of ["accept", "ready", "completed"] as const) expect(await act(p.id, a, { prepMinutes: 10 })).toMatchObject({ ok: false, code: "BAD_TRANSITION" });
    expect((await get(p.id)).status).toBe("pending_payment");
  });

  it("board lists active + recently finished orders with items, never unpaid/pending ones", async () => {
    await ready;
    const live = await mk();
    const pending = await mk({ paymentMethod: "card", status: "pending_payment" });
    const old = await mk({ status: "completed", updatedAt: new Date(NOW.getTime() - 5 * 3_600_000) });
    const fresh = await mk({ status: "completed", updatedAt: NOW });
    const b = await loadBoard(db, NOW);
    const ids = (xs: { id: number }[]) => xs.map((x) => x.id);
    expect(ids(b.active)).toContain(live.id);
    expect(ids(b.active)).not.toContain(pending.id);
    expect([...ids(b.active), ...ids(b.recent)]).not.toContain(pending.id);
    expect(ids(b.recent)).toContain(fresh.id);
    expect(ids(b.recent)).not.toContain(old.id); // older than 3 hours
    const card = b.active.find((o) => o.id === live.id)!;
    expect(card.items).toEqual([{ name: "Classic Burger", quantity: 2, options: [{ name: "Meal", priceChange: 349 }] }]);
    expect(b.defaultPrepMinutes).toBeGreaterThan(0);
  });
});
