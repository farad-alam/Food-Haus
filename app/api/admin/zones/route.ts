import { guard, jsonResponse } from "@/lib/admin/guard";
import { readJson, statusFor } from "@/lib/admin/http";
import { createZone } from "@/lib/admin/settings";
import { zoneCreateSchema } from "@/lib/admin/zone-schema";
import { getDb } from "@/lib/db/client";

// POST /api/admin/zones: add a delivery zone by postcode district (R9.10).
export async function POST(request: Request) {
  const g = await guard(request, "settings.edit");
  if ("response" in g) return g.response;
  const b = await readJson(request, zoneCreateSchema, 1_000);
  if ("response" in b) return b.response;
  try {
    const r = await createZone(getDb(), { userId: g.user.id, now: new Date() }, b.data);
    return r.ok ? jsonResponse(201, r) : jsonResponse(statusFor(r.code), r);
  } catch (e) {
    console.error("create zone failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR", message: "Something went wrong. Please try again." });
  }
}
