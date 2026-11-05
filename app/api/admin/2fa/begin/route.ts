import { z } from "zod";
import { adminStore, guard, jsonResponse } from "@/lib/admin/guard";
import { clientIp, MESSAGES, readJson, SERVER_ERROR } from "@/lib/admin/twofa-http";
import { beginEnrolment, reauthenticate } from "@/lib/auth/enrolment";
import { groupSecret, qrDataUri } from "@/lib/auth/qr";
import { requiresTwoStep } from "@/lib/auth/rbac";

// POST /api/admin/2fa/begin: signed in, replacing the authenticator. Needs the password
// AND a current code (or a recovery code). Nothing changes until /confirm succeeds.
const body = z.strictObject({ password: z.string().min(1).max(200), code: z.string().trim().min(1).max(20) });

export async function POST(request: Request) {
  const g = await guard(request, "orders.view");
  if ("response" in g) return g.response;
  const r = await readJson(request, body);
  if ("response" in r) return r.response;
  if (!requiresTwoStep(g.user.role)) return jsonResponse(403, { ok: false, code: "NOT_APPLICABLE", message: "Two-step login is not used for this account." });
  try {
    const store = adminStore();
    const now = new Date();
    const user = await store.findUserById(g.user.id);
    if (!user) return jsonResponse(401, { ok: false, code: "UNAUTHENTICATED" });
    const re = await reauthenticate(store, user, r.data, clientIp(request), now);
    if (!re.ok) return jsonResponse(re.reason === "locked" ? 429 : 403, { ok: false, code: re.reason.toUpperCase(), message: MESSAGES[re.reason] });
    const { secret, uri } = await beginEnrolment(store, user, now);
    return jsonResponse(200, { ok: true, qr: qrDataUri(uri), secret: groupSecret(secret) });
  } catch (e) {
    console.error("2fa begin failed", e instanceof Error ? e.message : e);
    return SERVER_ERROR();
  }
}
