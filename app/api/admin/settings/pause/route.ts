import { z } from "zod";
import { guard, jsonResponse } from "@/lib/admin/guard";
import { readJson } from "@/lib/admin/http";
import { loadSettingsView, setPause } from "@/lib/admin/settings";
import { getDb } from "@/lib/db/client";

// PUT /api/admin/settings/pause: the "Pause orders" switch with its message (R9.9).
// Takes effect on the very next checkout: the order API reads it from the database every time.
const body = z.strictObject({ paused: z.boolean(), message: z.string().trim().max(200).optional() });

export async function PUT(request: Request) {
  const g = await guard(request, "settings.edit");
  if ("response" in g) return g.response;
  const b = await readJson(request, body, 1_000);
  if ("response" in b) return b.response;
  try {
    const now = new Date();
    await setPause(getDb(), { userId: g.user.id, now }, b.data);
    return jsonResponse(200, { ok: true, status: (await loadSettingsView(getDb(), now)).status });
  } catch (e) {
    console.error("pause failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR", message: "Something went wrong. Please try again." });
  }
}
