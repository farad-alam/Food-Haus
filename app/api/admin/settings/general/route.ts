import { z } from "zod";
import { guard, jsonResponse } from "@/lib/admin/guard";
import { readJson } from "@/lib/admin/http";
import { saveGeneral } from "@/lib/admin/settings";
import { getDb } from "@/lib/db/client";

// PUT /api/admin/settings/general: default prep time and cash-order limits (R6.10, R6.15).
const body = z.strictObject({
  defaultPrepMinutes: z.number().int().min(1, "Prep time must be 1 to 180 minutes.").max(180, "Prep time must be 1 to 180 minutes."),
  cashMaxPence: z.number().int().min(100, "The cash limit must be at least £1.").max(100_000, "The cash limit cannot be over £1,000.").nullable(),
  cashDailyCapPerPhone: z.number().int().min(1).max(20),
  cashDailyCapPerIp: z.number().int().min(1).max(50),
});

export async function PUT(request: Request) {
  const g = await guard(request, "settings.edit");
  if ("response" in g) return g.response;
  const b = await readJson(request, body, 1_000);
  if ("response" in b) return b.response;
  try {
    await saveGeneral(getDb(), { userId: g.user.id, now: new Date() }, b.data);
    return jsonResponse(200, { ok: true });
  } catch (e) {
    console.error("save general failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR", message: "Something went wrong. Please try again." });
  }
}
