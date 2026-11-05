import { guard, jsonResponse } from "@/lib/admin/guard";
import { loadDashboard } from "@/lib/admin/dashboard";
import { getDb } from "@/lib/db/client";

// GET /api/admin/dashboard: today so far and the last 7 trading days (R9.12).
// Totals only. Owner and manager (reports.view). Polling does not count as activity.
export async function GET(request: Request) {
  const g = await guard(request, "reports.view", { touch: false });
  if ("response" in g) return g.response;
  try {
    return jsonResponse(200, { ok: true, ...(await loadDashboard(getDb(), new Date())) });
  } catch (e) {
    console.error("dashboard failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR" });
  }
}
