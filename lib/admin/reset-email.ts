import { escapeHtml } from "@/lib/order-email";
import type { EmailMessage } from "@/lib/email";

// Password-reset email (R9.1). Contains only the single-use link; the token is
// never logged. Valid for 30 minutes (RESET_TTL_MS).
export function renderResetEmail(link: string): Omit<EmailMessage, "to"> {
  const text = `Someone asked to reset the password for your Food Haus admin account.\n\nSet a new password (the link works once and expires in 30 minutes):\n${link}\n\nIf this wasn't you, ignore this email: your password has not changed.`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:16px">
<p>Someone asked to reset the password for your Food Haus admin account.</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#F47B20;color:#000;padding:12px 20px;text-decoration:none;font-weight:bold;border-radius:6px">Set a new password</a></p>
<p style="color:#555;font-size:13px">The link works once and expires in 30 minutes. If this wasn't you, ignore this email: your password has not changed.</p>
</body></html>`;
  return { subject: "Reset your Food Haus admin password", text, html };
}
