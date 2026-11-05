import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { adminUser, openingHours, order, orderItem, salesReport } from "@/db/schema";
import type { Db } from "@/lib/db/client";
import type { EmailSender } from "@/lib/email";
import { normaliseTime } from "@/lib/admin/hours-validate";
import { londonParts, type HoursRow } from "@/lib/hours";
import { buildReportEmail, buildTotals, COUNTED_STATUSES, tradingPeriod, type ReportItem, type ReportOrder, type SalesTotals } from "@/lib/sales-report";
import { addDays } from "@/lib/shop-status";

// Sends each trading day's sales email to the owner accounts, once, after closing
// (R9.12). Called by the 5-minute cron (POST /api/cron/maintenance). It looks at
// today and yesterday only: yesterday catches a run that was missed overnight.

export type ReportStatus = "sent" | "not_due" | "already_sent" | "nothing_to_report" | "no_recipients" | "email_not_configured" | "failed";
export type ReportOutcome = { day: string; status: ReportStatus; orders?: number; recipients?: number };

const SELECT_ORDER = { id: order.id, total: order.total, discount: order.discount, deliveryFee: order.deliveryFee, type: order.type, paymentMethod: order.paymentMethod, status: order.status, paymentStatus: order.paymentStatus };

async function ordersBetween(db: Db, start: Date, end: Date): Promise<ReportOrder[]> {
  return db.select(SELECT_ORDER).from(order).where(and(gte(order.createdAt, start), lt(order.createdAt, end))).orderBy(asc(order.id));
}

async function itemsFor(db: Db, ids: number[]): Promise<ReportItem[]> {
  if (ids.length === 0) return [];
  const rows = await db.select({ orderId: orderItem.orderId, name: orderItem.name, quantity: orderItem.quantity, lineTotal: orderItem.lineTotal }).from(orderItem).where(inArray(orderItem.orderId, ids));
  return rows;
}

export async function loadHours(db: Db): Promise<HoursRow[]> {
  const rows = await db.select().from(openingHours);
  return rows.map((r) => ({ weekday: r.weekday, opensAt: normaliseTime(r.opensAt)!, closesAt: normaliseTime(r.closesAt)! }));
}

/** Has the shop ever had an accepted order before `before`? Reports begin with the first sale. */
async function hasSoldBefore(db: Db, before: Date): Promise<boolean> {
  const rows = await db.select({ id: order.id }).from(order).where(and(lt(order.createdAt, before), inArray(order.status, [...COUNTED_STATUSES]))).limit(1);
  return rows.length > 0;
}

/** The totals for one trading day, straight from the database (also used by the admin preview). */
export async function loadDayTotals(db: Db, day: string, hoursIn?: HoursRow[]): Promise<{ totals: SalesTotals; week: { orders: number; revenue: number }; period: ReturnType<typeof tradingPeriod> }> {
  const hours = hoursIn ?? (await loadHours(db));
  const period = tradingPeriod(hours, day);
  const dayOrders = await ordersBetween(db, period.start, period.end);
  const totals = buildTotals(dayOrders, await itemsFor(db, dayOrders.map((o) => o.id)));
  // Trailing 7 trading days, on the same exact boundaries.
  const weekStart = tradingPeriod(hours, addDays(day, -6)).start;
  const weekOrders = await ordersBetween(db, weekStart, period.end);
  const counted = weekOrders.filter((o) => (COUNTED_STATUSES as readonly string[]).includes(o.status));
  return { totals, week: { orders: counted.length, revenue: counted.reduce((n, o) => n + o.total, 0) }, period };
}

export async function runDailyReports(deps: { db: Db; sender: EmailSender | null; now: Date; /** override for tests; normally read from the database */ hours?: HoursRow[] }): Promise<{ ok: boolean; reports: ReportOutcome[]; errors: string[] }> {
  const { db, sender, now } = deps;
  const reports: ReportOutcome[] = [];
  const errors: string[] = [];
  const today = londonParts(now).date;
  const hours = deps.hours ?? (await loadHours(db));

  for (const day of [addDays(today, -1), today]) {
    try {
      const period = tradingPeriod(hours, day);
      if (now < period.reportAt) {
        reports.push({ day, status: "not_due" });
        continue;
      }
      const [done] = await db.select({ day: salesReport.day }).from(salesReport).where(eq(salesReport.day, day)).limit(1);
      if (done) {
        reports.push({ day, status: "already_sent" });
        continue;
      }
      const { totals, week } = await loadDayTotals(db, day, hours);
      // A day with no opening hours is only reported if something actually happened.
      const quiet = totals.orders === 0 && totals.rejected === 0 && totals.cancelled === 0;
      if (!period.closesAt && quiet) {
        reports.push({ day, status: "nothing_to_report" });
        continue;
      }
      // Before the first sale there is nothing to report: otherwise an owner who has entered opening hours
      // but not launched yet would get a "no orders" email every day.
      if (totals.orders === 0 && !(await hasSoldBefore(db, period.end))) {
        reports.push({ day, status: "nothing_to_report" });
        continue;
      }
      if (!sender) {
        console.warn("daily sales report not sent: email is not configured");
        reports.push({ day, status: "email_not_configured", orders: totals.orders });
        continue;
      }
      const owners = await db.select({ email: adminUser.email }).from(adminUser).where(and(eq(adminUser.role, "owner"), eq(adminUser.disabled, false)));
      if (owners.length === 0) {
        console.warn("daily sales report not sent: there is no owner account to send it to");
        reports.push({ day, status: "no_recipients", orders: totals.orders });
        continue;
      }

      // Claim the day BEFORE sending: the primary key lets exactly one run win, so two overlapping
      // cron runs cannot both send. If nothing could be sent the claim is released for a retry.
      const claimed = await db.insert(salesReport).values({ day, recipients: 0 }).onConflictDoNothing().returning({ day: salesReport.day });
      if (claimed.length === 0) {
        reports.push({ day, status: "already_sent" });
        continue;
      }
      const email = buildReportEmail(day, totals, week);
      let sent = 0;
      for (const o of owners) {
        try {
          await sender.send({ to: o.email, ...email });
          sent++;
        } catch (e) {
          errors.push(`sales report ${day}: ${e instanceof Error ? e.message : "send failed"}`); // never includes the address
        }
      }
      if (sent === 0) {
        await db.delete(salesReport).where(eq(salesReport.day, day)); // retry on the next run
        reports.push({ day, status: "failed", orders: totals.orders });
        continue;
      }
      await db.update(salesReport).set({ recipients: sent, summary: totals }).where(eq(salesReport.day, day));
      reports.push({ day, status: "sent", orders: totals.orders, recipients: sent });
    } catch (e) {
      errors.push(`sales report ${day}: ${e instanceof Error ? e.message : String(e)}`);
      reports.push({ day, status: "failed" });
    }
  }
  return { ok: errors.length === 0, reports, errors };
}
