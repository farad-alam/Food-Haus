import { afterAll, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import { authEvent } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { loadMenuRows } from "@/lib/db/menu-repo";
import { rowsToMenu } from "@/lib/menu-model";
import { quoteOrder, type QuoteDeps } from "@/lib/quote-service";
import { createOrder } from "@/lib/checkout-service";
import { checkoutSchema, quoteSchema } from "@/lib/checkout-schema";
import { ipHash } from "@/lib/checkout-service";
import { PROMO_FAIL_LIMIT } from "@/lib/promo-throttle";
import type { CheckoutContext } from "@/lib/checkout-service";

const enabled = !!process.env.DATABASE_URL;
const NOW = new Date("2026-11-04T15:00:00Z");
const keyMaterial = "q".repeat(32);
const ipsUsed: string[] = [];

describe("quoteSchema", () => {
  it("is strict: no personal data and no client-sent prices", () => {
    const base = { items: [{ itemId: "a", quantity: 1 }], orderType: "collection", paymentMethod: "cash" };
    expect(quoteSchema.safeParse(base).success).toBe(true);
    expect(quoteSchema.safeParse({ ...base, total: 1 }).success).toBe(false);
    expect(quoteSchema.safeParse({ ...base, name: "x" }).success).toBe(false);
    expect(quoteSchema.safeParse({ ...base, items: [] }).success).toBe(false);
  });
});

describe.skipIf(!enabled)("quoteOrder (real database)", () => {
  const db = enabled ? getDb() : (null as never);
  let ctx: CheckoutContext;
  let item = { id: "", price: 0 };
  const setup = (async () => {
    const menu = rowsToMenu(await loadMenuRows(db));
    const i = menu.categories[0].items.find((x) => !x.soldOut)!;
    item = { id: i.id, price: i.price };
    ctx = {
      menu,
      zones: [{ district: "LU4", fee: 250, minOrder: 5000, estimatedMinutes: 40, active: true }],
      offers: [],
      hours: Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt: "00:00", closesAt: "23:59" })),
      closures: [],
      settings: { paused: false, pausedMessage: null, cashMaxPence: null, cashDailyCapPerPhone: 3, cashDailyCapPerIp: 5 },
    };
  })();
  const deps = (over: Partial<QuoteDeps> = {}): QuoteDeps => ({ db, now: NOW, clientIp: null, loadContext: async () => ctx, ...over });
  const q = (over: Record<string, unknown> = {}) =>
    quoteSchema.parse({ items: [{ itemId: item.id, quantity: 2 }], orderType: "collection", paymentMethod: "cash", ...over });

  afterAll(async () => {
    for (const ip of ipsUsed) await db.delete(authEvent).where(like(authEvent.key, `promo:${await ipHash(ip, keyMaterial)}`));
  });

  it("prices a collection order exactly like the server will, without writing anything", async () => {
    await setup;
    const r = await quoteOrder(deps(), q());
    expect(r.body).toMatchObject({ ok: true, open: true, subtotal: item.price * 2, total: item.price * 2, deliveryFee: 0 });
  });

  it("returns zone info (fee, minimum, ETA) for a valid postcode even when below the minimum", async () => {
    await setup;
    const r = await quoteOrder(deps(), q({ orderType: "delivery", postcode: "lu4 8nu" }));
    expect(r.body.zone).toEqual({ district: "LU4", fee: 250, minOrder: 5000, estimatedMinutes: 40 });
    expect(r.body.ok).toBe(false);
    expect(!r.body.ok && r.body.errors[0].code).toBe("BELOW_MIN_ORDER");
  });

  it("reports outside-zone and unknown items as errors with no zone", async () => {
    await setup;
    const out = await quoteOrder(deps(), q({ orderType: "delivery", postcode: "SW1A 1AA" }));
    expect(out.body.zone).toBeNull();
    expect(!out.body.ok && out.body.errors[0].code).toBe("OUTSIDE_ZONE");
    const unk = await quoteOrder(deps(), q({ items: [{ itemId: "nope-nope", quantity: 1 }] }));
    expect(!unk.body.ok && unk.body.errors[0].code).toBe("UNKNOWN_ITEM");
  });

  it("flags closed and paused shops so the form can disable ordering", async () => {
    await setup;
    expect((await quoteOrder(deps({ loadContext: async () => ({ ...ctx, hours: [] }) }), q())).body).toMatchObject({ open: false, closedMessage: expect.stringContaining("closed") });
    const paused = await quoteOrder(deps({ loadContext: async () => ({ ...ctx, settings: { ...ctx.settings, paused: true, pausedMessage: "Back at 6" } }) }), q());
    expect(paused.body).toMatchObject({ open: false, closedMessage: "Back at 6" });
  });

  it("throttles promo-code guessing per client, in both /quote and checkout (R6.14)", async () => {
    await setup;
    const ip = `198.51.100.${Math.floor(Math.random() * 250)}`;
    ipsUsed.push(ip);
    const d = deps({ clientIp: ip, ipHashKey: keyMaterial });
    for (let n = 0; n < PROMO_FAIL_LIMIT; n++) {
      const r = await quoteOrder(d, q({ promoCode: `GUESS${n}` }));
      expect(!r.body.ok && r.body.errors.some((e) => e.code === "PROMO_INVALID")).toBe(true);
      expect(r.status).toBe(200);
    }
    const blocked = await quoteOrder(d, q({ promoCode: "ANOTHER" }));
    expect(blocked.status).toBe(429);
    // Without a promo code the same client is not blocked...
    expect((await quoteOrder(d, q())).status).toBe(200);
    // ...a different client is not blocked...
    expect((await quoteOrder(deps({ clientIp: "198.51.100.251", ipHashKey: keyMaterial }), q({ promoCode: "X" }))).status).toBe(200);
    ipsUsed.push("198.51.100.251");
    // ...and the real checkout endpoint honours the same block, before writing anything.
    const key = crypto.randomUUID();
    const input = checkoutSchema.parse({
      idempotencyKey: key,
      items: [{ itemId: item.id, quantity: 2 }],
      orderType: "collection",
      paymentMethod: "cash",
      name: "T",
      phone: "07123456789",
      email: "t@example.test",
      promoCode: "ANOTHER",
    });
    const r = await createOrder({ db, now: NOW, siteUrl: "https://s.test", clientIp: ip, ipHashKey: keyMaterial, loadContext: async () => ctx }, input);
    expect(r).toMatchObject({ status: 429, body: { code: "PROMO_THROTTLED" } });
  });
});
