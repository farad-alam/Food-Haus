import { guard, jsonResponse } from "@/lib/admin/guard";
import { loadSettingsView } from "@/lib/admin/settings";
import { getDb } from "@/lib/db/client";

// GET /api/admin/settings: everything the settings page shows, plus whether the
// shop is open right now and why (R9.9). Owner and manager only.
export async function GET(request: Request) {
  const g = await guard(request, "settings.edit");
  if ("response" in g) return g.response;
  try {
    return jsonResponse(200, { ok: true, ...(await loadSettingsView(getDb(), new Date())) });
  } catch (e) {
    console.error("settings load failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR" });
  }
}
