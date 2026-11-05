// Transactional email over HTTPS (no SDK, runs on Workers). Provider: Resend
// (https://resend.com/docs/api-reference/emails/send-email). The rest of the
// app depends only on EmailSender, so changing provider means changing this file.

export type EmailMessage = { to: string; subject: string; text: string; html: string };
export interface EmailSender {
  send(m: EmailMessage): Promise<void>;
}

export function resendSender(apiKey: string, from: string, fetchImpl: typeof fetch = fetch, baseUrl = "https://api.resend.com"): EmailSender {
  return {
    async send(m) {
      const res = await fetchImpl(`${baseUrl}/emails`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
      });
      // Never include the response body or recipient in the error: logs must not hold PII.
      if (!res.ok) throw new Error(`Email provider error ${res.status}`);
    },
  };
}

/** Sender from environment, or null when email is not configured. */
export function emailSenderFromEnv(): EmailSender | null {
  const key = process.env.EMAIL_API_KEY;
  const from = process.env.EMAIL_FROM;
  // EMAIL_API_URL lets staging or tests point at a Resend-compatible endpoint; production leaves it unset.
  return key && from ? resendSender(key, from, fetch, process.env.EMAIL_API_URL || undefined) : null;
}
