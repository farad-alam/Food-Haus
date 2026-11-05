import { z } from "zod";
import { adminStore, guard, jsonResponse } from "@/lib/admin/guard";
import { clientIp, MESSAGES, readJson, SERVER_ERROR } from "@/lib/admin/twofa-http";
import { reauthenticate, regenerateRecoveryCodes } from "@/lib/auth/enrolment";
import { requiresTwoStep } from "@/lib/auth/rbac";

// POST /api/admin/2fa/recovery-codes: password + a current code, then ten NEW codes
// (shown once) replace every old one.
const body = z.strictObject({ password: z.string().min(1).max(200), code: z.string().trim().min(1).max(20) });

export async function POST(request: Request) {
  const g = await guard(request, "orders.view");
  if ("response" in g) return g.response;
  const r = await readJson(request, body);
  if ("response" in r) return r.response;
  if (!requiresTwoStep(g.user.role)) return jsonResponse(403, { ok: false, code: "NOT_APPLICABLE" });
  try {
    const store = adminStore();
    const user = await store.findUserById(g.user.id);
    if (!user) return jsonResponse(401, { ok: false, code: "UNAUTHENTICATED" });
    const re = await reauthenticate(store, user, r.data, clientIp(request), new Date());
    if (!re.ok) return jsonResponse(re.reason === "locked" ? 429 : 403, { ok: false, code: re.reason.toUpperCase(), message: MESSAGES[re.reason] });
    return jsonResponse(200, { ok: true, recoveryCodes: await regenerateRecoveryCodes(store, user.id) });
  } catch (e) {
    console.error("2fa recovery codes failed", e instanceof Error ? e.message : e);
    return SERVER_ERROR();
  }
}
