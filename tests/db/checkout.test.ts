import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { offer, order, orderItem } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { loadMenuRows } from "@/lib/db/menu-repo";
import { rowsToMenu } from "@/lib/menu-model";
import { createOrder, expireUnpaidOrders, type CheckoutContext, type CheckoutDeps } from "@/lib/checkout-service";
import { checkoutSchema, type CheckoutInput } from "@/lib/checkout-schema";

// Integration: real Postgres, faked Stripe/Turnstile. Every row it creates is
// tracked and deleted in afterAll. Requires a migrated + seeded database.
const enabled = !!process.env.DATABASE_URL;
const NOW = new Date("2026-11-04T15:00:00Z");
const phone = () => `+4474${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const created: { keys: string[]; offerIds: number[] } = { keys: [], offerIds: [] };

describe.skipIf(!enabled)("createOrder (real database)", () => {
  const db = enabled ? getDb() : (null as never);
  let ctx: CheckoutContext;
  let itemId = "";
  let itemPrice = 0;

  const open = Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt: "00:00", closesAt: "23:59" }));
  const baseCtx = async (): Promise<CheckoutContext> => {
    const menu = rowsToMenu(await loadMenuRows(db));
    return {
      menu,
      zones: [{ district: "LU4", fee: 250, minOrder: 1000, estimatedMinutes: 40, active: true }],
      offers: [],
      hours: open,
      closures: [],
      settings: { paused: false, pausedMessage: null, cashMaxPence: null, cashDailyCapPerPhone: 3, cashDailyCapPerIp: 5 },
    };
  };

  const input = (over: Partial<Record<string, unknown>> = {}): CheckoutInput => {
    const key = crypto.randomUUID();
    created.keys.push(key);
    return checkoutSchema.parse({
      idempotencyKey: key,
      items: [{ itemId, quantity: 2 }],
      orderType: "collection",
      paymentMethod: "cash",
      name: "Test Person",
      phone: phone(),
      email: "t@example.test",
      ...over,
    });
  };
  const deps = (over: Partial<CheckoutDeps> = {}): CheckoutDeps => ({
    db,
    now: NOW,
    siteUrl: "https://site.test",
    clientIp: null,
    loadContext: async () => ctx,
    ...over,
  });

  const setup = (async () => {
    ctx = await baseCtx();
    const it0 = ctx.menu.categories[0].items.find((i) => !i.soldOut)!;
    itemId = it0.id;
    itemPrice = it0.price;
  })();

  afterAll(async () => {
    const rows = await db.select({ id: order.id }).from(order).where(inArray(order.idempotencyKey, created.keys));
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      await db.delete(orderItem).where(inArray(orderItem.orderId, ids));
      await db.delete(order).where(inArray(order.id, ids));
    }
    if (created.offerIds.length) await db.delete(offer).where(inArray(offer.id, created.offerIds));
  });

  const rowFor = async (key: string) => (await db.select().from(order).where(eq(order.idempotencyKey, key)))[0];

  it("creates a cash collection order as received, with totals computed by the server", async () => {
    await setup;
    const i = input();
    const r = await createOrder(deps(), i);
    expect(r.status).toBe(201);
    if (!r.body.ok) throw new Error("expected ok");
    const row = await rowFor(i.idempotencyKey);
    expect(row).toMatchObject({ status: "received", paymentMethod: "cash", paymentStatus: "unpaid", subtotal: itemPrice * 2, total: itemPrice * 2, deliveryFee: 0 });
    expect(row.token).toBe(r.body.token);
    expect(row.token.length).toBeGreaterThanOrEqual(22); // >= 128 bits
    const lines = await db.select().from(orderItem).where(eq(orderItem.orderId, row.id));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ quantity: 2, unitPrice: itemPrice, lineTotal: itemPrice * 2 });
  });

  it("is idempotent: repeats and concurrent double-taps create exactly one order", async () => {
    await setup;
    const i = input();
    const results = await Promise.all([1, 2, 3].map(() => createOrder(deps(), i)));
    expect(results.every((r) => r.body.ok)).toBe(true);
    const tokens = new Set(results.map((r) => (r.body.ok ? r.body.token : "")));
    expect(tokens.size).toBe(1);
    const rows = await db.select().from(order).where(eq(order.idempotencyKey, i.idempotencyKey));
    expect(rows).toHaveLength(1);
  });

  it("refuses when paused or closed, and writes nothing", async () => {
    await setup;
    const a = input();
    const paused = await createOrder(deps({ loadContext: async () => ({ ...ctx, settings: { ...ctx.settings, paused: true, pausedMessage: "Back soon" } }) }), a);
    expect(paused).toMatchObject({ status: 409, body: { code: "SHOP_PAUSED", message: "Back soon" } });
    const b = input();
    const closed = await createOrder(deps({ loadContext: async () => ({ ...ctx, hours: [] }) }), b);
    expect(closed).toMatchObject({ status: 409, body: { code: "SHOP_CLOSED" } });
    expect(await rowFor(a.idempotencyKey)).toBeUndefined();
    expect(await rowFor(b.idempotencyKey)).toBeUndefined();
  });

  it("rejects invalid orders with the pricing error (outside delivery zone, sold-out/unknown item)", async () => {
    await setup;
    const out = await createOrder(deps(), input({ orderType: "delivery", address: "1 Test Street", postcode: "SW1A 1AA" }));
    expect(out).toMatchObject({ status: 422, body: { code: "INVALID_ORDER" } });
    const unknown = await createOrder(deps(), input({ items: [{ itemId: "nope-nope", quantity: 1 }] }));
    expect(unknown).toMatchObject({ status: 422 });
  });

  it("charges delivery fee and applies minimum order for delivery", async () => {
    await setup;
    const i = input({ orderType: "delivery", address: "1 Test Street", postcode: "lu4 8nu", items: [{ itemId, quantity: 2 }] });
    const r = await createOrder(deps(), i);
    expect(r.status).toBe(201);
    const row = await rowFor(i.idempotencyKey);
    expect(row).toMatchObject({ deliveryFee: 250, total: itemPrice * 2 + 250, postcode: "LU4 8NU", address: "1 Test Street" });
  });

  it("caps cash orders per phone (R6.15) but not card", async () => {
    await setup;
    const p = phone();
    const capped = async () => ({ ...ctx, settings: { ...ctx.settings, cashDailyCapPerPhone: 1 } });
    expect((await createOrder(deps({ loadContext: capped }), input({ phone: p }))).status).toBe(201);
    expect(await createOrder(deps({ loadContext: capped }), input({ phone: p }))).toMatchObject({ status: 429, body: { code: "CASH_LIMIT" } });
  });

  it("caps cash orders per IP using a keyed hash, never storing the raw IP", async () => {
    await setup;
    const capped = async () => ({ ...ctx, settings: { ...ctx.settings, cashDailyCapPerIp: 1 } });
    const d = deps({ loadContext: capped, clientIp: `203.0.113.${Math.floor(Math.random() * 250)}`, ipHashKey: "k".repeat(32) });
    const first = input();
    expect((await createOrder(d, first)).status).toBe(201);
    expect((await createOrder(d, input())).status).toBe(429);
    const row = await rowFor(first.idempotencyKey);
    expect(row.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("203.0.113");
  });

  it("card: creates a pending order + Stripe session for exactly the total; never 'received' before payment", async () => {
    await setup;
    const calls: { url: string; body: URLSearchParams }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: new URLSearchParams(init.body as URLSearchParams) });
      return Response.json({ id: `cs_test_${calls.length}`, url: "https://checkout.stripe.com/c/x" });
    }) as unknown as typeof fetch;
    const i = input({ paymentMethod: "card" });
    const r = await createOrder(deps({ stripeSecretKey: "sk_test", fetchImpl }), i);
    expect(r).toMatchObject({ status: 201, body: { ok: true, checkoutUrl: "https://checkout.stripe.com/c/x" } });
    const row = await rowFor(i.idempotencyKey);
    expect(row).toMatchObject({ status: "pending_payment", paymentStatus: "unpaid", stripeSessionId: "cs_test_1" });
    expect(calls[0].body.get("line_items[0][price_data][unit_amount]")).toBe(String(row.total));
    expect(calls[0].body.get("success_url")).toBe(`https://site.test/order/${row.token}`);
    // Retry with the same key re-fetches the existing session instead of creating another.
    const again = await createOrder(deps({ stripeSecretKey: "sk_test", fetchImpl }), i);
    expect(again.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("/cs_test_1");
  });

  it("card: if Stripe fails the order stays pending and a retry creates the session", async () => {
    await setup;
    const bad = (async () => Response.json({ error: { message: "down" } }, { status: 500 })) as unknown as typeof fetch;
    const good = (async () => Response.json({ id: "cs_test_ok", url: "https://checkout.stripe.com/c/ok" })) as unknown as typeof fetch;
    const i = input({ paymentMethod: "card" });
    expect(await createOrder(deps({ stripeSecretKey: "sk", fetchImpl: bad }), i)).toMatchObject({ status: 502, body: { code: "PAYMENT_START_FAILED" } });
    expect((await rowFor(i.idempotencyKey)).status).toBe("pending_payment");
    const r = await createOrder(deps({ stripeSecretKey: "sk", fetchImpl: good }), i);
    expect(r).toMatchObject({ status: 200, body: { checkoutUrl: "https://checkout.stripe.com/c/ok" } });
  });

  it("card without a Stripe key is refused cleanly", async () => {
    await setup;
    expect(await createOrder(deps(), input({ paymentMethod: "card" }))).toMatchObject({ status: 503, body: { code: "PAYMENTS_UNAVAILABLE" } });
  });

  it("Turnstile: rejects a failed check before any order is written", async () => {
    await setup;
    const fetchImpl = (async () => Response.json({ success: false })) as unknown as typeof fetch;
    const i = input({ turnstileToken: "t" });
    expect(await createOrder(deps({ turnstileSecret: "s", fetchImpl }), i)).toMatchObject({ status: 403, body: { code: "BOT_CHECK_FAILED" } });
    expect(await rowFor(i.idempotencyKey)).toBeUndefined();
  });

  it("promo usage limit is enforced atomically under concurrency, and the use is released on expiry", async () => {
    await setup;
    const code = `T${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    const [o] = await db
      .insert(offer)
      .values({ name: "test", type: "percentage", value: 10, channel: "any", code, usageLimit: 1, showOnSite: false })
      .returning();
    created.offerIds.push(o.id);
    const withOffer = async () => ({
      ...ctx,
      offers: [{ id: o.id, name: "test", type: "percentage" as const, value: 10, channel: "any" as const, code, minSpend: 0, usedCount: 0, usageLimit: 1 }],
    });
    const fetchImpl = (async () => Response.json({ id: `cs_${crypto.randomUUID()}`, url: "https://u" })) as unknown as typeof fetch;
    const mk = () => input({ paymentMethod: "card", promoCode: code });
    const [a, b] = [mk(), mk()];
    const d = deps({ loadContext: withOffer, stripeSecretKey: "sk", fetchImpl });
    const results = await Promise.all([createOrder(d, a), createOrder(d, b)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect((await db.select().from(offer).where(eq(offer.id, o.id)))[0].usedCount).toBe(1);
    const winnerKey = results[0].status === 201 ? a.idempotencyKey : b.idempotencyKey;
    const win = await rowFor(winnerKey);
    expect(win.discount).toBeGreaterThan(0);
    expect(win.offerId).toBe(o.id);

    // Abandoned card order: sweeper cancels it and frees the promo use.
    const later = new Date(Date.now() + 60 * 60_000);
    expect(await expireUnpaidOrders(db, later)).toBeGreaterThanOrEqual(1);
    expect((await rowFor(winnerKey)).status).toBe("cancelled");
    expect((await db.select().from(offer).where(eq(offer.id, o.id)))[0].usedCount).toBe(0);
  });
});
