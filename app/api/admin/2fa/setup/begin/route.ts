import { z } from "zod";
import { adminStore, jsonResponse } from "@/lib/admin/guard";
import { clientIp, MESSAGES, readJson, SERVER_ERROR } from "@/lib/admin/twofa-http";
import { beginEnrolment, checkSetupCredentials } from "@/lib/auth/enrolment";
import { groupSecret, qrDataUri } from "@/lib/auth/qr";

// POST /api/admin/2fa/setup/begin: first-time setup. Needs the one-time link AND the
// account password; one generic failure for every kind of wrong (throttled like sign-in).
const body = z.strictObject({
  token: z.string().min(10).max(200),
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  const r = await readJson(request, body);
  if ("response" in r) return r.response;
  try {
    const store = adminStore();
    const now = new Date();
    const chk = await checkSetupCredentials(store, r.data, clientIp(request), now);
    if (!chk.ok) return jsonResponse(chk.reason === "locked" ? 429 : 403, { ok: false, code: chk.reason.toUpperCase(), message: chk.reason === "locked" ? MESSAGES.locked : MESSAGES.setup_invalid });
    const { secret, uri } = await beginEnrolment(store, chk.user, now);
    return jsonResponse(200, { ok: true, qr: qrDataUri(uri), secret: groupSecret(secret) });
  } catch (e) {
    console.error("2fa setup begin failed", e instanceof Error ? e.message : e);
    return SERVER_ERROR();
  }
}
