import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { adminUser, auditLog, closure, deliveryZone, openingHours, order, orderItem, settings } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { createAdminUser } from "@/lib/auth/pg-store";
import { generateToken, hashToken } from "@/lib/auth/service";
import { adminStore } from "@/lib/admin/guard";
import { londonParts } from "@/lib/hours";
import { checkoutSchema, quoteSchema } from "@/lib/checkout-schema";
import { createOrder } from "@/lib/checkout-service";
import { quoteOrder } from "@/lib/quote-service";
import { loadMenuRows } from "@/lib/db/menu-repo";
import { rowsToMenu } from "@/lib/menu-model";
import { GET as getSettings } from "@/app/api/admin/settings/route";
import { PUT as putHours } from "@/app/api/admin/settings/hours/route";
import { PUT as putPause } from "@/app/api/admin/settings/pause/route";
import { PUT as putGeneral } from "@/app/api/admin/settings/general/route";
import { POST as postClosure } from "@/app/api/admin/settings/closures/route";
import { DELETE as deleteClosure } from "@/app/api/admin/settings/closures/[id]/route";
import { POST as postZone } from "@/app/api/admin/zones/route";
import { PUT as putZone, DELETE as deleteZone } from "@/app/api/admin/zones/[id]/route";
import { GET as getBoard } from "@/app/api/admin/orders/route";

// Real route handlers + real database. The settings tables are shared, so this
// file snapshots them first and restores them exactly in afterAll.
const enabled = !!process.env.DATABASE_URL;
const ORIGIN = "http://localhost:3000";
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(6)));
const tag = crypto.randomUUID().slice(0, 8);
const j = (res: Response) => res.json();

