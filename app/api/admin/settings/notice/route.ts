import { z } from "zod";
import { guard, jsonResponse } from "@/lib/admin/guard";
import { readJson } from "@/lib/admin/http";
import { saveNotice } from "@/lib/admin/settings";
import { getDb } from "@/lib/db/client";
import { refreshSettingsCache } from "@/lib/menu-cache";
import { MAX_NOTICE } from "@/lib/notice-text";

// PUT /api/admin/settings/notice: the site-wide notice bar (R9.9). Empty text removes it.
const body = z.strictObject({ text: z.string().max(MAX_NOTICE * 2, `The notice must be ${MAX_NOTICE} characters or fewer.`).nullable() });

export async function PUT(request: Request) {
  const g = await guard(request, "settings.edit");
  if ("response" in g) return g.response;
  const b = await readJson(request, body, 2_000);
  if ("response" in b) return b.response;
  try {
    await saveNotice(getDb(), { userId: g.user.id, now: new Date() }, b.data.text);
    refreshSettingsCache();
    return jsonResponse(200, { ok: true });
  } catch (e) {
    console.error("save notice failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR", message: "Something went wrong. Please try again." });
  }
}
