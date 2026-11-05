import { and, asc, count, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { adminUser, auditLog, offer, order, orderItem } from "@/db/schema";
import type { Db } from "@/lib/db/client";
import { normaliseUkMobile } from "@/lib/checkout-schema";
import { londonLocalToUtc } from "@/lib/london-time";
import { COUNTED_STATUSES } from "@/lib/sales-report";
import { addDays } from "@/lib/shop-status";
import { EXPORT_CAP, PAGE_SIZE, STATUSES, type HistoryQuery } from "./history-schema";

// Order history (R9.11). Contains customers' contact details: callers must have
// passed guard() with orders.history (list/detail) or orders.export (CSV).

type Status = (typeof STATUSES)[number];

/** `%` and `_` typed by the user must match themselves, not act as wildcards. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The SQL condition for a set of filters. Dates are UK calendar days (to is inclusive). */
export function buildWhere(f: HistoryQuery): SQL | undefined {
  const conds: (SQL | undefined)[] = [];
  if (f.from) conds.push(gte(order.createdAt, londonLocalToUtc(`${f.from}T00:00`)!));
  if (f.to) conds.push(lt(order.createdAt, londonLocalToUtc(`${addDays(f.to, 1)}T00:00`)!));
  if (f.status) conds.push(inArray(order.status, f.status.split(",") as Status[]));
  if (f.payment) conds.push(eq(order.paymentMethod, f.payment));
  if (f.type) conds.push(eq(order.type, f.type));

  const q = f.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    const ors: SQL[] = [ilike(order.customerName, like), ilike(order.email, like), ilike(order.postcode, like)];
    const asNumber = /^#?(\d{1,9})$/.exec(q);
    if (asNumber) ors.push(eq(order.number, Number(asNumber[1])));
    // Phone numbers are stored as +447XXXXXXXXX. Accept 07… or +44…, and a partial run of digits.
    const mobile = normaliseUkMobile(q);
    if (mobile) ors.push(eq(order.phone, mobile));
    const digits = q.replace(/[\s()+-]/g, "");
    if (/^\d{4,}$/.test(digits)) ors.push(ilike(order.phone, `%${escapeLike(digits.replace(/^0/, ""))}%`));
    conds.push(or(...ors));
  }
  return conds.length ? and(...conds.filter((c): c is SQL => !!c)) : undefined;
}

export type HistoryRow = {
  id: number;
  number: number;
  createdAt: string;
  type: "delivery" | "collection";
  status: string;
  paymentMethod: "card" | "cash";
  paymentStatus: string;
  total: number;
  customerName: string;
  phone: string;
  postcode: string | null;
};

export async function searchHistory(db: Db, f: HistoryQuery): Promise<{ rows: HistoryRow[]; total: number; sales: { orders: number; revenue: number }; page: number; pageSize: number }> {
  const where = buildWhere(f);
  const page = f.page ?? 1;
  const counted = sql`${order.status} in (${sql.join(COUNTED_STATUSES.map((s) => sql`${s}`), sql`, `)})`;
  const [rows, [agg]] = await db.batch([
    db
      .select({ id: order.id, number: order.number, createdAt: order.createdAt, type: order.type, status: order.status, paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus, total: order.total, customerName: order.customerName, phone: order.phone, postcode: order.postcode })
      .from(order)
      .where(where)
      .orderBy(desc(order.createdAt), desc(order.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: count(), soldOrders: sql<number>`count(*) filter (where ${counted})::int`, revenue: sql<number>`coalesce(sum(${order.total}) filter (where ${counted}), 0)::int` }).from(order).where(where),
  ]);
  return {
    rows: rows.map((r) => ({ ...r, number: r.number!, createdAt: r.createdAt.toISOString() })),
    total: agg.n,
    sales: { orders: agg.soldOrders, revenue: agg.revenue },
    page,
    pageSize: PAGE_SIZE,
  };
}

// ---- one order ---------------------------------------------------------------------

export type OrderDetail = HistoryRow & {
  subtotal: number;
  deliveryFee: number;
  discount: number;
  offerName: string | null;
  email: string;
  address: string | null;
  note: string | null;
  prepMinutes: number | null;
  rejectionReason: string | null;
  scheduledFor: string | null;
  items: { name: string; quantity: number; unitPrice: number; options: { name: string; priceChange: number }[]; lineTotal: number }[];
  trail: { at: string; action: string; by: string | null; before: unknown; after: unknown }[];
};