describe.skipIf(!enabled)("admin settings (real database)", () => {
  const db = enabled ? getDb() : (null as never);
  let savedKey: string | undefined;
  const users: Record<string, { id: number; cookie: string }> = {};
  let snapshot: { s: (typeof settings.$inferSelect)[]; h: (typeof openingHours.$inferSelect)[]; z: (typeof deliveryZone.$inferSelect)[]; c: (typeof closure.$inferSelect)[] };
  const madeOrders: number[] = [];

  async function mkUser(role: "manager" | "kitchen" | "owner") {
    const id = await createAdminUser(db, KEY, { email: `${role}-${tag}@example.test`, passwordHash: "x", role });
    const token = generateToken();
    const now = new Date();
    await adminStore().createSession({ tokenHash: await hashToken(token), userId: id, createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + 3_600_000) });
    users[role] = { id, cookie: `fh_admin=${token}` };
  }

  beforeAll(async () => {
    savedKey = process.env.SECRET_BOX_KEY;
    process.env.SECRET_BOX_KEY = KEY;
    snapshot = { s: await db.select().from(settings), h: await db.select().from(openingHours), z: await db.select().from(deliveryZone), c: await db.select().from(closure) };
    await db.delete(openingHours);
    await db.delete(deliveryZone);
    await db.delete(closure);
    await mkUser("manager");
    await mkUser("kitchen");
    await mkUser("owner");
  });
  afterAll(async () => {
    await db.delete(openingHours);
    await db.delete(deliveryZone);
    await db.delete(closure);
    if (snapshot.h.length) await db.insert(openingHours).values(snapshot.h);
    if (snapshot.z.length) await db.insert(deliveryZone).values(snapshot.z);
    if (snapshot.c.length) await db.insert(closure).values(snapshot.c);
    if (snapshot.s[0]) await db.update(settings).set(snapshot.s[0]).where(eq(settings.id, 1));
    else await db.delete(settings);
    if (madeOrders.length) {
      await db.delete(orderItem).where(inArray(orderItem.orderId, madeOrders));
      await db.delete(order).where(inArray(order.id, madeOrders));
    }
    const ids = Object.values(users).map((u) => u.id);
    if (ids.length) {
      await db.delete(auditLog).where(inArray(auditLog.userId, ids));
      await db.delete(adminUser).where(inArray(adminUser.id, ids));
    }
    if (savedKey === undefined) delete process.env.SECRET_BOX_KEY;
    else process.env.SECRET_BOX_KEY = savedKey;
  });

  const req = (method: string, path: string, who: string | null, body?: unknown, origin: string | null = ORIGIN) =>
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(origin ? { origin } : {}), ...(who ? { cookie: users[who].cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const idp = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
  const view = async () => j(await getSettings(req("GET", "/api/admin/settings", "manager")));
  const allDay = Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt: "00:00", closesAt: "23:59" }));
  const audits = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action));

  it("is owner/manager only: no session 401, kitchen 403, cross-site 403, and nothing changes", async () => {
    const calls: [string, () => Promise<Response>][] = [
      ["GET", () => getSettings(req("GET", "/api/admin/settings", null))],
      ["PUT hours", () => putHours(req("PUT", "/api/admin/settings/hours", "kitchen", { windows: allDay }))],
      ["PUT pause", () => putPause(req("PUT", "/api/admin/settings/pause", "kitchen", { paused: true }))],
      ["PUT general", () => putGeneral(req("PUT", "/api/admin/settings/general", "kitchen", { defaultPrepMinutes: 5, cashMaxPence: null, cashDailyCapPerPhone: 1, cashDailyCapPerIp: 1 }))],
      ["POST closure", () => postClosure(req("POST", "/api/admin/settings/closures", "kitchen", { day: "2030-01-01" }))],
      ["DELETE closure", () => deleteClosure(req("DELETE", "/api/admin/settings/closures/1", "kitchen"), idp(1))],
      ["POST zone", () => postZone(req("POST", "/api/admin/zones", "kitchen", { district: "LU9", fee: 0, minOrder: 0, estimatedMinutes: 30, active: true }))],
      ["PUT zone", () => putZone(req("PUT", "/api/admin/zones/1", "kitchen", { fee: 0, minOrder: 0, estimatedMinutes: 30, active: true }), idp(1))],
      ["DELETE zone", () => deleteZone(req("DELETE", "/api/admin/zones/1", "kitchen"), idp(1))],
    ];
    for (const [name, call] of calls) expect([name, (await call()).status]).toEqual([name, name === "GET" ? 401 : 403]);
    expect((await getSettings(req("GET", "/api/admin/settings", "kitchen"))).status).toBe(403);
    expect((await putPause(req("PUT", "/api/admin/settings/pause", "manager", { paused: true }, "https://evil.example"))).status).toBe(403);
    expect((await putPause(req("PUT", "/api/admin/settings/pause", "manager", { paused: true }, null))).status).toBe(403);
    const v = await view();
    expect(v.general.paused).toBe(false);
    expect(v.hours).toEqual([]);
    expect(v.zones).toEqual([]);
  });

  describe("opening hours", () => {
    it("rejects overlaps, bad times, unknown keys and oversize input without changing anything", async () => {
      const bad = [
        { windows: [{ weekday: 1, opensAt: "12:00", closesAt: "18:00" }, { weekday: 1, opensAt: "17:00", closesAt: "22:00" }] },
        { windows: [{ weekday: 5, opensAt: "17:00", closesAt: "03:00" }, { weekday: 6, opensAt: "02:00", closesAt: "10:00" }] },
        { windows: [{ weekday: 1, opensAt: "9:00", closesAt: "18:00" }] },
        { windows: [{ weekday: 1, opensAt: "12:00", closesAt: "12:00" }] },
        { windows: [{ weekday: 7, opensAt: "12:00", closesAt: "13:00" }] },
        { windows: [], extra: 1 },
      ];
      for (const b of bad) {
        const r = await putHours(req("PUT", "/api/admin/settings/hours", "manager", b));
        expect(r.status).toBe(400);
      }
      expect((await view()).hours).toEqual([]);
    });

    it("saves, replaces the whole schedule atomically, and audits before/after", async () => {
      expect((await putHours(req("PUT", "/api/admin/settings/hours", "manager", { windows: allDay }))).status).toBe(200);
      let v = await view();
      expect(v.hours).toHaveLength(7);
      expect(v.hours[0]).toEqual({ weekday: 0, opensAt: "00:00", closesAt: "23:59" }); // Postgres time normalised to HH:MM
      const r = await putHours(req("PUT", "/api/admin/settings/hours", "manager", { windows: [{ weekday: 2, opensAt: "11:00", closesAt: "14:00" }, { weekday: 2, opensAt: "17:00", closesAt: "01:00" }] }));
      expect(r.status).toBe(200);
      v = await view();
      expect(v.hours).toEqual([{ weekday: 2, opensAt: "11:00", closesAt: "14:00" }, { weekday: 2, opensAt: "17:00", closesAt: "01:00" }]);
      const log = await audits("settings.hours");
      expect(log.length).toBeGreaterThanOrEqual(2);
      expect(log.some((l) => Array.isArray(l.before) && (l.before as unknown[]).length === 7)).toBe(true);
      expect(log.every((l) => l.userId === users.manager.id)).toBe(true);
    });

    it("an empty schedule is allowed and means closed", async () => {
      expect((await putHours(req("PUT", "/api/admin/settings/hours", "manager", { windows: [] }))).status).toBe(200);
      expect((await view()).status).toEqual({ open: false, reason: "no_hours" });
    });
  });

  describe("settings really control ordering (quote + checkout read the same tables)", () => {
    let itemId = "";
    beforeAll(async () => {
      const menu = rowsToMenu(await loadMenuRows(db));
      itemId = menu.categories[0].items.find((i) => !i.soldOut)!.id;
    });
    const q = (over: Record<string, unknown> = {}) => quoteSchema.parse({ items: [{ itemId, quantity: 2 }], orderType: "collection", paymentMethod: "cash", ...over });
    const quote = (over?: Record<string, unknown>) => quoteOrder({ db, now: new Date(), clientIp: null }, q(over)); // default loader = the database
    const checkout = (over: Record<string, unknown> = {}) =>
      createOrder(
        { db, now: new Date(), siteUrl: "https://s.test", clientIp: null },
        checkoutSchema.parse({ idempotencyKey: crypto.randomUUID(), items: [{ itemId, quantity: 2 }], orderType: "collection", paymentMethod: "cash", name: "Settings Test", phone: "07123456789", email: `settings-${tag}@example.test`, ...over }),
      );

    it("closed with no hours; open after saving hours; collection order is accepted", async () => {
      await putHours(req("PUT", "/api/admin/settings/hours", "manager", { windows: [] }));
      expect((await quote()).body).toMatchObject({ open: false, closedMessage: expect.stringContaining("closed") });
      expect(await checkout()).toMatchObject({ status: 409, body: { code: "SHOP_CLOSED" } });

      await putHours(req("PUT", "/api/admin/settings/hours", "manager", { windows: allDay.map((w) => ({ ...w, closesAt: "23:59" })) }));
      // 00:00-23:59 is open at every time except the final minute of the day
      const p = londonParts(new Date());
      if (p.minutes < 23 * 60 + 59) {
        expect((await quote()).body).toMatchObject({ open: true });
        const r = await checkout();
        expect(r).toMatchObject({ status: 201, body: { ok: true } });
        if (r.body.ok) {
          const [o] = await db.select().from(order).where(eq(order.token, r.body.token));
          madeOrders.push(o.id);
        }
      }
    });

    it("pause stops orders immediately with the owner's message, and resume restores them", async () => {
      expect((await putPause(req("PUT", "/api/admin/settings/pause", "manager", { paused: true, message: "  Back at 8pm  " }))).status).toBe(200);
      expect((await view()).status).toEqual({ open: false, reason: "paused" });
      expect((await quote()).body).toMatchObject({ open: false, closedMessage: "Back at 8pm" });
      expect(await checkout()).toMatchObject({ status: 409, body: { code: "SHOP_PAUSED", message: "Back at 8pm" } });
      // the board tells owner/manager they can resume, and tells kitchen it is paused
      const asManager = await j(await getBoard(req("GET", "/api/admin/orders", "manager")));
      expect(asManager).toMatchObject({ paused: true, pausedMessage: "Back at 8pm", canPause: true });
      expect(await j(await getBoard(req("GET", "/api/admin/orders", "kitchen")))).toMatchObject({ paused: true, canPause: false });

      expect((await putPause(req("PUT", "/api/admin/settings/pause", "manager", { paused: false }))).status).toBe(200);
      expect((await view()).general).toMatchObject({ paused: false, pausedMessage: "Back at 8pm" }); // message kept for next time
      expect((await audits("settings.pause")).length).toBeGreaterThanOrEqual(1);
      expect((await audits("settings.resume")).length).toBeGreaterThanOrEqual(1);
    });

    it("a closure day closes today; removing it reopens; duplicates and bad dates are refused", async () => {
      const today = londonParts(new Date()).date;
      const added = await postClosure(req("POST", "/api/admin/settings/closures", "manager", { day: today, reason: "Test holiday" }));
      expect(added.status).toBe(201);
      const { id } = await j(added);
      expect((await view()).status).toEqual({ open: false, reason: "closure" });
      expect((await quote()).body).toMatchObject({ open: false });
      expect((await postClosure(req("POST", "/api/admin/settings/closures", "manager", { day: today }))).status).toBe(409);
      for (const day of ["2026-02-30", "tomorrow", "2026-1-1"]) expect((await postClosure(req("POST", "/api/admin/settings/closures", "manager", { day }))).status).toBe(400);
      expect((await deleteClosure(req("DELETE", `/api/admin/settings/closures/${id}`, "manager"), idp(id))).status).toBe(200);
      expect((await deleteClosure(req("DELETE", `/api/admin/settings/closures/${id}`, "manager"), idp(id))).status).toBe(404);
      expect((await deleteClosure(req("DELETE", "/api/admin/settings/closures/abc", "manager"), idp("abc"))).status).toBe(404);
      expect((await view()).closures).toEqual([]);
      expect((await audits("closure.add")).length).toBeGreaterThanOrEqual(1);
      expect((await audits("closure.remove")).length).toBeGreaterThanOrEqual(1);
    });

    it("delivery needs a zone: refused with no zones, accepted after adding LU4, refused again when it is switched off or deleted", async () => {
      const delivery = { orderType: "delivery" as const, postcode: "LU4 8NU" };
      expect(((await quote(delivery)).body as { errors?: { code: string }[] }).errors?.[0].code).toBe("OUTSIDE_ZONE");

      const created = await postZone(req("POST", "/api/admin/zones", "manager", { district: " lu4 ", fee: 250, minOrder: 1000, estimatedMinutes: 40, active: true }));
      expect(created.status).toBe(201);
      const { id } = await j(created);
      expect((await view()).zones).toEqual([{ id, district: "LU4", fee: 250, minOrder: 1000, estimatedMinutes: 40, active: true }]); // uppercased + trimmed
      const ok = (await quote(delivery)).body as { ok: boolean; deliveryFee: number; zone: { estimatedMinutes: number } };
      expect(ok).toMatchObject({ ok: true, deliveryFee: 250, zone: { estimatedMinutes: 40 } });

      expect((await putZone(req("PUT", `/api/admin/zones/${id}`, "manager", { fee: 399, minOrder: 1500, estimatedMinutes: 55, active: true }), idp(id))).status).toBe(200);
      expect((await quote(delivery)).body).toMatchObject({ deliveryFee: 399, zone: { minOrder: 1500, estimatedMinutes: 55 } });

      await putZone(req("PUT", `/api/admin/zones/${id}`, "manager", { fee: 399, minOrder: 1500, estimatedMinutes: 55, active: false }), idp(id));
      expect(((await quote(delivery)).body as { errors?: { code: string }[] }).errors?.[0].code).toBe("OUTSIDE_ZONE");

      expect((await deleteZone(req("DELETE", `/api/admin/zones/${id}`, "manager"), idp(id))).status).toBe(200);
      expect((await view()).zones).toEqual([]);
      for (const a of ["zone.create", "zone.update", "zone.delete"]) expect((await audits(a)).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("zone validation", () => {
    const good = { district: "LU2", fee: 200, minOrder: 800, estimatedMinutes: 30, active: true };
    it("rejects bad districts, negative or fractional money, silly times and unknown keys", async () => {
      const bads: Record<string, unknown>[] = [
        { ...good, district: "ZZZZZ" },
        { ...good, district: "4" },
        { ...good, district: "LU 2" },
        { ...good, fee: -1 },
        { ...good, fee: 2.5 },
        { ...good, fee: 100_000 },
        { ...good, minOrder: -5 },
        { ...good, estimatedMinutes: 1 },
        { ...good, estimatedMinutes: 500 },
        { ...good, active: "yes" },
        { ...good, extra: true },
      ];
      for (const b of bads) expect([JSON.stringify(b), (await postZone(req("POST", "/api/admin/zones", "manager", b))).status]).toEqual([JSON.stringify(b), 400]);
      expect((await view()).zones).toEqual([]);
    });
    it("duplicates are a 409; unknown or malformed ids are 404", async () => {
      expect((await postZone(req("POST", "/api/admin/zones", "manager", good))).status).toBe(201);
      expect((await postZone(req("POST", "/api/admin/zones", "manager", good))).status).toBe(409);
      expect((await putZone(req("PUT", "/api/admin/zones/2000000000", "manager", good), idp(2_000_000_000))).status).toBe(404);
      expect((await putZone(req("PUT", "/api/admin/zones/x", "manager", good), idp("x"))).status).toBe(404);
      expect((await deleteZone(req("DELETE", "/api/admin/zones/2000000000", "manager"), idp(2_000_000_000))).status).toBe(404);
      const zones = (await view()).zones;
      await deleteZone(req("DELETE", `/api/admin/zones/${zones[0].id}`, "manager"), idp(zones[0].id));
    });
  });

  describe("prep time and cash limits", () => {
    const base = { defaultPrepMinutes: 25, cashMaxPence: 4000, cashDailyCapPerPhone: 2, cashDailyCapPerIp: 4 };
    it("validates, saves, and feeds the board's default prep time and the checkout's cash limit", async () => {
      for (const b of [{ ...base, defaultPrepMinutes: 0 }, { ...base, defaultPrepMinutes: 181 }, { ...base, cashMaxPence: 50 }, { ...base, cashMaxPence: 5_000_000 }, { ...base, cashDailyCapPerPhone: 0 }, { ...base, cashDailyCapPerIp: 51 }, { ...base, extra: 1 }]) {
        expect((await putGeneral(req("PUT", "/api/admin/settings/general", "manager", b))).status).toBe(400);
      }
      expect((await putGeneral(req("PUT", "/api/admin/settings/general", "manager", base))).status).toBe(200);
      expect((await view()).general).toMatchObject(base);
      expect((await j(await getBoard(req("GET", "/api/admin/orders", "manager")))).defaultPrepMinutes).toBe(25);
      expect((await putGeneral(req("PUT", "/api/admin/settings/general", "manager", { ...base, cashMaxPence: null }))).status).toBe(200);
      expect((await view()).general.cashMaxPence).toBeNull();
      expect((await audits("settings.general")).length).toBeGreaterThanOrEqual(2);
    });
  });
});
