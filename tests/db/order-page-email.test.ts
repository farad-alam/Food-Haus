import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { order, orderItem } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { loadOrderByToken } from "@/lib/order-view";
import { sendOrderEmails } from "@/lib/order-email";
import { newOrderToken } from "@/lib/token";
import type { EmailMessage, EmailSender } from "@/lib/email";

const enabled = !!process.env.DATABASE_URL;
const ids: number[] = [];

describe.skipIf(!enabled)("order page data + emails (real database)", () => {
  const db = enabled ? getDb() : (null as never);

  async function mk(over: Partial<typeof order.$inferInsert> = {}) {
    const [o] = await db
      .insert(order)
      .values({
        token: newOrderToken(),
        idempotencyKey: crypto.randomUUID(),
        type: "delivery",
        paymentMethod: "cash",
        status: "received",
        subtotal: 1598,
        total: 1598,
        customerName: "Test Person",
        phone: "+447123456789",
        email: "customer@example.test",
        address: "1 Secret Street",
        postcode: "LU4 8NU",
        note: "ring bell",
        ...over,
      })
      .returning();
    ids.push(o.id);
    await db.insert(orderItem).values({ orderId: o.id, name: "Classic Burger", unitPrice: 799, quantity: 2, options: [], lineTotal: 1598 });
    return o;
  }
  const recorder = (fail = false) => {
    const sent: EmailMessage[] = [];
    const sender: EmailSender = {
      async send(m) {
        if (fail) throw new Error("boom");
        sent.push(m);
      },
    };
    return { sent, sender };
  };
  afterAll(async () => {
    if (ids.length) {
      await db.delete(orderItem).where(inArray(orderItem.orderId, ids));
      await db.delete(order).where(inArray(order.id, ids));
    }
  });

  it("loadOrderByToken returns the order without any contact details", async () => {
    const o = await mk();
    const v = await loadOrderByToken(db, o.token);
    expect(v).toMatchObject({ number: o.number, total: 1598, items: [{ name: "Classic Burger", quantity: 2 }] });
    const s = JSON.stringify(v);
    for (const secret of ["Test Person", "+447123456789", "customer@example.test", "1 Secret Street", "ring bell", "LU4"]) expect(s).not.toContain(secret);
  });

  it("rejects malformed and unknown tokens without hitting the number", async () => {
    const o = await mk();
    expect(await loadOrderByToken(db, String(o.number))).toBeNull();
    expect(await loadOrderByToken(db, "x".repeat(22))).toBeNull();
    expect(await loadOrderByToken(db, o.token + "A")).toBeNull();
    expect(await loadOrderByToken(db, "' or 1=1 --")).toBeNull();
  });

  it("sends the customer + shop emails once, even when called concurrently", async () => {
    const o = await mk();
    const { sent, sender } = recorder();
    const deps = { db, sender, siteUrl: "https://s.test", shopTo: "shop@example.test" };
    await Promise.all([1, 2, 3].map(() => sendOrderEmails(deps, o.id)));
    expect(sent.map((m) => m.to).sort()).toEqual(["customer@example.test", "shop@example.test"]);
    const shop = sent.find((m) => m.to === "shop@example.test")!;
    expect(shop.text + shop.html).not.toMatch(/customer@example|\+447123|Secret Street|Test Person/);
    expect(sent.find((m) => m.to === "customer@example.test")!.text).toContain(`https://s.test/order/${o.token}`);
    await sendOrderEmails(deps, o.id);
    expect(sent).toHaveLength(2);
  });

  it("does not email orders that are still awaiting payment", async () => {
    const o = await mk({ paymentMethod: "card", status: "pending_payment" });
    const { sent, sender } = recorder();
    await sendOrderEmails({ db, sender, siteUrl: "https://s.test" }, o.id);
    expect(sent).toHaveLength(0);
  });

  it("a failing provider never throws, releases the claim, and a retry then succeeds", async () => {
    const o = await mk();
    const bad = recorder(true);
    await expect(sendOrderEmails({ db, sender: bad.sender, siteUrl: "https://s.test" }, o.id)).resolves.toBeUndefined();
    expect((await db.select().from(order).where(eq(order.id, o.id)))[0].confirmationEmailedAt).toBeNull();
    const good = recorder();
    await sendOrderEmails({ db, sender: good.sender, siteUrl: "https://s.test" }, o.id);
    expect(good.sent).toHaveLength(1);
  });

  it("no configured sender is a quiet no-op", async () => {
    const o = await mk();
    await expect(sendOrderEmails({ db, sender: null, siteUrl: "https://s.test" }, o.id)).resolves.toBeUndefined();
  });
});
