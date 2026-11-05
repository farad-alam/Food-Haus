import { guard, jsonResponse } from "@/lib/admin/guard";
import { searchHistory } from "@/lib/admin/history";
import { parseHistoryQuery } from "@/lib/admin/history-schema";
import { getDb } from "@/lib/db/client";

// GET /api/admin/history: search and filter past orders (R9.11). Owner and manager
// only: results include customers' contact details.
export async function GET(request: Request) {
  const g = await guard(request, "orders.history");
  if ("response" in g) return g.response;
  const parsed = parseHistoryQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return jsonResponse(400, { ok: false, code: "VALIDATION", message: parsed.message });
  try {
    return jsonResponse(200, { ok: true, ...(await searchHistory(getDb(), parsed.query)) });
  } catch (e) {
    console.error("history search failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR" });
  }
}
