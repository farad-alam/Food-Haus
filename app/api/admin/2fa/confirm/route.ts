import { z } from "zod";
import { adminStore, guard, jsonResponse, secureDeployment } from "@/lib/admin/guard";
import { cookieName, parseCookie } from "@/lib/admin/cookie";
import { MESSAGES, readJson, SERVER_ERROR } from "@/lib/admin/twofa-http";
import { confirmEnrolment } from "@/lib/auth/enrolment";
import { requiresTwoStep } from "@/lib/auth/rbac";
import { hashToken } from "@/lib/auth/service";

// POST /api/admin/2fa/confirm: signed in; a code from the NEW authenticator switches it on,
// issues new recovery codes (shown once) and ends the account's other sessions.
const body = z.strictObject({ code: z.string().trim().min(1).max(20) });

export async function POST(request: Request) {
  const g = await guard(request, "orders.view");
  if ("response" in g) return g.response;
  const r = await readJson(request, body);
  if ("response" in r) return r.response;
  if (!requiresTwoStep(g.user.role)) return jsonResponse(403, { ok: false, code: "NOT_APPLICABLE" });
  try {
    const token = parseCookie(request.headers.get("cookie"), cookieName(secureDeployment()));
    const out = await confirmEnrolment(adminStore(), g.user, r.data.code, new Date(), { keepSessionHash: token ? await hashToken(token) : undefined });
    if (!out.ok) return jsonResponse(422, { ok: false, code: out.reason.toUpperCase(), message: out.reason === "link_used" ? MESSAGES.link_used : MESSAGES[out.reason] });
    return jsonResponse(200, { ok: true, recoveryCodes: out.recoveryCodes });
  } catch (e) {
    console.error("2fa confirm failed", e instanceof Error ? e.message : e);
    return SERVER_ERROR();
  }
}
