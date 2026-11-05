import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { order, orderItem } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { newOrderToken } from "@/lib/token";
import { anonymiseOldOrders, retentionCutoff } from "@/lib/retention";
import { loadOrderDetail, searchHistory } from "@/lib/admin/history";

// Real database. Only its own (tagged) rows are touched or asserted on.
const enabled = !!process.env.DATABASE_URL;
const tag = crypto.randomUUID().slice(0, 8);
const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const ids: number[] = [];

describe.skipIf(!enabled)("12-month contact clean-up (real database)", () => {
  const db = enabled ? getDb() : (null as never);
  afterAll(async () => {
    if (ids.length) {
      await db.delete(orderItem).where(inArray(orderItem.orderId, ids));
      await db.delete(order).where(inArray(order.id, ids));
    }
  });
  async function mk(age: number, over: Partial<typeof order.$inferInsert> = {}) {
    const [o] = await db
      .insert(order)
      .values({
        token: newOrderToken(), idempotencyKey: crypto.randomUUID(), type: "delivery", paymentMethod: "cash", status: "completed", paymentStatus: "unpaid",
        subtotal: 1500, deliveryFee: 300, discount: 100, total: 1700, customerName: `Ret ${tag}`, phone: "+447700900123", email: `ret-${tag}@example.test`,
        address: "1 Test Road", postcode: "LU1 1AA", note: "ring twice", ipHash: "abc123", createdAt: daysAgo(age), ...over,
      })
      .returning();
    ids.push(o.id);
    await db.insert(orderItem).values({ orderId: o.id, name: "Wings", unitPrice: 1500, quantity: 1, options: [], lineTotal: 1500 });
    return o;
  }
  const get = async (id: number) => (await db.select().from(order).where(eq(order.id, id)))[0];

  it("wipes personal fields on old orders, keeps everything else, and leaves recent orders alone", async () => {
    const old = await mk(400);
    const edge = await mk(364); // just inside the 12 months
    const justOver = await mk(367);
    const stuck = await mk(500, { status: "received" }); // an old order never closed is still anonymised
    await anonymiseOldOrders(db, NOW, { limit: 1000 }); // (the scheduled job in another test file may get there first; only our own rows are asserted)
    for (const id of [old.id, justOver.id, stuck.id]) {
      const o = await get(id);
      expect(o).toMatchObject({ customerName: "Anonymised", phone: "", email: "", address: null, postcode: null, note: null, ipHash: null });
      expect(o.anonymisedAt).not.toBeNull();
    }
    const before = old;
    const after = await get(old.id);
    expect([after.total, after.subtotal, after.deliveryFee, after.discount, after.status, after.type, after.paymentMethod, after.token, after.number, after.createdAt.getTime()]).toEqual(
      [before.total, before.subtotal, before.deliveryFee, before.discount, before.status, before.type, before.paymentMethod, before.token, before.number, before.createdAt.getTime()],
    );
    expect((await db.select().from(orderItem).where(eq(orderItem.orderId, old.id))).length).toBe(1); // items stay
    const kept = await get(edge.id);
    expect(kept).toMatchObject({ customerName: `Ret ${tag}`, phone: "+447700900123", address: "1 Test Road", anonymisedAt: null });
  });

  it("is repeatable: a second run does not touch orders again", async () => {
    const o = await mk(800);
    await anonymiseOldOrders(db, NOW, { limit: 1000 });
    const first = (await get(o.id)).anonymisedAt!;
    await anonymiseOldOrders(db, new Date(NOW.getTime() + 60_000), { limit: 1000 });
    expect((await get(o.id)).anonymisedAt!.getTime()).toBe(first.getTime());
  });

  it("never anonymises more than the batch limit in one run", async () => {
    const a = await mk(900), b = await mk(901);
    await anonymiseOldOrders(db, NOW, { limit: 1000 }); // clear any others first
    await db.update(order).set({ anonymisedAt: null, customerName: "x" }).where(inArray(order.id, [a.id, b.id]));
    expect(await anonymiseOldOrders(db, NOW, { limit: 1 })).toBeLessThanOrEqual(1);
  });

  it("anonymised orders can no longer be found by name, phone or email, but still show in history with totals", async () => {
    const o = await mk(300, { // recent now, so a concurrent clean-up cannot take it before we search
       customerName: `Findable ${tag}`, email: `find-${tag}@example.test` });
    const found = await searchHistory(db, { q: `Findable ${tag}` } as never);
    expect(JSON.stringify(found)).toContain(String(o.number));
    await db.update(order).set({ createdAt: daysAgo(450) }).where(eq(order.id, o.id));
    await anonymiseOldOrders(db, NOW, { limit: 1000 });
    expect(JSON.stringify(await searchHistory(db, { q: `Findable ${tag}` } as never))).not.toContain(String(o.number));
    expect(JSON.stringify(await searchHistory(db, { q: `find-${tag}@example.test` } as never))).not.toContain(String(o.number));
    const detail = await loadOrderDetail(db, o.number!);
    expect(detail).toMatchObject({ total: 1700, customerName: "Anonymised", phone: "", email: "", address: null });
    expect(detail!.anonymisedAt).not.toBeNull();
  });

  it("uses a 12 month cutoff", () => {
    expect(retentionCutoff(new Date("2026-11-05T00:00:00Z")).toISOString().slice(0, 10)).toBe("2025-11-05");
  });
});
