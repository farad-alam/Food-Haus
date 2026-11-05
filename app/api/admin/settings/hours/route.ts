import { z } from "zod";
import { guard, jsonResponse } from "@/lib/admin/guard";
import { readJson, statusFor } from "@/lib/admin/http";
import { TIME_RE } from "@/lib/admin/hours-validate";
import { loadSettingsView, saveHours } from "@/lib/admin/settings";
import { getDb } from "@/lib/db/client";

// PUT /api/admin/settings/hours: replaces the whole weekly schedule atomically.
const body = z.strictObject({
  windows: z
    .array(z.strictObject({ weekday: z.number().int().min(0).max(6), opensAt: z.string().regex(TIME_RE, "Enter times like 12:00."), closesAt: z.string().regex(TIME_RE, "Enter times like 12:00.") }))
    .max(21),
});

export async function PUT(request: Request) {
  const g = await guard(request, "settings.edit");
  if ("response" in g) return g.response;
  const b = await readJson(request, body, 4_000);
  if ("response" in b) return b.response;
  try {
    const now = new Date();
    const r = await saveHours(getDb(), { userId: g.user.id, now }, b.data.windows);
    if (!r.ok) return jsonResponse(statusFor(r.code), r);
    return jsonResponse(200, { ok: true, status: (await loadSettingsView(getDb(), now)).status });
  } catch (e) {
    console.error("save hours failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR", message: "Something went wrong. Please try again." });
  }
}
