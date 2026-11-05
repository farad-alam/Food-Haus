import { guard, jsonResponse } from "@/lib/admin/guard";
import { auditInsert } from "@/lib/admin/audit";
import { countHistory, exportHistory } from "@/lib/admin/history";
import { EXPORT_CAP, parseHistoryQuery } from "@/lib/admin/history-schema";
import { toCsv } from "@/lib/csv";
import { getDb } from "@/lib/db/client";
import { londonParts } from "@/lib/hours";

// GET /api/admin/history/export: CSV of the filtered orders (R9.11). The file
// holds customers' names, phones, emails and addresses, so it is owner/manager
// only (orders.export) and every download is written to the audit log with the
// filters used and the number of rows (R9.13).
const HEADER = ["Order number", "Date", "Time", "Type", "Status", "Payment method", "Payment status", "Subtotal", "Delivery fee", "Discount", "Total", "Customer name", "Phone", "Email", "Address", "Postcode", "Note", "Offer", "Items", "Prep minutes", "Rejection reason"];
const pounds = (p: number) => (p / 100).toFixed(2);

export async function GET(request: Request) {
  // A download must be started from our own pages, not from another site's link or image.
  if (request.headers.get("sec-fetch-site") === "cross-site") return jsonResponse(403, { ok: false, code: "CROSS_SITE" });
  const g = await guard(request, "orders.export");
  if ("response" in g) return g.response;
  const parsed = parseHistoryQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return jsonResponse(400, { ok: false, code: "VALIDATION", message: parsed.message });

  try {
    const db = getDb();
    const n = await countHistory(db, parsed.query);
    if (n > EXPORT_CAP) {
      // Never silently truncate: a partial export looks complete.
      return jsonResponse(422, { ok: false, code: "TOO_MANY", message: `That is ${n.toLocaleString("en-GB")} orders. Narrow the dates so there are at most ${EXPORT_CAP.toLocaleString("en-GB")}.` });
    }
    const rows = await exportHistory(db, parsed.query);
    const now = new Date();
    await auditInsert(db, { userId: g.user.id, now }, "orders.export", "orders", null, { filters: parsed.query, rows: rows.length });

    const csv = toCsv(
      HEADER,
      rows.map((r) => {
        const d = new Date(r.createdAt);
        const p = londonParts(d);
        const time = `${String(Math.floor(p.minutes / 60)).padStart(2, "0")}:${String(p.minutes % 60).padStart(2, "0")}`;
        return [r.number, p.date, time, r.type, r.status, r.paymentMethod, r.paymentStatus, pounds(r.subtotal), pounds(r.deliveryFee), pounds(r.discount), pounds(r.total), r.customerName, r.phone, r.email, r.address, r.postcode, r.note, r.offerName, r.items, r.prepMinutes, r.rejectionReason];
      }),
    );
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="food-haus-orders-${londonParts(now).date}.csv"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("export failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR" });
  }
}
