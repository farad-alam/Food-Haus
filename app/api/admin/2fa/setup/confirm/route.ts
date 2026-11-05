import { z } from "zod";
import { adminStore, jsonResponse } from "@/lib/admin/guard";
import { clientIp, MESSAGES, readJson, SERVER_ERROR } from "@/lib/admin/twofa-http";
import { checkSetupCredentials, confirmEnrolment } from "@/lib/auth/enrolment";
import { hashToken } from "@/lib/auth/service";

// POST /api/admin/2fa/setup/confirm: link + password again, plus a code from the new
// authenticator. Only then is 2FA switched on and the recovery codes shown (once).
const body = z.strictObject({
  token: z.string().min(10).max(200),
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
  code: z.string().trim().min(1).max(20),
});

export async function POST(request: Request) {
  const r = await readJson(request, body);
  if ("response" in r) return r.response;
  try {
    const store = adminStore();
    const now = new Date();
    const chk = await checkSetupCredentials(store, r.data, clientIp(request), now);
    if (!chk.ok) return jsonResponse(chk.reason === "locked" ? 429 : 403, { ok: false, code: chk.reason.toUpperCase(), message: chk.reason === "locked" ? MESSAGES.locked : MESSAGES.setup_invalid });
    const out = await confirmEnrolment(store, chk.user, r.data.code, now, { setupTokenHash: await hashToken(r.data.token) });
    if (!out.ok) return jsonResponse(out.reason === "invalid_code" ? 422 : 409, { ok: false, code: out.reason.toUpperCase(), message: MESSAGES[out.reason] });
    return jsonResponse(200, { ok: true, recoveryCodes: out.recoveryCodes });
  } catch (e) {
    console.error("2fa setup confirm failed", e instanceof Error ? e.message : e);
    return SERVER_ERROR();
  }
}
