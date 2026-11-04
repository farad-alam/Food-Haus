import { and, asc, eq, isNull } from "drizzle-orm";
import { order, orderItem } from "@/db/schema";
import type { Db } from "@/lib/db/client";
import type { EmailMessage, EmailSender } from "./email";
import { formatPenceExact } from "./money";
import { paymentLine } from "./order-status";
import { fullAddress, shop } from "./shop";

// Order emails (R6.11, R11.10, R13.10).
//  - Customer confirmation: number, items, total, payment status, allergen
//    reminder, shop phone, and the private order-page link.
//  - Shop backup alert: number, items, payment, note. NEVER the customer's
//    contact details (R13.10).
// Every piece of customer-supplied text is HTML-escaped; subjects are built
// only from numbers so they cannot be used for header injection.

export type EmailOrder = {
  number: number;
  token: string;
  type: "delivery" | "collection";
  name: string;
  paymentMethod: "card" | "cash";
  paymentStatus: string;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  note: string | null;
  items: { name: string; quantity: number; options: { name: string; priceChange: number }[]; lineTotal: number }[];
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const itemText = (i: EmailOrder["items"][number]) =>
  `${i.quantity} x ${i.name}${i.options.length ? ` (${i.options.map((o) => o.name).join(", ")})` : ""}`;

export function renderCustomerEmail(o: EmailOrder, siteUrl: string): EmailMessage & { subject: string } {
  const link = `${siteUrl}/order/${o.token}`;
  const phone = shop.phoneDisplay;
  const allergen =
    `Allergies or intolerances? Check the allergen information at ${siteUrl}/allergens, and call us on ${phone} before you eat if you are unsure.` +
    (o.type === "delivery" ? " A printed allergen list is included in your delivery bag." : "");
  const totals = [
    ["Subtotal", formatPenceExact(o.subtotal)],
    ...(o.deliveryFee ? [["Delivery", formatPenceExact(o.deliveryFee)]] : []),
    ...(o.discount ? [["Offer", `-${formatPenceExact(o.discount)}`]] : []),
    ["Total", formatPenceExact(o.total)],
  ];
  const how = o.type === "delivery" ? "Delivery" : `Collection from ${fullAddress}`;

  const text = [
    `Thanks ${o.name}, we've got your order.`,
    "",
    `Order number: ${o.number}`,
    how,
    "",
    ...o.items.map((i) => `${itemText(i)}  ${formatPenceExact(i.lineTotal)}`),
    "",
    ...totals.map(([k, v]) => `${k}: ${v}`),
    `Payment: ${paymentLine(o)}`,
    ...(o.note ? ["", `Your note: ${o.note}`] : []),
    "",
    `Track your order: ${link}`,
    "",
    allergen,
    "",
    `Food Haus, ${fullAddress}. Phone ${phone}.`,
  ].join("\n");

  const rows = o.items
    .map((i) => `<tr><td style="padding:4px 0">${escapeHtml(itemText(i))}</td><td align="right" style="padding:4px 0">${formatPenceExact(i.lineTotal)}</td></tr>`)
    .join("");
  const totalRows = totals
    .map(([k, v]) => `<tr><td style="padding:2px 0">${k}</td><td align="right" style="padding:2px 0">${v}</td></tr>`)
    .join("");
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:16px">
<h1 style="font-size:22px;margin:0 0 8px">Thanks ${escapeHtml(o.name)}, we've got your order</h1>
<p style="margin:0 0 4px"><strong>Order number ${o.number}</strong></p>
<p style="margin:0 0 16px">${escapeHtml(how)}</p>
<table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #ddd;border-bottom:1px solid #ddd;margin-bottom:12px">${rows}</table>
<table width="100%" cellpadding="0" cellspacing="0">${totalRows}</table>
<p><strong>${escapeHtml(paymentLine(o))}</strong></p>
${o.note ? `<p>Your note: ${escapeHtml(o.note)}</p>` : ""}
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#F47B20;color:#000;padding:12px 20px;text-decoration:none;font-weight:bold;border-radius:6px">Track your order</a></p>
<p style="background:#fff4e8;padding:12px;border-radius:6px">${escapeHtml(allergen)}</p>
<p style="color:#555;font-size:13px">Food Haus, ${escapeHtml(fullAddress)}. Phone ${escapeHtml(phone)}.</p>
</body></html>`;

  return { to: "", subject: `Food Haus order ${o.number} confirmed`, text, html };
}

export function renderShopEmail(o: EmailOrder): EmailMessage & { subject: string } {
  const pay = o.paymentMethod === "cash" ? `CASH ${formatPenceExact(o.total)} to collect` : `PAID by card ${formatPenceExact(o.total)}`;
  const kind = o.type === "delivery" ? "DELIVERY" : "COLLECTION";
  const lines = o.items.map(itemText);
  const text = [`New order ${o.number}: ${kind}`, pay, "", ...lines, ...(o.note ? ["", `Note: ${o.note}`] : [])].join("\n");
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif">
<h1>New order ${o.number}: ${kind}</h1><p><strong>${escapeHtml(pay)}</strong></p>
<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>${o.note ? `<p>Note: ${escapeHtml(o.note)}</p>` : ""}
</body></html>`;
  return { to: "", subject: `New order ${o.number} - ${kind} - ${o.paymentMethod === "cash" ? "CASH" : "PAID"}`, text, html };
}

export type OrderEmailDeps = {
  db: Db;
  sender: EmailSender | null;
  siteUrl: string;
  /** Shop inbox for the backup alert (R13.10). Optional. */
  shopTo?: string;
};

/**
 * Sends the customer confirmation and the shop alert for a placed order.
 * Never throws (an email problem must never fail or roll back an order), and
 * sends each email at most once: the "sent" timestamp is claimed with a
 * conditional UPDATE BEFORE sending, and released again if sending fails.
 */
export async function sendOrderEmails(deps: OrderEmailDeps, orderId: number): Promise<void> {
  const { db, sender } = deps;
  if (!sender) {
    console.warn("email not configured; skipping order emails", orderId);
    return;
  }
  try {
    const [row] = await db.select().from(order).where(eq(order.id, orderId)).limit(1);
    // Only real, placed orders: card orders get emails after payment is confirmed.
    if (!row || !["received", "preparing", "ready", "out_for_delivery", "completed"].includes(row.status)) return;
    const lines = await db.select().from(orderItem).where(eq(orderItem.orderId, orderId)).orderBy(asc(orderItem.id));
    const data: EmailOrder = {
      number: row.number!,
      token: row.token,
      type: row.type,
      name: row.customerName,
      paymentMethod: row.paymentMethod,
      paymentStatus: row.paymentStatus,
      subtotal: row.subtotal,
      deliveryFee: row.deliveryFee,
      discount: row.discount,
      total: row.total,
      note: row.note,
      items: lines.map((l) => ({ name: l.name, quantity: l.quantity, options: l.options, lineTotal: l.lineTotal })),
    };

    const jobs: { column: "confirmationEmailedAt" | "shopNotifiedAt"; message: EmailMessage }[] = [
      { column: "confirmationEmailedAt", message: { ...renderCustomerEmail(data, deps.siteUrl), to: row.email } },
    ];
    if (deps.shopTo) jobs.push({ column: "shopNotifiedAt", message: { ...renderShopEmail(data), to: deps.shopTo } });

    for (const job of jobs) {
      const col = order[job.column];
      const claimed = await db
        .update(order)
        .set({ [job.column]: new Date() })
        .where(and(eq(order.id, orderId), isNull(col)))
        .returning({ id: order.id });
      if (claimed.length === 0) continue; // already sent (or being sent) elsewhere
      try {
        await sender.send(job.message);
      } catch (e) {
        await db.update(order).set({ [job.column]: null }).where(eq(order.id, orderId));
        console.error("order email failed", orderId, job.column, e instanceof Error ? e.message : e);
      }
    }
  } catch (e) {
    console.error("order emails aborted", orderId, e instanceof Error ? e.message : e);
  }
}
