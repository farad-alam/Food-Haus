import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, between, eq, inArray } from "drizzle-orm";
import { adminUser, order, orderItem, salesReport } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { createAdminUser } from "@/lib/auth/pg-store";
import { runDailyReports, loadDayTotals } from "@/lib/sales-report-job";
import { newOrderToken } from "@/lib/token";
import type { EmailMessage, EmailSender } from "@/lib/email";

// Real database, FAKE email. Everything is dated in January 2025, so no claim
// row can ever collide with a real trading day, and the job is given its hours
// (other test files rewrite the shared opening_hours table at the same time).
const enabled = !!process.env.DATABASE_URL;
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(2)));
const tag = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
const w = (weekday: number, opensAt: string, closesAt: string) => ({ weekday, opensAt, closesAt });
const daily = [0, 1, 2, 3, 4, 5, 6].map((d) => w(d, "12:00", "23:00"));
const at = (iso: string) => new Date(iso);

function recorder(failFor: (to: string) => boolean = () => false) {
  const sent: EmailMessage[] = [];
  const sender: EmailSender = {
    async send(m) {
      if (failFor(m.to)) throw new Error("boom");
      sent.push(m);
    },
  };
  return { sent, sender };
}

describe.skipIf(!enabled)("daily sales report job (real database)", () => {
  const db = enabled ? getDb() : (null as never);
  const made = { orders: [] as number[], users: [] as number[] };
  const owners = { a: `owner-a-${tag}@example.test`, b: `owner-b-${tag}@example.test`, off: `owner-off-${tag}@example.test`, mgr: `mgr-${tag}@example.test`, kit: `kit-${tag}@example.test` };

  beforeAll(async () => {
    const mk = async (email: string, role: "owner" | "manager" | "kitchen", disabled = false) => {
      const id = await createAdminUser(db, KEY, { email, passwordHash: "x", role });
      if (disabled) await db.update(adminUser).set({ disabled: true }).where(eq(adminUser.id, id));
      made.users.push(id);
    };
    await mk(owners.a, "owner");
    await mk(owners.off, "owner", true);
    await mk(owners.mgr, "manager");
    await mk(owners.kit, "kitchen");
  });
  afterAll(async () => {
    if (made.orders.length) {
      await db.delete(orderItem).where(inArray(orderItem.orderId, made.orders));
      await db.delete(order).where(inArray(order.id, made.orders));
    }
    await db.delete(salesReport).where(between(salesReport.day, "2025-01-01", "2025-01-31"));
    await db.delete(adminUser).where(inArray(adminUser.id, made.users));
  });

  async function mkOrder(createdAt: Date, over: Partial<typeof order.$inferInsert> = {}, items: [string, number, number][] = []) {
    const [o] = await db
      .insert(order)
      .values({
        token: newOrderToken(), idempotencyKey: crypto.randomUUID(), type: "collection", paymentMethod: "cash", status: "completed", subtotal: 1000, total: 1000,
        customerName: `Secret Name ${tag}`, phone: "+447999000111", email: `secret-${tag}@example.test`, address: "99 Private Lane", postcode: "LU9 9ZZ", createdAt, ...over,
      })
      .returning();
    made.orders.push(o.id);
    for (const [name, quantity, lineTotal] of items) await db.insert(orderItem).values({ orderId: o.id, name, unitPrice: Math.round(lineTotal / quantity), quantity, options: [], lineTotal });
    return o;
  }
  const claim = async (day: string) => (await db.select().from(salesReport).where(eq(salesReport.day, day)))[0];
  const run = (now: Date, sender: EmailSender | null, hours = daily) => runDailyReports({ db, sender, now, hours });
  const outcome = (r: Awaited<ReturnType<typeof run>>, day: string) => r.reports.find((x) => x.day === day)!;
  // Emails to the owner this file created, optionally for one day only. Each run also looks at
  // YESTERDAY (to catch up a missed night), so tests pick the day they are about by its subject.
  const mine = (sent: EmailMessage[], dayLabel?: string) => sent.filter((m) => m.to === owners.a && (!dayLabel || m.subject.includes(dayLabel)));

  it("sends nothing before closing + 15 minutes, then one email, then never again for that day", async () => {
    await mkOrder(at("2025-01-14T13:00:00Z"), { total: 1598, paymentMethod: "card", paymentStatus: "paid" }, [["Classic Burger", 2, 1598]]);
    const early = recorder();
    const r0 = await run(at("2025-01-14T23:10:00Z"), early.sender); // closes 23:00, report at 23:15
    expect(outcome(r0, "2025-01-14").status).toBe("not_due");
    expect(mine(early.sent, "Tue 14 Jan")).toHaveLength(0);

    const rec = recorder();
    const r1 = await run(at("2025-01-14T23:20:00Z"), rec.sender);
    expect(outcome(r1, "2025-01-14")).toMatchObject({ status: "sent", orders: 1 });
    expect(mine(rec.sent, "Tue 14 Jan")).toHaveLength(1);
    const row = await claim("2025-01-14");
    expect(row.recipients).toBeGreaterThanOrEqual(1);
    expect(row.summary).toMatchObject({ orders: 1, revenue: 1598 });

    const again = recorder();
    const r2 = await run(at("2025-01-14T23:25:00Z"), again.sender);
    expect(outcome(r2, "2025-01-14").status).toBe("already_sent");
    expect(mine(again.sent, "Tue 14 Jan")).toHaveLength(0); // five minutes later: not sent twice
  });

  it("reports begin with the first sale: before it, even open days send nothing (no daily 'no orders' emails before launch)", async () => {
    const rec = recorder();
    // 2025-01-02 is before every order this file creates, so the shop has never sold anything by then
    const r = await run(at("2025-01-02T23:20:00Z"), rec.sender);
    expect(outcome(r, "2025-01-02").status).toBe("nothing_to_report");
    expect(outcome(r, "2025-01-01").status).toBe("nothing_to_report");
    expect(rec.sent).toHaveLength(0);
    expect(await claim("2025-01-02")).toBeUndefined();
  });

  it("goes only to ACTIVE OWNER accounts: not managers, kitchen, or disabled owners", async () => {
    const rec = recorder();
    await run(at("2025-01-15T23:20:00Z"), rec.sender);
    const to = rec.sent.map((m) => m.to);
    expect(to).toContain(owners.a);
    for (const other of [owners.off, owners.mgr, owners.kit]) expect(to).not.toContain(other);
  });

  it("the figures are right: counts accepted orders only, splits card/cash and delivery/collection, ranks items", async () => {
    // Wed 2025-01-22 (all test orders dated this day)
    await mkOrder(at("2025-01-22T12:30:00Z"), { total: 1848, deliveryFee: 250, type: "delivery", paymentMethod: "card", paymentStatus: "paid", status: "received" }, [["Hot Honey Wings", 3, 1848]]);
    await mkOrder(at("2025-01-22T18:00:00Z"), { total: 900, discount: 100, status: "preparing" }, [["Classic Burger", 1, 800], ["Cola", 1, 100]]);
    await mkOrder(at("2025-01-22T19:00:00Z"), { total: 700, status: "rejected" }, [["Ghost Item", 50, 5000]]);
    await mkOrder(at("2025-01-22T19:30:00Z"), { total: 1100, paymentMethod: "card", status: "pending_payment" }, [["Pending Item", 9, 900]]);
    await mkOrder(at("2025-01-22T20:00:00Z"), { total: 1000, paymentMethod: "card", status: "cancelled" });
    const { totals } = await loadDayTotals(db, "2025-01-22", daily);
    expect(totals).toMatchObject({ orders: 2, revenue: 2748, discounts: 100, deliveryFees: 250, rejected: 1, cancelled: 1 });
    expect(totals.card).toEqual({ orders: 1, revenue: 1848 });
    expect(totals.cash).toEqual({ orders: 1, revenue: 900 });
    expect(totals.delivery.orders).toBe(1);
    expect(totals.topItems.map((i) => i.name)).toEqual(["Hot Honey Wings", "Classic Burger", "Cola"]); // no rejected/pending items
    const rec = recorder();
    await run(at("2025-01-22T23:20:00Z"), rec.sender);
    const email = mine(rec.sent).find((m) => m.subject.includes("Wed 22 Jan"))!;
    expect(email.subject).toBe("Food Haus sales, Wed 22 Jan: 2 orders, £27.48");
    expect(email.text).toContain("1 order rejected");
  });

  it("the email carries totals only: none of the customers' details appear", async () => {
    const rec = recorder();
    await run(at("2025-01-22T23:45:00Z"), rec.sender);
    const all = rec.sent.map((m) => m.subject + m.text + m.html).join("\n");
    for (const secret of [`Secret Name ${tag}`, "+447999000111", `secret-${tag}`, "99 Private Lane", "LU9 9ZZ"]) expect(all).not.toContain(secret);
  });

  it("a Friday-night shift's after-midnight orders belong to Friday, and Saturday starts afterwards", async () => {
    const hours = [w(5, "17:00", "02:00"), w(6, "17:00", "02:00")];
    // Fri 2025-01-17 and Sat 2025-01-18
    await mkOrder(at("2025-01-17T20:00:00Z"), { total: 1000 });
    await mkOrder(at("2025-01-18T00:30:00Z"), { total: 2000 }); // after midnight, still Friday's shift
    await mkOrder(at("2025-01-18T01:59:00Z"), { total: 3000 }); // still Friday
    await mkOrder(at("2025-01-18T02:00:00Z"), { total: 4000 }); // 02:00 exactly: Saturday's
    await mkOrder(at("2025-01-18T21:00:00Z"), { total: 5000 });
    const fri = await loadDayTotals(db, "2025-01-17", hours);
    const sat = await loadDayTotals(db, "2025-01-18", hours);
    expect(fri.totals).toMatchObject({ orders: 3, revenue: 6000 });
    expect(sat.totals).toMatchObject({ orders: 2, revenue: 9000 });
    // Friday's report is not due until 02:15 on Saturday
    const rec = recorder();
    expect(outcome(await run(at("2025-01-18T02:10:00Z"), rec.sender, hours), "2025-01-17").status).toBe("not_due");
    expect(outcome(await run(at("2025-01-18T02:20:00Z"), rec.sender, hours), "2025-01-17")).toMatchObject({ status: "sent", orders: 3 });
  });

  it("a day with no opening hours sends nothing unless something happened, then reports at 23:30", async () => {
    const monOnly = [w(1, "12:00", "22:00")];
    // Sun 2025-01-26: no hours, no orders
    const rec = recorder();
    expect(outcome(await run(at("2025-01-26T23:45:00Z"), rec.sender, monOnly), "2025-01-26").status).toBe("nothing_to_report");
    expect(mine(rec.sent)).toHaveLength(0);
    await mkOrder(at("2025-01-26T15:00:00Z"), { total: 1234 }); // an order arrived anyway
    expect(outcome(await run(at("2025-01-26T23:20:00Z"), rec.sender, monOnly), "2025-01-26").status).toBe("not_due");
    expect(outcome(await run(at("2025-01-26T23:35:00Z"), rec.sender, monOnly), "2025-01-26")).toMatchObject({ status: "sent", orders: 1 });
  });

  it("an open day with no orders still gets a 'no orders' email", async () => {
    const rec = recorder();
    // Tue 2025-01-28
    const r = await run(at("2025-01-28T23:20:00Z"), rec.sender);
    expect(outcome(r, "2025-01-28")).toMatchObject({ status: "sent", orders: 0 });
    expect(mine(rec.sent).find((m) => m.subject.includes("Tue 28 Jan"))!.subject).toBe("Food Haus sales, Tue 28 Jan: no orders");
  });

  it("catches up yesterday if the cron missed it overnight", async () => {
    // Thu 2025-01-30 evening orders; first run only at 00:10 on Fri 31st
    await mkOrder(at("2025-01-30T19:00:00Z"), { total: 777 });
    const rec = recorder();
    const r = await run(at("2025-01-31T00:10:00Z"), rec.sender);
    expect(outcome(r, "2025-01-30")).toMatchObject({ status: "sent", orders: 1 });
    expect(outcome(r, "2025-01-31").status).toBe("not_due");
  });

  it("a failed send releases the claim and the next run retries; the error never contains an address", async () => {
    await mkOrder(at("2025-01-08T13:00:00Z"), { total: 555 });
    const failing = recorder(() => true);
    const r1 = await run(at("2025-01-08T23:20:00Z"), failing.sender);
    expect(outcome(r1, "2025-01-08").status).toBe("failed");
    expect(r1.ok).toBe(false);
    expect(r1.errors.join(" ")).not.toMatch(/@/);
    expect(await claim("2025-01-08")).toBeUndefined(); // released
    const ok = recorder();
    const r2 = await run(at("2025-01-08T23:25:00Z"), ok.sender);
    expect(outcome(r2, "2025-01-08").status).toBe("sent");
    expect(mine(ok.sent, "Wed 8 Jan")).toHaveLength(1);
  });

  it("if only some recipients fail, the day stays claimed (no duplicate for those who got it)", async () => {
    await mkOrder(at("2025-01-09T13:00:00Z"), { total: 666 });
    const other = `owner-b-${tag}@example.test`;
    const id = await createAdminUser(db, KEY, { email: other, passwordHash: "x", role: "owner" });
    made.users.push(id);
    const rec = recorder((to) => to === other);
    const r = await run(at("2025-01-09T23:20:00Z"), rec.sender);
    expect(outcome(r, "2025-01-09").status).toBe("sent"); // at least one delivery
    expect(r.ok).toBe(false); // but the failure is reported
    expect(await claim("2025-01-09")).toBeTruthy();
    expect(mine(rec.sent, "Thu 9 Jan")).toHaveLength(1);
    await db.update(adminUser).set({ disabled: true }).where(eq(adminUser.id, id)); // keep later tests simple
  });

  it("email not configured: no claim is made, so it sends later once configured", async () => {
    await mkOrder(at("2025-01-10T13:00:00Z"), { total: 333 });
    const r1 = await run(at("2025-01-10T23:20:00Z"), null);
    expect(outcome(r1, "2025-01-10").status).toBe("email_not_configured");
    expect(r1.ok).toBe(true); // not a failure: the shop simply has no email yet
    expect(await claim("2025-01-10")).toBeUndefined();
    const rec = recorder();
    expect(outcome(await run(at("2025-01-10T23:30:00Z"), rec.sender), "2025-01-10").status).toBe("sent");
  });

  it("two cron runs at the same moment send exactly one email", async () => {
    await mkOrder(at("2025-01-12T13:00:00Z"), { total: 444 });
    const rec = recorder();
    const now = at("2025-01-12T23:20:00Z");
    const [a, b] = await Promise.all([run(now, rec.sender), run(now, rec.sender)]);
    const statuses = [outcome(a, "2025-01-12").status, outcome(b, "2025-01-12").status].sort();
    expect(statuses).toEqual(["already_sent", "sent"]);
    expect(mine(rec.sent, "Sun 12 Jan")).toHaveLength(1);
  });

  it("with no owner accounts at all it reports 'no_recipients' and claims nothing", async () => {
    // simulate by disabling every owner for this check
    const owns = await db.select({ id: adminUser.id, disabled: adminUser.disabled }).from(adminUser).where(eq(adminUser.role, "owner"));
    await db.update(adminUser).set({ disabled: true }).where(eq(adminUser.role, "owner"));
    try {
      await mkOrder(at("2025-01-06T13:00:00Z"), { total: 222 });
      const r = await run(at("2025-01-06T23:20:00Z"), recorder().sender);
      expect(outcome(r, "2025-01-06").status).toBe("no_recipients");
      expect(await claim("2025-01-06")).toBeUndefined();
    } finally {
      for (const o of owns) await db.update(adminUser).set({ disabled: o.disabled }).where(and(eq(adminUser.id, o.id)));
    }
  });
});

