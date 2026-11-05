import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";
import { adminUser, auditLog, offer, order, orderItem } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { createAdminUser } from "@/lib/auth/pg-store";
import { generateToken, hashToken } from "@/lib/auth/service";
import { adminStore } from "@/lib/admin/guard";
import { currentTradingDay, loadDashboard } from "@/lib/admin/dashboard";
import { newOrderToken } from "@/lib/token";
import { GET as getHistory } from "@/app/api/admin/history/route";
import { GET as getDetail } from "@/app/api/admin/history/[number]/route";
import { GET as getExport } from "@/app/api/admin/history/export/route";
import { GET as getDashboard } from "@/app/api/admin/dashboard/route";

// Real handlers + real database. All seeded orders are dated in March/July 2025 and
// carry a random tag in the customer's name, so other test files' orders (2026) can
// never appear in these results, and everything is removed afterwards.
const enabled = !!process.env.DATABASE_URL;
const ORIGIN = "http://localhost:3000";
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(4)));
const tag = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
const at = (iso: string) => new Date(iso);
const daily = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, opensAt: "12:00", closesAt: "23:00" }));

describe.skipIf(!enabled)("order history, export and dashboard (real database)", () => {
  const db = enabled ? getDb() : (null as never);
  let savedKey: string | undefined;
  const users: Record<string, { id: number; cookie: string }> = {};
  const made = { orders: [] as number[], offers: [] as number[] };
  const nums: Record<string, number> = {};

  async function mkUser(role: "manager" | "kitchen") {
    const id = await createAdminUser(db, KEY, { email: `${role}-hist-${tag}@example.test`, passwordHash: "x", role });
    const token = generateToken();
    const now = new Date();
    await adminStore().createSession({ tokenHash: await hashToken(token), userId: id, createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + 3_600_000) });
    users[role] = { id, cookie: `fh_admin=${token}` };
  }
  async function mk(key: string, createdAt: Date, over: Partial<typeof order.$inferInsert> = {}, items: { name: string; quantity: number; lineTotal: number; options?: { name: string; priceChange: number }[] }[] = []) {
    const [o] = await db
      .insert(order)
      .values({
        token: newOrderToken(), idempotencyKey: crypto.randomUUID(), type: "collection", paymentMethod: "cash", status: "completed", subtotal: 1000, total: 1000,
        customerName: `Cust ${tag}`, phone: "+447700900001", email: `c-${tag.toLowerCase()}@example.test`, postcode: "LU4 8NU", createdAt, ...over,
      })
      .returning();
    made.orders.push(o.id);
    nums[key] = o.number!;
    for (const i of items) await db.insert(orderItem).values({ orderId: o.id, name: i.name, unitPrice: Math.round(i.lineTotal / i.quantity), quantity: i.quantity, options: i.options ?? [], lineTotal: i.lineTotal });
    return o;
  }

  beforeAll(async () => {
    savedKey = process.env.SECRET_BOX_KEY;
    process.env.SECRET_BOX_KEY = KEY;
    await mkUser("manager");
    await mkUser("kitchen");
    const [off] = await db.insert(offer).values({ name: `Hist offer ${tag}`, type: "percentage", value: 10, code: `H${tag}`, showOnSite: false }).returning();
    made.offers.push(off.id);
    // Mon 10 Mar .. Wed 12 Mar 2025 (GMT)
    await mk("a", at("2025-03-10T12:30:00Z"), { total: 1598, subtotal: 1598, paymentMethod: "card", paymentStatus: "paid", customerName: `Alice Smith ${tag}`, phone: "+447123456789", email: `alice-${tag.toLowerCase()}@example.test`, note: "No onions", offerId: off.id, discount: 160 }, [{ name: "Classic Burger", quantity: 2, lineTotal: 1598, options: [{ name: "Meal", priceChange: 349 }] }, { name: "Cola", quantity: 1, lineTotal: 150 }]);
    await mk("late", at("2025-03-10T23:30:00Z"), { total: 900, customerName: `Bob Jones ${tag}`, phone: "+447700900002", type: "delivery", status: "received", address: "5 High St, Luton", postcode: "LU1 1AA", deliveryFee: 250 });
    await mk("midnight", at("2025-03-11T00:00:00Z"), { total: 700, customerName: `Carol King ${tag}`, status: "rejected", rejectionReason: "Out of chicken" });
    await mk("c", at("2025-03-11T14:00:00Z"), { total: 1200, paymentMethod: "card", paymentStatus: "paid", status: "cancelled", customerName: `Dave Lee ${tag}` });
    await mk("pct", at("2025-03-12T10:00:00Z"), { total: 500, customerName: `Pct%Test ${tag}` });
    await mk("evil", at("2025-03-12T11:00:00Z"), { total: 600, customerName: `=HYPERLINK("http://evil.example","x") ${tag}`, note: "line one\nline two, with comma", address: "1 \"Quoted\" Road" });
    await mk("summer", at("2025-07-01T11:30:00Z"), { total: 800, customerName: `Summer Sam ${tag}` }); // BST: 12:30 UK time
    // an audit trail for order "a"
    const [a] = await db.select().from(order).where(eq(order.number, nums.a));
    await db.insert(auditLog).values([
      { userId: users.kitchen.id, action: "order.accept", entity: `order:${a.id}`, before: { status: "received" }, after: { status: "preparing", prepMinutes: 20 }, at: at("2025-03-10T12:31:00Z") },
      { userId: users.kitchen.id, action: "order.ready", entity: `order:${a.id}`, before: { status: "preparing" }, after: { status: "ready" }, at: at("2025-03-10T12:50:00Z") },
    ]);
    // 30 orders on 2025-04-02 for pagination
    for (let i = 0; i < 30; i++) await mk(`p${i}`, new Date(Date.UTC(2025, 3, 2, 10, i)), { total: 100 + i, customerName: `Page ${tag}` });
  });
  afterAll(async () => {
    if (made.orders.length) {
      await db.delete(auditLog).where(inArray(auditLog.entity, made.orders.map((id) => `order:${id}`)));
      await db.delete(orderItem).where(inArray(orderItem.orderId, made.orders));
      await db.delete(order).where(inArray(order.id, made.orders));
    }
    if (made.offers.length) await db.delete(offer).where(inArray(offer.id, made.offers));
    await db.delete(auditLog).where(inArray(auditLog.userId, Object.values(users).map((u) => u.id)));
    await db.delete(adminUser).where(inArray(adminUser.id, Object.values(users).map((u) => u.id)));
    if (savedKey === undefined) delete process.env.SECRET_BOX_KEY;
    else process.env.SECRET_BOX_KEY = savedKey;
  });

  const call = (h: (r: Request, c?: never) => Promise<Response>, path: string, who: string | null, headers: Record<string, string> = {}) =>
    h(new Request(`${ORIGIN}${path}`, { headers: { ...(who ? { cookie: users[who].cookie } : {}), ...headers } }));
  const search = async (qs: string) => {
    const r = await call(getHistory, `/api/admin/history?${qs}`, "manager");
    return { status: r.status, body: await r.json() };
  };
  const numbersOf = (body: { rows: { number: number }[] }) => body.rows.map((r) => r.number);
  const MARCH = "from=2025-03-10&to=2025-03-12";

  it("is owner/manager only: no session 401, kitchen 403, on every endpoint", async () => {
    const detailCall = (who: string | null) => getDetail(new Request(`${ORIGIN}/api/admin/history/${nums.a}`, { headers: who ? { cookie: users[who].cookie } : {} }), { params: Promise.resolve({ number: String(nums.a) }) });
    for (const [name, fn] of [
      ["history", (w: string | null) => call(getHistory, `/api/admin/history?${MARCH}`, w)],
      ["detail", detailCall],
      ["export", (w: string | null) => call(getExport, `/api/admin/history/export?${MARCH}`, w)],
      ["dashboard", (w: string | null) => call(getDashboard, "/api/admin/dashboard", w)],
    ] as const) {
      expect([name, (await fn(null)).status]).toEqual([name, 401]);
      expect([name, (await fn("kitchen")).status]).toEqual([name, 403]);
      expect([name, (await fn("manager")).status]).toEqual([name, 200]);
    }
  });

  describe("filters", () => {
    it("date range uses UK calendar days, inclusive of both ends", async () => {
      const day10 = await search("from=2025-03-10&to=2025-03-10");
      expect(numbersOf(day10.body).sort()).toEqual([nums.a, nums.late].sort()); // 23:30 UTC is still the 10th in the UK in March
      const day11 = await search(`from=2025-03-11&to=2025-03-11`);
      expect(numbersOf(day11.body)).toContain(nums.midnight);
      expect(numbersOf(day11.body)).not.toContain(nums.late);
      // BST: 11:30 UTC on 1 Jul is 12:30 UK on 1 Jul; a window ending the previous day excludes it
      expect(numbersOf((await search("from=2025-07-01&to=2025-07-01")).body)).toContain(nums.summer);
      expect(numbersOf((await search("from=2025-06-01&to=2025-06-30")).body)).not.toContain(nums.summer);
    });
    it("status, payment and type filters combine", async () => {
      const mine = (qs: string) => search(`${MARCH}&q=${tag}&${qs}`);
      expect(numbersOf((await mine("status=rejected")).body)).toEqual([nums.midnight]);
      expect(numbersOf((await mine("status=received,rejected")).body).sort()).toEqual([nums.late, nums.midnight].sort());
      expect(numbersOf((await mine("payment=card")).body).sort()).toEqual([nums.a, nums.c].sort());
      expect(numbersOf((await mine("type=delivery")).body)).toEqual([nums.late]);
      expect(numbersOf((await mine("payment=card&status=completed")).body)).toEqual([nums.a]);
    });
    it("rejects bad filters and unknown parameters with a clear message", async () => {
      for (const qs of ["from=2025-02-30", "from=yesterday", "from=2025-03-12&to=2025-03-10", "status=teleported", "status=received,nope", "payment=bitcoin", "type=flying", `q=${"x".repeat(81)}`, "page=0", "page=abc", "sort=price", "from='; drop table order;--"]) {
        const r = await search(qs);
        expect([qs, r.status]).toEqual([qs, 400]);
        expect(r.body.message.length).toBeGreaterThan(3);
      }
    });
    it("an empty form field means no filter", async () => {
      const r = await search(`${MARCH}&status=&payment=&type=&q=&page=`);
      expect(r.status).toBe(200);
    });
  });

  describe("search", () => {
    const find = async (q: string) => numbersOf((await search(`${MARCH}&q=${encodeURIComponent(q)}`)).body);
    it("by order number, with or without #", async () => {
      expect(await find(String(nums.a))).toContain(nums.a);
      expect(await find(`#${nums.a}`)).toContain(nums.a);
    });
    it("by name (any case, partial), email and postcode", async () => {
      expect(await find(`alice smith ${tag.toLowerCase()}`)).toEqual([nums.a]);
      expect(await find(`ALICE-${tag}`)).toEqual([nums.a]); // email, any case
      expect(await find("LU1 1AA")).toEqual([nums.late]);
    });
    it("by phone in any usual form, or a partial run of digits", async () => {
      for (const q of ["07123456789", "+447123456789", "07123 456 789", "447123456", "123456789"]) expect([q, await find(q)]).toEqual([q, [nums.a]]);
    });
    it("a typed % or _ matches itself, never everything", async () => {
      expect(await find("%")).toEqual([nums.pct]); // only the order whose name contains a literal %
      expect(await find("_")).toEqual([]);
      expect(await find(`Pct%Test ${tag}`)).toEqual([nums.pct]);
    });
    it("SQL in the search box is just text", async () => {
      expect(await find("'; DROP TABLE \"order\"; --")).toEqual([]);
      expect((await search(`${MARCH}&q=${tag}`)).body.total).toBe(7 - 1); // the 6 March orders carrying the tag (the July one is outside)
    });
  });

  it("paginates 25 at a time, newest first, with no overlap, and totals only the accepted orders", async () => {
    const p1 = await search(`from=2025-04-02&to=2025-04-02&q=${tag}`);
    const p2 = await search(`from=2025-04-02&to=2025-04-02&q=${tag}&page=2`);
    const p3 = await search(`from=2025-04-02&to=2025-04-02&q=${tag}&page=3`);
    expect(p1.body).toMatchObject({ total: 30, page: 1, pageSize: 25 });
    expect(p1.body.rows).toHaveLength(25);
    expect(p2.body.rows).toHaveLength(5);
    expect(p3.body.rows).toHaveLength(0);
    const all = [...p1.body.rows, ...p2.body.rows];
    expect(new Set(all.map((r: { id: number }) => r.id)).size).toBe(30); // no duplicates, nothing skipped
    const times = all.map((r: { createdAt: string }) => r.createdAt);
    expect([...times].sort().reverse()).toEqual(times); // newest first
    expect(p1.body.sales).toEqual({ orders: 30, revenue: 30 * 100 + (29 * 30) / 2 });
    // sales ignore rejected / cancelled orders but the list shows them
    const mar = await search(`${MARCH}&q=${tag}`);
    expect(mar.body.total).toBe(6);
    expect(mar.body.sales).toEqual({ orders: 4, revenue: 1598 + 900 + 500 + 600 }); // not Carol (rejected) or Dave (cancelled)
  });

  describe("one order", () => {
    const open = async (n: number | string, who = "manager") => {
      const r = await getDetail(new Request(`${ORIGIN}/api/admin/history/${n}`, { headers: { cookie: users[who].cookie } }), { params: Promise.resolve({ number: String(n) }) });
      return { status: r.status, body: await r.json() };
    };
    it("shows items with options, totals, the offer used, customer details and who did what", async () => {
      const { status, body } = await open(nums.a);
      expect(status).toBe(200);
      const o = body.order;
      expect(o).toMatchObject({ number: nums.a, total: 1598, discount: 160, offerName: `Hist offer ${tag}`, customerName: `Alice Smith ${tag}`, phone: "+447123456789", note: "No onions", paymentMethod: "card", paymentStatus: "paid" });
      expect(o.items).toEqual([
        { name: "Classic Burger", quantity: 2, unitPrice: 799, options: [{ name: "Meal", priceChange: 349 }], lineTotal: 1598 },
        { name: "Cola", quantity: 1, unitPrice: 150, options: [], lineTotal: 150 },
      ]);
      expect(o.trail.map((t: { action: string }) => t.action)).toEqual(["order.accept", "order.ready"]);
      expect(o.trail[0]).toMatchObject({ by: `kitchen-hist-${tag.toLowerCase()}@example.test`, // emails are stored lower-case
         after: { status: "preparing", prepMinutes: 20 } });
    });
    it("shows the delivery address and the rejection reason", async () => {
      expect((await open(nums.late)).body.order).toMatchObject({ address: "5 High St, Luton", postcode: "LU1 1AA", deliveryFee: 250 });
      expect((await open(nums.midnight)).body.order.rejectionReason).toBe("Out of chicken");
    });
    it("unknown and malformed numbers are 404", async () => {
      for (const n of [2_000_000_000, "abc", "12abc", "-1", "1.5"]) expect([n, (await open(n)).status]).toEqual([n, 404]);
    });
  });

  describe("CSV export", () => {
    const csv = async (qs: string, headers: Record<string, string> = {}) => {
      const r = await call(getExport, `/api/admin/history/export?${qs}`, "manager", headers);
      return { r, text: await r.text() };
    };
    const lines = (t: string) => t.replace(/^﻿/, "").split("\r\n").filter(Boolean);

    it("downloads a CSV with a BOM, a header, one row per order, and the right file headers", async () => {
      const { r, text } = await csv(`${MARCH}&q=${tag}`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(r.headers.get("content-disposition")).toMatch(/^attachment; filename="food-haus-orders-\d{4}-\d{2}-\d{2}\.csv"$/);
      expect(r.headers.get("cache-control")).toBe("no-store");
      // Response.text() removes a byte-order mark by spec, so check the raw bytes: EF BB BF
      const bytes = new Uint8Array(await (await call(getExport, `/api/admin/history/export?${MARCH}&q=${tag}`, "manager")).arrayBuffer());
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(text.startsWith("Order number,Date,Time,")).toBe(true);
      expect(lines(text)).toHaveLength(1 + 6);
    });
    it("formats money in pounds, dates in UK time, and summarises items with options", async () => {
      const row = lines((await csv(`from=2025-03-10&to=2025-03-10&q=alice`)).text)[1];
      expect(row).toContain(`${nums.a},2025-03-10,12:30,collection,completed,card,paid,15.98,0.00,1.60,15.98,Alice Smith ${tag}`);
      expect(row).toContain("2 x Classic Burger (Meal); 1 x Cola");
      const summer = lines((await csv(`from=2025-07-01&to=2025-07-01&q=${tag}`)).text)[1];
      expect(summer).toContain(`${nums.summer},2025-07-01,12:30,`); // BST: 11:30 UTC shows as 12:30
    });
    it("neutralises formulas and keeps one order per row even with line breaks, commas and quotes", async () => {
      const text = (await csv(`from=2025-03-12&to=2025-03-12&q=${encodeURIComponent("HYPERLINK")}`)).text;
      const rows = lines(text);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toContain(`"'=HYPERLINK(""http://evil.example"",""x"") ${tag}"`); // apostrophe stops it running as a formula
      expect(rows[1]).toContain("line one line two, with comma".replace(/.*/, '"line one line two, with comma"'));
      expect(rows[1]).toContain('"1 ""Quoted"" Road"');
    });
    it("honours the same filters as the screen", async () => {
      expect(lines((await csv(`${MARCH}&q=${tag}&status=rejected`)).text)).toHaveLength(2);
      expect(lines((await csv(`${MARCH}&q=${tag}&payment=card`)).text)).toHaveLength(3);
    });
    it("writes every download to the audit log with the filters and row count, and no customer data", async () => {
      await csv(`${MARCH}&q=${tag}&payment=card`);
      const logs = (await db.select().from(auditLog).where(eq(auditLog.action, "orders.export")).orderBy(asc(auditLog.id))).filter((l) => (l.after as { filters?: { q?: string } })?.filters?.q === tag);
      expect(logs.length).toBeGreaterThanOrEqual(1);
      const last = logs[logs.length - 1];
      expect(last.userId).toBe(users.manager.id);
      expect(last.after).toMatchObject({ rows: 2, filters: { payment: "card" } });
      expect(JSON.stringify(last.after)).not.toMatch(/Alice|447123|@example/);
    });
    it("refuses a download triggered from another site, and bad filters", async () => {
      expect((await csv(`${MARCH}`, { "sec-fetch-site": "cross-site" })).r.status).toBe(403);
      expect((await csv("from=nope")).r.status).toBe(400);
      expect((await csv(`${MARCH}`, { "sec-fetch-site": "same-origin" })).r.status).toBe(200);
    });
  });

  describe("dashboard", () => {
    it("works out which trading day 'now' belongs to, including after midnight on an overnight shift", () => {
      const fri = [{ weekday: 5, opensAt: "17:00", closesAt: "02:00" }, { weekday: 6, opensAt: "17:00", closesAt: "02:00" }];
      expect(currentTradingDay(fri, at("2025-03-14T22:00:00Z"))).toBe("2025-03-14"); // Friday evening
      expect(currentTradingDay(fri, at("2025-03-15T01:00:00Z"))).toBe("2025-03-14"); // 1am Saturday: still Friday's shift
      expect(currentTradingDay(fri, at("2025-03-15T02:00:00Z"))).toBe("2025-03-15"); // 2am: Saturday's period begins
      expect(currentTradingDay(daily, at("2025-03-12T20:00:00Z"))).toBe("2025-03-12");
    });
    it("returns today so far and the last 7 trading days that add up", async () => {
      const d = await loadDashboard(db, at("2025-03-12T20:00:00Z"), daily);
      expect(d.days.map((x) => x.day)).toEqual(["2025-03-06", "2025-03-07", "2025-03-08", "2025-03-09", "2025-03-10", "2025-03-11", "2025-03-12"]);
      const byDay = Object.fromEntries(d.days.map((x) => [x.day, x]));
      // 10 Mar: Alice 1598 (completed) + Bob 900 (received) ; 11 Mar: Carol rejected, Dave cancelled -> none ; 12 Mar: Pct 500 + Evil 600
      expect(byDay["2025-03-10"]).toMatchObject({ orders: 2, revenue: 2498 });
      expect(byDay["2025-03-11"]).toMatchObject({ orders: 0, revenue: 0 });
      expect(byDay["2025-03-12"]).toMatchObject({ orders: 2, revenue: 1100 });
      expect(d.today).toMatchObject({ day: "2025-03-12" });
      expect(d.today.totals).toMatchObject({ orders: 2, revenue: 1100, cash: { orders: 2, revenue: 1100 } });
      expect(d.week.orders).toBe(d.days.reduce((n, x) => n + x.orders, 0));
      expect(d.week.revenue).toBe(d.days.reduce((n, x) => n + x.revenue, 0));
      expect(d.week.bestDay?.day).toBe("2025-03-10");
      expect(d.week.averagePerDay).toBe(Math.round(d.week.revenue / 7));
    });
    it("matches the daily email's totals exactly (same boundaries, same numbers)", async () => {
      const { loadDayTotals } = await import("@/lib/sales-report-job");
      const email = await loadDayTotals(db, "2025-03-10", daily);
      const d = await loadDashboard(db, at("2025-03-12T20:00:00Z"), daily);
      expect(d.days.find((x) => x.day === "2025-03-10")).toMatchObject({ orders: email.totals.orders, revenue: email.totals.revenue });
    });
    it("the endpoint carries totals only", async () => {
      const r = await call(getDashboard, "/api/admin/dashboard", "manager");
      const body = await r.json();
      expect(body).toMatchObject({ ok: true });
      expect(body.days).toHaveLength(7);
      expect(JSON.stringify(body)).not.toMatch(/Alice|447123|@example|High St/);
    });
  });
});
