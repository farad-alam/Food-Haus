import { asc, eq } from "drizzle-orm";
import { order, orderItem } from "@/db/schema";
import type { Db } from "@/lib/db/client";
import type { OrderView } from "./order-status";

// 22 base64url chars = 128 bits (lib/token.ts). Anything else cannot match, so
// reject it before touching the database.
export const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

/**
 * Loads an order by its secret token, returning ONLY what the customer's own
 * page needs: no phone, email, address, notes or internal ids.
 */
export async function loadOrderByToken(db: Db, token: string): Promise<OrderView | null> {
  if (!TOKEN_RE.test(token)) return null;
  const [o] = await db.select().from(order).where(eq(order.token, token)).limit(1);
  if (!o) return null;
  const lines = await db.select().from(orderItem).where(eq(orderItem.orderId, o.id)).orderBy(asc(orderItem.id));
  return {
    number: o.number!,
    type: o.type,
    status: o.status,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    subtotal: o.subtotal,
    deliveryFee: o.deliveryFee,
    discount: o.discount,
    total: o.total,
    prepMinutes: o.prepMinutes,
    rejectionReason: o.rejectionReason,
    items: lines.map((l) => ({ name: l.name, quantity: l.quantity, options: l.options, lineTotal: l.lineTotal })),
  };
}
