import { guard, jsonResponse } from "@/lib/admin/guard";
import { loadMenuAdmin } from "@/lib/admin/menu";
import { getDb } from "@/lib/db/client";

// GET /api/admin/menu: everything the menu manager shows, including hidden items.
export async function GET(request: Request) {
  const g = await guard(request, "menu.edit");
  if ("response" in g) return g.response;
  try {
    return jsonResponse(200, { ok: true, ...(await loadMenuAdmin(getDb())) });
  } catch (e) {
    console.error("menu load failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR" });
  }
}
