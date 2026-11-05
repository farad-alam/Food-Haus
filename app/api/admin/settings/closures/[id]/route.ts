import { guard, jsonResponse } from "@/lib/admin/guard";
import { idFromParam, statusFor } from "@/lib/admin/http";
import { removeClosure } from "@/lib/admin/settings";
import { getDb } from "@/lib/db/client";
import { refreshSettingsCache } from "@/lib/menu-cache";

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard(request, "settings.edit");
  if ("response" in g) return g.response;
  const id = idFromParam((await ctx.params).id);
  if (id === null) return jsonResponse(404, { ok: false, code: "NOT_FOUND" });
  try {
    const r = await removeClosure(getDb(), { userId: g.user.id, now: new Date() }, id);
    if (r.ok) refreshSettingsCache();
    return jsonResponse(r.ok ? 200 : statusFor(r.code), r);
  } catch (e) {
    console.error("remove closure failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR", message: "Something went wrong. Please try again." });
  }
}
