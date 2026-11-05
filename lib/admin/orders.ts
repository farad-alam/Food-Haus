import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { auditLog, offer, order, orderItem, settings } from "@/db/schema";
import type { Db } from "@/lib/db/client";

// Kitchen order board data and status changes (R9.3-R9.5, R8.7, R9.13).

export const ACTIVE = ["received", "preparing", "ready", "out_for_delivery"] as const;
const CLOSED = ["completed", "rejected", "cancelled", "refunded"] as const;
export const RECENT_CLOSED_HOURS = 3;

export type BoardOrder = {
  id: number;
  number: number;
  status: string;
  type: "delivery" | "collection";
  paymentMethod: "card" | "cash";
  paymentStatus: string;
  total: number;
  customerName: string;
  phone: string;
  address: string | null;
  postcode: string | null;
  note: string | null;
  prepMinutes: number | null;
  rejectionReason: string | null;
  createdAt: string;
  items: { name: string; quantity: number; options: { name: string; priceChange: number }[] }[];
};

/**
 * Orders for the board: active ones, plus recently finished ones for reference.
 * `pending_payment` is never included: unpaid card orders must not reach the
 * kitchen (R8.7). Contains customer contact details, so only call behind guard().
 */
export async function loadBoard(db: Db, now: Date): Promise<{ active: BoardOrder[]; recent: BoardOrder[]; defaultPrepMinutes: number }> {
  const since = new Date(now.getTime() - RECENT_CLOSED_HOURS * 3_600_000);
  const rows = await db
    .select()
    .from(order)
    .where(
      sql`(${inArray(order.status, [...ACTIVE])}) or (${inArray(order.status, [...CLOSED])} and ${gte(order.updatedAt, since)})`,
    )
    .orderBy(asc(order.createdAt));
  const ids = rows.map((r) => r.id);
  const lines = ids.length ? await db.select().from(orderItem).where(inArray(orderItem.orderId, ids)).orderBy(asc(orderItem.id)) : [];
  const [s] = await db.select({ d: settings.defaultPrepMinutes }).from(settings).where(eq(settings.id, 1)).limit(1);

  const toBoard = (r: (typeof rows)[number]): BoardOrder => ({
    id: r.id,
    number: r.number!,
    status: r.status,
    type: r.type,
    paymentMethod: r.paymentMethod,
    paymentStatus: r.paymentStatus,
    total: r.total,
    customerName: r.customerName,
    phone: r.phone,
    address: r.address,
    postcode: r.postcode,
    note: r.note,
    prepMinutes: r.prepMinutes,
    rejectionReason: r.rejectionReason,
    createdAt: r.createdAt.toISOString(),
    items: lines.filter((l) => l.orderId === r.id).map((l) => ({ name: l.name, quantity: l.quantity, options: l.options })),
  });
  const all = rows.map(toBoard);
  return {
    active: all.filter((o) => (ACTIVE as readonly string[]).includes(o.status)),
    recent: all.filter((o) => !(ACTIVE as readonly string[]).includes(o.status)).reverse(),
    defaultPrepMinutes: s?.d ?? 20,
  };
}

// ---- status changes ---------------------------------------------------------

export type OrderAction = "accept" | "reject" | "ready" | "out_for_delivery" | "completed";
export const ORDER_ACTIONS: readonly OrderAction[] = ["accept", "reject", "ready", "out_for_delivery", "completed"];

type Type = "delivery" | "collection";
type Status = typeof order.$inferSelect.status;
/** From-statuses allowed for each action, and the status it moves to. */
export function transition(action: OrderAction, type: Type): { from: Status[]; to: Status } {
  switch (action) {
    case "accept":
      return { from: ["received"], to: "preparing" };
    case "reject":
      return { from: ["received", "preparing"], to: "rejected" };
    case "ready":
      return { from: ["preparing"], to: "ready" };
    case "out_for_delivery":
      return { from: type === "delivery" ? ["ready"] : [], to: "out_for_delivery" };
    case "completed":
      return { from: type === "delivery" ? ["out_for_delivery"] : ["ready"], to: "completed" };
  }
}

export type ActionInput = { orderId: number; action: OrderAction; prepMinutes?: number; reason?: string; userId: number; now: Date };
export type ActionResult =
  | { ok: true; status: string; refundNeeded: boolean }
  | { ok: false; code: "NOT_FOUND" | "INVALID" | "BAD_TRANSITION"; message: string; currentStatus?: string };

export async function applyOrderAction(db: Db, a: ActionInput): Promise<ActionResult> {
  const [o] = await db.select().from(order).where(eq(order.id, a.orderId)).limit(1);
  if (!o) return { ok: false, code: "NOT_FOUND", message: "Order not found." };

  if (a.action === "accept" && !(Number.isInteger(a.prepMinutes) && a.prepMinutes! >= 1 && a.prepMinutes! <= 180)) {
    return { ok: false, code: "INVALID", message: "Choose a preparation time between 1 and 180 minutes." };
  }
  const reason = a.reason?.trim();
  if (a.action === "reject" && (!reason || reason.length > 200)) {
    return { ok: false, code: "INVALID", message: "Give the customer a reason (up to 200 characters)." };
  }

  const t = transition(a.action, o.type);
  if (!t.from.includes(o.status)) {
    return {
      ok: false,
      code: "BAD_TRANSITION",
      currentStatus: o.status,
      message: "This order has already moved on. The board will refresh.",
    };
  }

  const guardStatus = and(eq(order.id, o.id), inArray(order.status, t.from));
  const set = {
    status: t.to,
    updatedAt: a.now,
    ...(a.action === "accept" ? { prepMinutes: a.prepMinutes } : {}),
    ...(a.action === "reject" ? { rejectionReason: reason } : {}),
  };

  let changed: { id: number }[];
  if (a.action === "reject") {
    // Give a used promo back in the SAME transaction as the status change (the
    // release runs first so its subquery still sees the old status).
    const [, upd] = await db.batch([
      db
        .update(offer)
        .set({ usedCount: sql`greatest(${offer.usedCount} - 1, 0)` })
        .where(eq(offer.id, sql`(select ${order.offerId} from ${order} where ${guardStatus})`)),
      db.update(order).set(set).where(guardStatus).returning({ id: order.id }),
    ]);
    changed = upd;
  } else {
    changed = await db.update(order).set(set).where(guardStatus).returning({ id: order.id });
  }
  // Lost a race with another tablet: the conditional update matched nothing.
  if (changed.length === 0) {
    const [now] = await db.select({ s: order.status }).from(order).where(eq(order.id, o.id));
    return { ok: false, code: "BAD_TRANSITION", currentStatus: now?.s, message: "This order has already moved on. The board will refresh." };
  }

  // R9.13: with a shared kitchen login this is the only record of who did what.
  await db.insert(auditLog).values({
    userId: a.userId,
    action: `order.${a.action}`,
    entity: `order:${o.id}`,
    before: { status: o.status },
    after: { status: t.to, ...(a.prepMinutes ? { prepMinutes: a.prepMinutes } : {}), ...(reason ? { reason } : {}) },
    at: a.now,
  });

  return { ok: true, status: t.to, refundNeeded: a.action === "reject" && o.paymentMethod === "card" && o.paymentStatus === "paid" };
}
