import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq, inArray, like } from "drizzle-orm";
import { adminUser, auditLog, category, item, offer, order, orderItem } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { createAdminUser } from "@/lib/auth/pg-store";
import { generateToken, hashToken } from "@/lib/auth/service";
import { adminStore } from "@/lib/admin/guard";
import { loadMenuRows } from "@/lib/db/menu-repo";
import { rowsToMenu } from "@/lib/menu-model";
import { checkoutSchema, quoteSchema } from "@/lib/checkout-schema";
import { createOrder, loadCheckoutContext } from "@/lib/checkout-service";
import { quoteOrder } from "@/lib/quote-service";
import { liveOffers, loadPublicOffers } from "@/lib/offers-public";
import { utcToLondonLocal } from "@/lib/london-time";
import { GET as getOffers, POST as postOffer } from "@/app/api/admin/offers/route";
import { PUT as putOffer, DELETE as deleteOffer } from "@/app/api/admin/offers/[id]/route";

// Real handlers + real database + the real quote and checkout code. Only
// creates offers/categories carrying a random tag and removes them afterwards.
// Offers used here are coded (apply only when the code is typed) or scoped to a
// test category, so they cannot change another test's prices.
const enabled = !!process.env.DATABASE_URL;
const ORIGIN = "http://localhost:3000";
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const tag = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
const j = (r: Response) => r.json();
const HOUR = 3_600_000;
const local = (offsetMs: number) => utcToLondonLocal(new Date(Date.now() + offsetMs));

