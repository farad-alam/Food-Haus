import { z } from "zod";
import { guard, jsonResponse } from "@/lib/admin/guard";
import { readJson, statusFor } from "@/lib/admin/http";
import { addClosure } from "@/lib/admin/settings";
import { getDb } from "@/lib/db/client";
import { refreshSettingsCache } from "@/lib/menu-cache";

// POST /api/admin/settings/closures: mark a whole day closed (bank holiday etc.).
const realDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const body = z.strictObject({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.").refine(realDate, "That is not a real date."),
  reason: z.string().trim().max(100).optional(),
});

export async function POST(request: Request) {
  const g = await guard(request, "settings.edit");
  if ("response" in g) return g.response;
  const b = await readJson(request, body, 1_000);
  if ("response" in b) return b.response;
  try {
    const r = await addClosure(getDb(), { userId: g.user.id, now: new Date() }, b.data);
    if (r.ok) refreshSettingsCache();
    return r.ok ? jsonResponse(201, r) : jsonResponse(statusFor(r.code), r);
  } catch (e) {
    console.error("add closure failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR", message: "Something went wrong. Please try again." });
  }
}
