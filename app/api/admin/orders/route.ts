import { guard, jsonResponse } from "@/lib/admin/guard";
import { loadBoard } from "@/lib/admin/orders";
import { getDb } from "@/lib/db/client";

// GET /api/admin/orders: the board's feed (polled every few seconds). Polling
// does NOT count as activity, so an open board cannot defeat the owner/manager
// idle timeout (R9.2). Contains customer contact details: always behind guard().
export async function GET(request: Request) {
  const g = await guard(request, "orders.view", { touch: false });
  if ("response" in g) return g.response;
  try {
    const now = new Date();
    return jsonResponse(200, { ok: true, serverTime: now.toISOString(), ...(await loadBoard(getDb(), now)) });
  } catch (e) {
    console.error("board load failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR" });
  }
}
