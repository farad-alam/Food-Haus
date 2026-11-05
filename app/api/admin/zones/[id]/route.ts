import { guard, jsonResponse } from "@/lib/admin/guard";
import { idFromParam, readJson, statusFor } from "@/lib/admin/http";
import { deleteZone, updateZone } from "@/lib/admin/settings";
import { zoneUpdateSchema } from "@/lib/admin/zone-schema";
import { getDb } from "@/lib/db/client";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: Request, ctx: Ctx) {
  const g = await guard(request, "settings.edit");
  if ("response" in g) return g.response;
  const id = idFromParam((await ctx.params).id);
  if (id === null) return jsonResponse(404, { ok: false, code: "NOT_FOUND" });
  const b = await readJson(request, zoneUpdateSchema, 1_000);
  if ("response" in b) return b.response;
  try {
    const r = await updateZone(getDb(), { userId: g.user.id, now: new Date() }, id, b.data);
    return jsonResponse(r.ok ? 200 : statusFor(r.code), r);
  } catch (e) {
    console.error("update zone failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR", message: "Something went wrong. Please try again." });
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  const g = await guard(request, "settings.edit");
  if ("response" in g) return g.response;
  const id = idFromParam((await ctx.params).id);
  if (id === null) return jsonResponse(404, { ok: false, code: "NOT_FOUND" });
  try {
    const r = await deleteZone(getDb(), { userId: g.user.id, now: new Date() }, id);
    return jsonResponse(r.ok ? 200 : statusFor(r.code), r);
  } catch (e) {
    console.error("delete zone failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR", message: "Something went wrong. Please try again." });
  }
}
