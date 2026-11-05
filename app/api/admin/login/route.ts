import { z } from "zod";
import { adminStore, jsonResponse, secureDeployment, trustedOrigin } from "@/lib/admin/guard";
import { cookieName, sessionCookie } from "@/lib/admin/cookie";
import { login } from "@/lib/auth/service";
import { verifyTurnstile } from "@/lib/turnstile";

// POST /api/admin/login (R9.1, R9.2, R13.3). Two-step for owner/manager: the
// first request returns TOTP_REQUIRED once the password is right, the second
// repeats email + password with the 6-digit code.
const body = z.strictObject({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
  totp: z.string().trim().regex(/^(\d{6}|[A-Za-z0-9 -]{10,14})$/).optional(), // authenticator code, or a recovery code (XXXXX-XXXXX)
  turnstileToken: z.string().max(2048).optional(),
});

const MESSAGES = {
  invalid_credentials: "Email or password is incorrect.",
  locked: "Too many attempts. Please wait 15 minutes and try again.",
  invalid_totp: "That code is wrong or has already been used. Wait for a new code and try again, or use a recovery code.",
  totp_enrolment_required: "Two-step login is not set up for this account yet. Open the setup link the owner sent you, or ask them for a new one.",
} as const;

export async function POST(request: Request) {
  if (!trustedOrigin(request)) return jsonResponse(403, { ok: false, code: "CROSS_SITE" });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return jsonResponse(415, { ok: false, code: "BAD_CONTENT_TYPE" });
  }
  const raw = await request.text();
  if (raw.length > 4_000) return jsonResponse(413, { ok: false, code: "TOO_LARGE" });
  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse(JSON.parse(raw));
  } catch {
    return jsonResponse(400, { ok: false, code: "VALIDATION", message: "Enter your email and password." });
  }

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown"; // only Cloudflare's header is trusted
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (secret && !(await verifyTurnstile(parsed.turnstileToken, secret, ip === "unknown" ? null : ip))) {
    return jsonResponse(403, { ok: false, code: "BOT_CHECK_FAILED", message: "We could not verify you are human. Please try again." });
  }

  try {
    const r = await login(adminStore(), { email: parsed.email, password: parsed.password, totp: parsed.totp, ip }, new Date());
    if (r.ok) {
      const secure = secureDeployment();
      return jsonResponse(200, { ok: true, role: r.user.role, ...(r.recoveryCodeUsed ? { recoveryCodeUsed: true, recoveryCodesLeft: r.recoveryCodesLeft } : {}) }, { "Set-Cookie": sessionCookie(cookieName(secure), r.token, r.expiresAt, secure) });
    }
    if (r.reason === "totp_required") return jsonResponse(401, { ok: false, code: "TOTP_REQUIRED" });
    const status = r.reason === "locked" ? 429 : r.reason === "totp_enrolment_required" ? 403 : 401;
    return jsonResponse(status, { ok: false, code: r.reason.toUpperCase(), message: MESSAGES[r.reason] });
  } catch (e) {
    console.error("admin login failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR", message: "Something went wrong. Please try again." });
  }
}