// ---- the admin preview endpoint -----------------------------------------------------------
import { adminStore } from "@/lib/admin/guard";
import { generateToken, hashToken } from "@/lib/auth/service";
import { GET as getReport } from "@/app/api/admin/reports/route";

describe.skipIf(!enabled)("GET /api/admin/reports (real database)", () => {
  const db = enabled ? getDb() : (null as never);
  const ORIGIN = "http://localhost:3000";
  const users: Record<string, { id: number; cookie: string }> = {};
  const orders: number[] = [];
  let saved: string | undefined;

  async function mkUser(role: "manager" | "kitchen") {
    const id = await createAdminUser(db, KEY, { email: `${role}-rep-${tag}@example.test`, passwordHash: "x", role });
    const token = generateToken();
    const now = new Date();
    await adminStore().createSession({ tokenHash: await hashToken(token), userId: id, createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + 3_600_000) });
    users[role] = { id, cookie: `fh_admin=${token}` };
  }
  beforeAll(async () => {
    saved = process.env.SECRET_BOX_KEY;
    process.env.SECRET_BOX_KEY = KEY;
    await mkUser("manager");
    await mkUser("kitchen");
    const [o] = await db.insert(order).values({ token: newOrderToken(), idempotencyKey: crypto.randomUUID(), type: "collection", paymentMethod: "cash", status: "completed", subtotal: 4321, total: 4321, customerName: "Hidden", phone: "+447000000010", email: `hidden-${tag}@example.test`, createdAt: new Date("2025-02-10T13:00:00Z") }).returning();
    orders.push(o.id);
  });
  afterAll(async () => {
    await db.delete(order).where(inArray(order.id, orders));
    await db.delete(adminUser).where(inArray(adminUser.id, Object.values(users).map((u) => u.id)));
    if (saved === undefined) delete process.env.SECRET_BOX_KEY;
    else process.env.SECRET_BOX_KEY = saved;
  });
  const get = (qs: string, who: string | null) => getReport(new Request(`${ORIGIN}/api/admin/reports${qs}`, { headers: who ? { cookie: users[who].cookie } : {} }));

  it("is owner/manager only: no session 401, kitchen 403", async () => {
    expect((await get("?day=2025-02-10", null)).status).toBe(401);
    expect((await get("?day=2025-02-10", "kitchen")).status).toBe(403);
    expect((await get("?day=2025-02-10", "manager")).status).toBe(200);
  });
  it("returns the day's totals (and no customer details), and defaults to today", async () => {
    const res = await get("?day=2025-02-10", "manager");
    const body = await res.json();
    expect(body.totals).toMatchObject({ orders: 1, revenue: 4321, cash: { orders: 1, revenue: 4321 } });
    expect(JSON.stringify(body)).not.toMatch(/Hidden|hidden-|\+447000000010/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const today = await (await get("", "manager")).json();
    expect(today.ok).toBe(true);
    expect(today.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("rejects malformed, impossible and very old dates", async () => {
    for (const day of ["tomorrow", "2025-02-30", "2025-2-1", "1999-01-01", "2025-02-10T00:00", "' or 1=1"]) {
      expect([day, (await get(`?day=${encodeURIComponent(day)}`, "manager")).status]).toEqual([day, 400]);
    }
  });
});
