import { guard, jsonResponse } from "@/lib/admin/guard";
import { getDb } from "@/lib/db/client";
import { londonParts } from "@/lib/hours";
import { loadDayTotals } from "@/lib/sales-report-job";

// GET /api/admin/reports?day=YYYY-MM-DD: the totals behind the daily sales email
// (R9.12), for owner and manager. Totals only: no customer details. Defaults to today.
const realDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export async function GET(request: Request) {
  const g = await guard(request, "reports.view");
  if ("response" in g) return g.response;

  const now = new Date();
  const day = new URL(request.url).searchParams.get("day") ?? londonParts(now).date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !realDate(day) || Date.parse(`${day}T00:00:00Z`) < now.getTime() - 800 * 86_400_000) {
    return jsonResponse(400, { ok: false, code: "VALIDATION", message: "Use a real date like 2026-11-04, within the last two years." });
  }
  try {
    const { totals, week, period } = await loadDayTotals(getDb(), day);
    return jsonResponse(200, { ok: true, day, period: { start: period.start.toISOString(), end: period.end.toISOString(), closesAt: period.closesAt?.toISOString() ?? null }, totals, week });
  } catch (e) {
    console.error("report load failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR" });
  }
}
