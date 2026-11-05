import { z } from "zod";
import { adminStore, jsonResponse, trustedOrigin } from "@/lib/admin/guard";
import { completePasswordReset } from "@/lib/auth/service";

// POST /api/admin/password-reset/complete: single-use, time-limited token;
// signs the user out of every session on success (R9.1).
const body = z.strictObject({ token: z.string().min(20).max(100), password: z.string().min(1).max(200) });

export async function POST(request: Request) {
  if (!trustedOrigin(request)) return jsonResponse(403, { ok: false, code: "CROSS_SITE" });
  let parsed: z.infer<typeof body>;
  try {
    const raw = await request.text();
    if (raw.length > 2_000) throw new Error("large");
    parsed = body.parse(JSON.parse(raw));
  } catch {
    return jsonResponse(400, { ok: false, code: "VALIDATION", message: "Enter a new password." });
  }
  try {
    const r = await completePasswordReset(adminStore(), { token: parsed.token, newPassword: parsed.password }, new Date());
    if (r.ok) return jsonResponse(200, { ok: true });
    if (r.reason === "weak_password") return jsonResponse(400, { ok: false, code: "WEAK_PASSWORD", message: r.message });
    return jsonResponse(400, { ok: false, code: "INVALID_TOKEN", message: "This link has expired or was already used. Request a new one." });
  } catch (e) {
    console.error("password reset failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR", message: "Something went wrong. Please try again." });
  }
}
