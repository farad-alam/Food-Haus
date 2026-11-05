import { guard, jsonResponse } from "@/lib/admin/guard";
import { loadOrderDetail } from "@/lib/admin/history";
import { getDb } from "@/lib/db/client";

// GET /api/admin/history/[number]: one past order, by its human-friendly number,
// with items, totals, customer details and who did what (R9.11, R9.13).
export async function GET(request: Request, ctx: { params: Promise<{ number: string }> }) {
  const g = await guard(request, "orders.history");
  if ("response" in g) return g.response;
  const { number } = await ctx.params;
  if (!/^\d{1,9}$/.test(number)) return jsonResponse(404, { ok: false, code: "NOT_FOUND" });
  try {
    const detail = await loadOrderDetail(getDb(), Number(number));
    return detail ? jsonResponse(200, { ok: true, order: detail }) : jsonResponse(404, { ok: false, code: "NOT_FOUND" });
  } catch (e) {
    console.error("order detail failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR" });
  }
}
