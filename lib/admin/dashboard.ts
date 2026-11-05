import { and, asc, gte, lt } from "drizzle-orm";
import { order, orderItem } from "@/db/schema";
import { inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import type { HoursRow } from "@/lib/hours";
import { londonParts } from "@/lib/hours";
import { buildTotals, tradingPeriod, type ReportItem, type ReportOrder, type SalesTotals } from "@/lib/sales-report";
import { addDays } from "@/lib/shop-status";
import { loadHours } from "@/lib/sales-report-job";

// Dashboard (R9.12): today so far and the last 7 trading days. Uses the SAME
// trading-day boundaries and totals as the daily sales email, so the screen and
// the email can never disagree.

/** The trading day that contains `now` (an overnight shift keeps counting as the day it started). */
export function currentTradingDay(hours: HoursRow[], now: Date): string {
  const today = londonParts(now).date;
  return now >= tradingPeriod(hours, today).start ? today : addDays(today, -1);
}

export type DashboardDay = { day: string; orders: number; revenue: number; average: number };
export type Dashboard = {
  generatedAt: string;
  today: { day: string; startedAt: string; totals: SalesTotals };
  days: DashboardDay[]; // oldest first, ending with today
  week: { orders: number; revenue: number; averagePerDay: number; bestDay: DashboardDay | null };
};

export async function loadDashboard(db: Db, now: Date, hoursIn?: HoursRow[]): Promise<Dashboard> {
  const hours = hoursIn ?? (await loadHours(db));
  const today = currentTradingDay(hours, now);
  const dayList = [-6, -5, -4, -3, -2, -1, 0].map((n) => addDays(today, n));
  const periods = dayList.map((d) => ({ day: d, ...tradingPeriod(hours, d) }));
  const from = periods[0].start;
  const to = periods[periods.length - 1].end;

  const rows: (ReportOrder & { createdAt: Date })[] = await db
    .select({ id: order.id, total: order.total, discount: order.discount, deliveryFee: order.deliveryFee, type: order.type, paymentMethod: order.paymentMethod, status: order.status, paymentStatus: order.paymentStatus, createdAt: order.createdAt })
    .from(order)
    .where(and(gte(order.createdAt, from), lt(order.createdAt, to)))
    .orderBy(asc(order.id));

  const buckets = periods.map((p) => rows.filter((r) => r.createdAt >= p.start && r.createdAt < p.end));
  const days: DashboardDay[] = periods.map((p, i) => {
    const t = buildTotals(buckets[i], []);
    return { day: p.day, orders: t.orders, revenue: t.revenue, average: t.average };
  });

  const todayOrders = buckets[buckets.length - 1];
  const items: ReportItem[] = todayOrders.length
    ? await db.select({ orderId: orderItem.orderId, name: orderItem.name, quantity: orderItem.quantity, lineTotal: orderItem.lineTotal }).from(orderItem).where(inArray(orderItem.orderId, todayOrders.map((o) => o.id)))
    : [];

  const orders = days.reduce((n, d) => n + d.orders, 0);
  const revenue = days.reduce((n, d) => n + d.revenue, 0);
  const best = days.filter((d) => d.orders > 0).sort((a, b) => b.revenue - a.revenue)[0] ?? null;
  return {
    generatedAt: now.toISOString(),
    today: { day: today, startedAt: periods[periods.length - 1].start.toISOString(), totals: buildTotals(todayOrders, items) },
    days,
    week: { orders, revenue, averagePerDay: Math.round(revenue / 7), bestDay: best },
  };
}
