import { guard, jsonResponse } from "@/lib/admin/guard";
import { readJson } from "@/lib/admin/http";
import { saveContact } from "@/lib/admin/settings";
import { contactSchema } from "@/lib/contact";
import { getDb } from "@/lib/db/client";
import { refreshSettingsCache } from "@/lib/menu-cache";

// PUT /api/admin/settings/contact: the shop's phone, email, address and company details (R9.9, R11.5, R11.11).
// Every field is validated and tidied; the footer, contact page, structured data, emails and receipts all read these.
export async function PUT(request: Request) {
  const g = await guard(request, "settings.edit");
  if ("response" in g) return g.response;
  const b = await readJson(request, contactSchema, 4_000);
  if ("response" in b) return b.response;
  try {
    await saveContact(getDb(), { userId: g.user.id, now: new Date() }, b.data);
    refreshSettingsCache();
    return jsonResponse(200, { ok: true, contact: b.data });
  } catch (e) {
    console.error("save contact failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR", message: "Something went wrong. Please try again." });
  }
}