export async function loadOrderDetail(db: Db, number: number): Promise<OrderDetail | null> {
  const [o] = await db.select().from(order).where(eq(order.number, number)).limit(1);
  if (!o) return null;
  const [items, offerRows, trail] = await db.batch([
    db.select().from(orderItem).where(eq(orderItem.orderId, o.id)).orderBy(asc(orderItem.id)),
    o.offerId ? db.select({ name: offer.name }).from(offer).where(eq(offer.id, o.offerId)).limit(1) : db.select({ name: offer.name }).from(offer).where(sql`false`),
    // Who did what, when: the kitchen shares one login, so this is the only record of the person (R9.13).
    db
      .select({ at: auditLog.at, action: auditLog.action, by: adminUser.email, before: auditLog.before, after: auditLog.after })
      .from(auditLog)
      .leftJoin(adminUser, eq(adminUser.id, auditLog.userId))
      .where(eq(auditLog.entity, `order:${o.id}`))
      .orderBy(asc(auditLog.at), asc(auditLog.id)),
  ]);
  return {
    id: o.id,
    number: o.number!,
    createdAt: o.createdAt.toISOString(),
    type: o.type,
    status: o.status,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    total: o.total,
    customerName: o.customerName,
    phone: o.phone,
    postcode: o.postcode,
    subtotal: o.subtotal,
    deliveryFee: o.deliveryFee,
    discount: o.discount,
    offerName: offerRows[0]?.name ?? null,
    email: o.email,
    address: o.address,
    note: o.note,
    prepMinutes: o.prepMinutes,
    rejectionReason: o.rejectionReason,
    scheduledFor: o.scheduledFor?.toISOString() ?? null,
    items: items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, options: i.options, lineTotal: i.lineTotal })),
    trail: trail.map((t) => ({ at: t.at.toISOString(), action: t.action, by: t.by, before: t.before, after: t.after })),
  };
}

// ---- export ------------------------------------------------------------------------------

export type ExportRow = {
  number: number; createdAt: string; type: string; status: string; paymentMethod: string; paymentStatus: string;
  subtotal: number; deliveryFee: number; discount: number; total: number;
  customerName: string; phone: string; email: string; address: string | null; postcode: string | null; note: string | null;
  offerName: string | null; prepMinutes: number | null; rejectionReason: string | null; items: string;
};

export async function countHistory(db: Db, f: HistoryQuery): Promise<number> {
  const [r] = await db.select({ n: count() }).from(order).where(buildWhere(f));
  return r.n;
}

/** Every matching order (newest first), at most EXPORT_CAP: the caller must check the count first. */
export async function exportHistory(db: Db, f: HistoryQuery): Promise<ExportRow[]> {
  const rows = await db
    .select({ o: order, offerName: offer.name })
    .from(order)
    .leftJoin(offer, eq(offer.id, order.offerId))
    .where(buildWhere(f))
    .orderBy(desc(order.createdAt), desc(order.id))
    .limit(EXPORT_CAP);
  const ids = rows.map((r) => r.o.id);
  const items: { orderId: number; name: string; quantity: number; options: { name: string }[] }[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    items.push(...(await db.select({ orderId: orderItem.orderId, name: orderItem.name, quantity: orderItem.quantity, options: orderItem.options }).from(orderItem).where(inArray(orderItem.orderId, ids.slice(i, i + 500))).orderBy(asc(orderItem.id))));
  }
  const text = (id: number) =>
    items
      .filter((i) => i.orderId === id)
      .map((i) => `${i.quantity} x ${i.name}${i.options.length ? ` (${i.options.map((o) => o.name).join(", ")})` : ""}`)
      .join("; ");
  return rows.map(({ o, offerName }) => ({
    number: o.number!, createdAt: o.createdAt.toISOString(), type: o.type, status: o.status, paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus,
    subtotal: o.subtotal, deliveryFee: o.deliveryFee, discount: o.discount, total: o.total, customerName: o.customerName, phone: o.phone, email: o.email,
    address: o.address, postcode: o.postcode, note: o.note, offerName: offerName ?? null, prepMinutes: o.prepMinutes, rejectionReason: o.rejectionReason, items: text(o.id),
  }));
}
