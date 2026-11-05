import type { HoursRow } from "./hours";
import { londonLocalToUtc } from "./london-time";
import { escapeHtml } from "./order-email";
import { formatPenceExact } from "./money";
import { addDays } from "./shop-status";

// Daily sales report (R9.12). Pure: boundaries, totals and wording. The job that
// reads the database and sends the email is lib/sales-report-job.ts.
//
// TRADING DAYS. A Friday-night shift that runs until 2am belongs to Friday's
// report, not Saturday's. So days are not calendar days: day D runs from the end
// of D-1's trading (or UK midnight, whichever is later) to the end of D's trading
// (or the next UK midnight, whichever is later). Consecutive days therefore tile
// the timeline exactly: no order is counted twice or dropped.

const MINUTE = 60_000;
export const REPORT_GRACE_MINUTES = 15; // after closing, so card payments in flight settle
const MIN = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

const midnight = (date: string): Date => londonLocalToUtc(`${date}T00:00`)!; // midnight always exists in the UK

/** When trading on `date` ends (the latest period end among periods that START that day), or null if there are none. */
export function closingOf(hours: HoursRow[], date: string): Date | null {
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  let latest: Date | null = null;
  for (const h of hours) {
    if (h.weekday !== wd) continue;
    const start = londonLocalToUtc(`${date}T${h.opensAt.slice(0, 5)}`);
    if (!start) continue;
    const open = MIN(h.opensAt);
    const close = MIN(h.closesAt);
    const end = new Date(start.getTime() + (close > open ? close - open : close + 1440 - open) * MINUTE);
    if (!latest || end > latest) latest = end;
  }
  return latest;
}

export type TradingPeriod = { start: Date; end: Date; closesAt: Date | null; reportAt: Date };

export function tradingPeriod(hours: HoursRow[], date: string): TradingPeriod {
  const midStart = midnight(date);
  const midEnd = midnight(addDays(date, 1));
  const prevClose = closingOf(hours, addDays(date, -1));
  const closesAt = closingOf(hours, date);
  return {
    start: prevClose && prevClose > midStart ? prevClose : midStart,
    end: closesAt && closesAt > midEnd ? closesAt : midEnd,
    closesAt,
    // No hours that day: if anything happened, report at 23:30 UK time.
    reportAt: closesAt ? new Date(closesAt.getTime() + REPORT_GRACE_MINUTES * MINUTE) : new Date(midEnd.getTime() - 30 * MINUTE),
  };
}

// ---- totals -------------------------------------------------------------------

/** Orders that count as sales: accepted, whatever stage they have reached. */
export const COUNTED_STATUSES = ["received", "preparing", "ready", "out_for_delivery", "completed"] as const;

export type ReportOrder = { id: number; total: number; discount: number; deliveryFee: number; type: "delivery" | "collection"; paymentMethod: "card" | "cash"; status: string; paymentStatus: string };
export type ReportItem = { orderId: number; name: string; quantity: number; lineTotal: number };
export type Split = { orders: number; revenue: number };
export type SalesTotals = {
  orders: number;
  revenue: number;
  average: number;
  card: Split;
  cash: Split;
  delivery: Split;
  collection: Split;
  discounts: number;
  deliveryFees: number;
  topItems: { name: string; quantity: number; revenue: number }[];
  rejected: number;
  cancelled: number; // unpaid card orders that expired
  refunded: Split;
};

const empty = (): Split => ({ orders: 0, revenue: 0 });

export function buildTotals(orders: ReportOrder[], items: ReportItem[]): SalesTotals {
  const t: SalesTotals = { orders: 0, revenue: 0, average: 0, card: empty(), cash: empty(), delivery: empty(), collection: empty(), discounts: 0, deliveryFees: 0, topItems: [], rejected: 0, cancelled: 0, refunded: empty() };
  const counted = new Set<number>();
  const add = (s: Split, total: number) => ((s.orders += 1), (s.revenue += total));
  for (const o of orders) {
    if (o.status === "rejected") t.rejected++;
    else if (o.status === "cancelled") t.cancelled++;
    else if (o.status === "refunded" || o.paymentStatus === "refunded") add(t.refunded, o.total);
    else if ((COUNTED_STATUSES as readonly string[]).includes(o.status)) {
      counted.add(o.id);
      t.orders++;
      t.revenue += o.total;
      t.discounts += o.discount;
      t.deliveryFees += o.deliveryFee;
      add(o.paymentMethod === "card" ? t.card : t.cash, o.total);
      add(o.type === "delivery" ? t.delivery : t.collection, o.total);
    }
  }
  t.average = t.orders ? Math.round(t.revenue / t.orders) : 0;

  const byName = new Map<string, { quantity: number; revenue: number }>();
  for (const i of items) {
    if (!counted.has(i.orderId)) continue;
    const e = byName.get(i.name) ?? { quantity: 0, revenue: 0 };
    e.quantity += i.quantity;
    e.revenue += i.lineTotal;
    byName.set(i.name, e);
  }
  t.topItems = [...byName.entries()]
    .map(([name, e]) => ({ name, ...e }))
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue || a.name.localeCompare(b.name))
    .slice(0, 5);
  return t;
}

