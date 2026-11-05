import { z } from "zod";
import { adminStore, jsonResponse, trustedOrigin } from "@/lib/admin/guard";
import { renderResetEmail } from "@/lib/admin/reset-email";
import { requestPasswordReset } from "@/lib/auth/service";
import { emailSenderFromEnv } from "@/lib/email";
import { runAfter } from "@/lib/run-after";
import { SITE_URL } from "@/lib/shop";
import { verifyTurnstile } from "@/lib/turnstile";

// POST /api/admin/password-reset/request (R9.1). The response is IDENTICAL
// whether or not the email belongs to an account: no account enumeration.
const body = z.strictObject({ email: z.string().trim().min(1).max(254), turnstileToken: z.string().max(2048).optional() });
const SAME = { ok: true, message: "If that account exists, we have emailed a link to reset the password." };

export async function POST(request: Request) {
  if (!trustedOrigin(request)) return jsonResponse(403, { ok: false, code: "CROSS_SITE" });
  let parsed: z.infer<typeof body>;
  try {
    const raw = await request.text();
    if (raw.length > 2_000) throw new Error("large");
    parsed = body.parse(JSON.parse(raw));
  } catch {
    return jsonResponse(400, { ok: false, code: "VALIDATION", message: "Enter your email address." });
  }
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (secret && !(await verifyTurnstile(parsed.turnstileToken, secret, request.headers.get("cf-connecting-ip")))) {
    return jsonResponse(403, { ok: false, code: "BOT_CHECK_FAILED", message: "We could not verify you are human. Please try again." });
  }
  try {
    const { delivery } = await requestPasswordReset(adminStore(), parsed.email, new Date());
    if (delivery) {
      const link = `${SITE_URL}/admin/reset/${delivery.token}`;
      runAfter(async () => {
        const sender = emailSenderFromEnv();
        if (!sender) return console.warn("email not configured; password reset email not sent");
        await sender.send({ to: delivery.email, ...renderResetEmail(link) });
      });
    }
  } catch (e) {
    console.error("password reset request failed", e instanceof Error ? e.message : e);
  }
  return jsonResponse(200, SAME); // same body for every outcome, including errors
}