describe.skipIf(!enabled)("admin offers (real database)", () => {
  const db = enabled ? getDb() : (null as never);
  let savedKey: string | undefined;
  const users: Record<string, { id: number; cookie: string }> = {};
  const madeOrders: number[] = [];
  let itemId = "";
  let itemPrice = 0;

  async function mkUser(role: "manager" | "kitchen") {
    const id = await createAdminUser(db, KEY, { email: `${role}-offers-${tag}@example.test`, passwordHash: "x", role });
    const token = generateToken();
    const now = new Date();
    await adminStore().createSession({ tokenHash: await hashToken(token), userId: id, createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + HOUR) });
    users[role] = { id, cookie: `fh_admin=${token}` };
  }
  beforeAll(async () => {
    savedKey = process.env.SECRET_BOX_KEY;
    process.env.SECRET_BOX_KEY = KEY;
    await mkUser("manager");
    await mkUser("kitchen");
    const menu = rowsToMenu(await loadMenuRows(db));
    const it = menu.categories[0].items.find((i) => !i.soldOut)!;
    itemId = it.id;
    itemPrice = it.price;
  });
  afterAll(async () => {
    const mine = await db.select({ id: offer.id }).from(offer).where(like(offer.name, `%${tag}%`));
    const offerIds = mine.map((o) => o.id);
    const ordersOfMine = offerIds.length ? await db.select({ id: order.id }).from(order).where(inArray(order.offerId, offerIds)) : [];
    const orderIds = [...madeOrders, ...ordersOfMine.map((o) => o.id)];
    if (orderIds.length) {
      await db.delete(orderItem).where(inArray(orderItem.orderId, orderIds));
      await db.delete(order).where(inArray(order.id, orderIds));
    }
    if (offerIds.length) await db.delete(offer).where(inArray(offer.id, offerIds));
    const cats = await db.select({ id: category.id }).from(category).where(like(category.name, `%${tag}%`));
    if (cats.length) {
      await db.delete(item).where(inArray(item.categoryId, cats.map((c) => c.id)));
      await db.delete(category).where(inArray(category.id, cats.map((c) => c.id)));
    }
    const ids = Object.values(users).map((u) => u.id);
    await db.delete(auditLog).where(inArray(auditLog.userId, ids));
    await db.delete(adminUser).where(inArray(adminUser.id, ids));
    if (savedKey === undefined) delete process.env.SECRET_BOX_KEY;
    else process.env.SECRET_BOX_KEY = savedKey;
  });

  const req = (method: string, path: string, who: string | null, body?: unknown, origin: string | null = ORIGIN) =>
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(origin ? { origin } : {}), ...(who ? { cookie: users[who].cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
  const body = (over: Record<string, unknown> = {}) => ({
    name: `Offer ${tag}`, type: "percentage", value: 10, appliesToCategoryId: null, channel: "any", code: null, minSpend: 0, startsAt: null, endsAt: null, usageLimit: null, showOnSite: false, ...over,
  });
  const create = async (over: Record<string, unknown> = {}) => {
    const r = await postOffer(req("POST", "/api/admin/offers", "manager", body(over)));
    expect([r.status, JSON.stringify(over)]).toEqual([201, JSON.stringify(over)]);
    return (await j(r)).id as number;
  };
  const list = async () => j(await getOffers(req("GET", "/api/admin/offers", "manager")));
  // Other test files create offers too, so "nothing changed" is judged on OUR offers only.
  const mineCount = async () => (await list()).offers.filter((o: { name: string }) => o.name.includes(tag)).length;
  const find = async (id: number) => (await list()).offers.find((o: { id: number }) => o.id === id);
  const audits = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action)).orderBy(asc(auditLog.id));

  const q = (over: Record<string, unknown> = {}) => quoteSchema.parse({ items: [{ itemId, quantity: 2 }], orderType: "collection", paymentMethod: "cash", ...over });
  const quote = async (over?: Record<string, unknown>) => (await quoteOrder({ db, now: new Date(), clientIp: null }, q(over))).body; // default loader = the database
  const errCode = (b: Awaited<ReturnType<typeof quote>>) => (!b.ok ? b.errors.map((e) => e.code) : []);

  it("is owner/manager only: no session 401, kitchen 403, cross-site 403, nothing changes", async () => {
    const before = await mineCount();
    const calls: [string, (w: string | null, o?: string | null) => Promise<Response>][] = [
      ["GET", (w) => getOffers(req("GET", "/api/admin/offers", w))],
      ["POST", (w, o) => postOffer(req("POST", "/api/admin/offers", w, body({ name: `Nope ${tag}` }), o))],
      ["PUT", (w, o) => putOffer(req("PUT", "/api/admin/offers/1", w, body(), o), ctx(1))],
      ["DELETE", (w, o) => deleteOffer(req("DELETE", "/api/admin/offers/1", w, undefined, o), ctx(1))],
    ];
    for (const [name, call] of calls) {
      expect([name, (await call(null)).status]).toEqual([name, 401]);
      expect([name, (await call("kitchen")).status]).toEqual([name, 403]);
      if (name !== "GET") expect([name, (await call("manager", "https://evil.example")).status]).toEqual([name, 403]);
    }
    expect(await mineCount()).toBe(before);
  });

  it("rejects invalid offers without writing anything", async () => {
    const before = await mineCount();
    const bads: Record<string, unknown>[] = [
      { value: 0 }, { value: 101 }, { value: null }, { type: "fixed", value: 0 }, { type: "fixed", value: 50_001 },
      { type: "free_delivery", value: null, channel: "collection" }, { type: "free_delivery", value: 100 },
      { type: "bogof", value: null, appliesToCategoryId: null }, { type: "bogof", value: null, appliesToCategoryId: 2_000_000_000 }, { appliesToCategoryId: 1 },
      { code: "ab" }, { code: "has space" }, { code: "x".repeat(21) }, { minSpend: -1 }, { usageLimit: 0 },
      { startsAt: local(2 * HOUR), endsAt: local(HOUR) }, { startsAt: "2026-03-29T01:30" }, { name: "" }, { name: "x".repeat(81) }, { usedCount: 5 }, { id: 1 },
    ];
    for (const b of bads) {
      const r = await postOffer(req("POST", "/api/admin/offers", "manager", body(b)));
      expect([JSON.stringify(b), r.status]).toEqual([JSON.stringify(b), 400]);
    }
    expect(await mineCount()).toBe(before);
  });

  it("promo codes are unique ignoring case, stored upper-case, and checked on edit too", async () => {
    const a = await create({ name: `A ${tag}`, code: `Save${tag}` });
    expect((await find(a)).code).toBe(`SAVE${tag}`);
    const dup = await postOffer(req("POST", "/api/admin/offers", "manager", body({ name: `B ${tag}`, code: `save${tag.toLowerCase()}` })));
    expect(dup.status).toBe(409);
    const b = await create({ name: `B ${tag}`, code: `Other${tag}` });
    expect((await putOffer(req("PUT", `/api/admin/offers/${b}`, "manager", body({ name: `B ${tag}`, code: `SAVE${tag}` })), ctx(b))).status).toBe(409);
    expect((await putOffer(req("PUT", `/api/admin/offers/${a}`, "manager", body({ name: `A ${tag} renamed`, code: `SAVE${tag}` })), ctx(a))).status).toBe(200); // keeping its own code is fine
    expect((await putOffer(req("PUT", "/api/admin/offers/2000000000", "manager", body()), ctx(2_000_000_000))).status).toBe(404);
    expect((await putOffer(req("PUT", "/api/admin/offers/abc", "manager", body()), ctx("abc"))).status).toBe(404);
  });

  describe("saved offers drive the real quote and checkout", () => {
    it("a promo code applies only when typed (any case); a wrong code is refused; the order is otherwise unchanged", async () => {
      await create({ name: `Ten ${tag}`, code: `TEN${tag}` });
      const plain = await quote();
      expect(plain).toMatchObject({ ok: true, discount: 0, total: itemPrice * 2 });
      const withCode = await quote({ promoCode: `ten${tag.toLowerCase()}` });
      expect(withCode).toMatchObject({ ok: true, discount: Math.floor((itemPrice * 2 * 10) / 100), appliedOffer: { name: `Ten ${tag}` } });
      expect(errCode(await quote({ promoCode: `NOPE${tag}` }))).toContain("PROMO_INVALID");
    });

    it("fixed amount, minimum spend, and channel rules", async () => {
      await create({ name: `Fixed ${tag}`, type: "fixed", value: 300, code: `FIX${tag}` });
      expect(await quote({ promoCode: `FIX${tag}` })).toMatchObject({ ok: true, discount: 300 });
      await create({ name: `Big ${tag}`, code: `BIG${tag}`, minSpend: 99_000 });
      expect(errCode(await quote({ promoCode: `BIG${tag}` }))).toContain("PROMO_MIN_SPEND");
      await create({ name: `Deliv ${tag}`, code: `DEL${tag}`, channel: "delivery" });
      expect(errCode(await quote({ promoCode: `DEL${tag}` }))).toContain("PROMO_NOT_APPLICABLE"); // collection order
    });

    it("scheduling: not started, ended, and editing the dates takes effect immediately", async () => {
      const future = await create({ name: `Future ${tag}`, code: `FUT${tag}`, startsAt: local(24 * HOUR), endsAt: local(48 * HOUR) });
      expect((await find(future)).status).toBe("scheduled");
      expect(errCode(await quote({ promoCode: `FUT${tag}` }))).toContain("PROMO_NOT_STARTED");
      const past = await create({ name: `Past ${tag}`, code: `PST${tag}`, startsAt: local(-48 * HOUR), endsAt: local(-2 * HOUR) });
      expect((await find(past)).status).toBe("ended");
      expect(errCode(await quote({ promoCode: `PST${tag}` }))).toContain("PROMO_EXPIRED");
      // extend the ended offer into the future: it works straight away
      expect((await putOffer(req("PUT", `/api/admin/offers/${past}`, "manager", body({ name: `Past ${tag}`, code: `PST${tag}`, startsAt: local(-48 * HOUR), endsAt: local(24 * HOUR) })), ctx(past))).status).toBe(200);
      expect((await find(past)).status).toBe("active");
      expect(await quote({ promoCode: `PST${tag}` })).toMatchObject({ ok: true });
      // "End now"
      expect((await putOffer(req("PUT", `/api/admin/offers/${past}`, "manager", body({ name: `Past ${tag}`, code: `PST${tag}`, startsAt: local(-48 * HOUR), endsAt: local(0) })), ctx(past))).status).toBe(200);
      expect(errCode(await quote({ promoCode: `PST${tag}` }))).toContain("PROMO_EXPIRED");
    });

    it("a usage limit is enforced by checkout, counted on the offer, and a used offer cannot be deleted", async () => {
      const id = await create({ name: `Once ${tag}`, code: `ONE${tag}`, usageLimit: 1 });
      const allDay = Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt: "00:00", closesAt: "23:59" }));
      const loadContext = async (d: typeof db) => {
        const c = await loadCheckoutContext(d);
        return { ...c, hours: allDay, closures: [], settings: { ...c.settings, paused: false } }; // real offers/menu, open shop
      };
      const place = (over: Record<string, unknown> = {}) =>
        createOrder(
          { db, now: new Date(), siteUrl: "https://s.test", clientIp: null, loadContext },
          checkoutSchema.parse({ idempotencyKey: crypto.randomUUID(), items: [{ itemId, quantity: 2 }], orderType: "collection", paymentMethod: "cash", name: "Offer Test", phone: "07123456789", email: `offers-${tag}@example.test`, promoCode: `ONE${tag}`, ...over }),
        );
      const first = await place();
      expect(first).toMatchObject({ status: 201, body: { ok: true } });
      const second = await place();
      expect(second).toMatchObject({ status: 422 });
      const used = await find(id);
      expect(used).toMatchObject({ usedCount: 1, status: "used_up" });
      const [o] = await db.select().from(order).where(eq(order.offerId, id));
      madeOrders.push(o.id);
      expect(o.discount).toBeGreaterThan(0);
      const refused = await deleteOffer(req("DELETE", `/api/admin/offers/${id}`, "manager"), ctx(id));
      expect(refused.status).toBe(400);
      expect((await j(refused)).message).toMatch(/used on 1 order.*End now/);
      expect(await find(id)).toBeTruthy();
    });

    it("an automatic buy-one-get-one on a category applies with no code, only to that category", async () => {
      const [cat] = await db.insert(category).values({ name: `Bogof cat ${tag}`, slug: `bogof-cat-${tag.toLowerCase()}`, sortOrder: 98, visible: true }).returning();
      await db.insert(item).values({ categoryId: cat.id, name: `Bogof item ${tag}`, slug: `bogof-item-${tag.toLowerCase()}`, description: "", price: 650, dietaryTags: [], sortOrder: 1 });
      const id = await create({ name: `Two for one ${tag}`, type: "bogof", value: null, appliesToCategoryId: cat.id, channel: "collection" });
      const bogofItem = `bogof-cat-${tag.toLowerCase()}-bogof-item-${tag.toLowerCase()}`;
      const two = await quote({ items: [{ itemId: bogofItem, quantity: 2 }] });
      expect(two).toMatchObject({ ok: true, discount: 650, total: 650, appliedOffer: { name: `Two for one ${tag}` } });
      expect(await quote({ items: [{ itemId: bogofItem, quantity: 1 }] })).toMatchObject({ ok: true, discount: 0 });
      expect(await quote({ items: [{ itemId, quantity: 2 }] })).toMatchObject({ ok: true, discount: 0 }); // other categories unaffected
      expect(await quote({ items: [{ itemId: bogofItem, quantity: 2 }], orderType: "delivery", postcode: "LU4 8NU" })).toMatchObject({ ok: false }); // (no zone) and no discount path
      expect((await find(id)).appliesToCategory).toBe(`Bogof cat ${tag}`);
    });
  });

  it("public offers: only 'show on website' ones, only while running, with the category name and code", async () => {
    await create({ name: `Hidden ${tag}`, code: `HID${tag}`, showOnSite: false });
    await create({ name: `Shown ${tag}`, code: `SHW${tag}`, showOnSite: true });
    await create({ name: `Soon ${tag}`, showOnSite: true, startsAt: local(24 * HOUR) });
    await create({ name: `Gone ${tag}`, showOnSite: true, startsAt: local(-48 * HOUR), endsAt: local(-HOUR) });
    const all = await loadPublicOffers(db);
    const names = all.map((o) => o.name);
    expect(names).toContain(`Shown ${tag}`);
    expect(names).not.toContain(`Hidden ${tag}`); // never published
    const live = liveOffers(all, new Date()).map((o) => o.name);
    expect(live).toContain(`Shown ${tag}`);
    expect(live).not.toContain(`Soon ${tag}`);
    expect(live).not.toContain(`Gone ${tag}`);
    // time moves on without any admin write: the same cached list turns the future offer live and the live one off
    const later = liveOffers(all, new Date(Date.now() + 36 * HOUR)).map((o) => o.name);
    expect(later).toContain(`Soon ${tag}`);
    expect(all.find((o) => o.name === `Shown ${tag}`)).toMatchObject({ code: `SHW${tag}`, type: "percentage", value: 10 });
  });

  it("delete works for an unused offer, is audited with before/after, and a second delete is a 404", async () => {
    const id = await create({ name: `Temp ${tag}`, code: `TMP${tag}` });
    expect((await deleteOffer(req("DELETE", `/api/admin/offers/${id}`, "manager"), ctx(id))).status).toBe(200);
    expect((await deleteOffer(req("DELETE", `/api/admin/offers/${id}`, "manager"), ctx(id))).status).toBe(404);
    expect(await find(id)).toBeUndefined();
    const del = (await audits("offer.delete")).find((l) => l.entity === `offer:${id}`);
    expect(del).toBeTruthy();
    expect((del!.before as { code: string }).code).toBe(`TMP${tag}`);
    expect(del!.userId).toBe(users.manager.id);
    for (const a of ["offer.create", "offer.update"]) expect((await audits(a)).length).toBeGreaterThanOrEqual(1);
  });
});