// ---- the email ----------------------------------------------------------------------

export type EmailContent = { subject: string; text: string; html: string };

const dayLabel = (date: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T12:00:00Z`));
const shortDay = (date: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00Z`));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * Totals only: no customer names, phone numbers, emails or addresses are ever
 * passed in, so none can appear. Revenue is the order totals (delivery fees
 * included, discounts taken off); cash orders count when accepted.
 */
export function buildReportEmail(date: string, t: SalesTotals, week: Split, siteName = "Food Haus"): EmailContent {
  const subject = t.orders === 0 ? `${siteName} sales, ${shortDay(date)}: no orders` : `${siteName} sales, ${shortDay(date)}: ${plural(t.orders, "order")}, ${formatPenceExact(t.revenue)}`;
  const rows: [string, string][] = [
    ["Orders", String(t.orders)],
    ["Revenue", formatPenceExact(t.revenue)],
    ["Average order", t.orders ? formatPenceExact(t.average) : "–"],
    ["Paid online (card)", `${t.card.orders} · ${formatPenceExact(t.card.revenue)}`],
    ["Cash", `${t.cash.orders} · ${formatPenceExact(t.cash.revenue)}`],
    ["Delivery", `${t.delivery.orders} · ${formatPenceExact(t.delivery.revenue)}`],
    ["Collection", `${t.collection.orders} · ${formatPenceExact(t.collection.revenue)}`],
    ["Discounts given", formatPenceExact(t.discounts)],
    ["Delivery fees", formatPenceExact(t.deliveryFees)],
  ];
  const notes: string[] = [];
  if (t.rejected) notes.push(`${plural(t.rejected, "order")} rejected`);
  if (t.cancelled) notes.push(`${plural(t.cancelled, "unpaid card order")} expired`);
  if (t.refunded.orders) notes.push(`${plural(t.refunded.orders, "order")} refunded (${formatPenceExact(t.refunded.revenue)}), not counted above`);
  const weekLine = `Last 7 days: ${plural(week.orders, "order")}, ${formatPenceExact(week.revenue)}`;

  const text = [
    `${siteName} sales for ${dayLabel(date)}`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(t.topItems.length ? ["", "Top items:", ...t.topItems.map((i, n) => `${n + 1}. ${i.name}: ${i.quantity} sold, ${formatPenceExact(i.revenue)}`)] : []),
    ...(notes.length ? ["", ...notes] : []),
    "",
    weekLine,
    "",
    "Revenue is the order totals (delivery fees included, discounts taken off). Cash orders count when accepted. This email has totals only: no customer details.",
  ].join("\n");

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:16px">
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(siteName)} sales for ${escapeHtml(dayLabel(date))}</h1>
<table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #ddd">${rows
    .map(([k, v]) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${escapeHtml(k)}</td><td align="right" style="padding:6px 0;border-bottom:1px solid #eee"><strong>${escapeHtml(v)}</strong></td></tr>`)
    .join("")}</table>
${t.topItems.length ? `<h2 style="font-size:16px;margin:18px 0 6px">Top items</h2><ol style="margin:0;padding-left:20px">${t.topItems.map((i) => `<li>${escapeHtml(i.name)}: ${i.quantity} sold, ${escapeHtml(formatPenceExact(i.revenue))}</li>`).join("")}</ol>` : ""}
${notes.length ? `<p style="color:#555">${notes.map(escapeHtml).join("<br>")}</p>` : ""}
<p><strong>${escapeHtml(weekLine)}</strong></p>
<p style="color:#555;font-size:12px">Revenue is the order totals (delivery fees included, discounts taken off). Cash orders count when accepted. This email has totals only: no customer details.</p>
</body></html>`;
  return { subject, text, html };
}
