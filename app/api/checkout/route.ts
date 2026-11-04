import { runAfter } from "@/lib/run-after";
import { emailSenderFromEnv } from "@/lib/email";
import { sendOrderEmails } from "@/lib/order-email";
import { checkoutSchema } from "@/lib/checkout-schema";
import { createOrder } from "@/lib/checkout-service";
import { getDb } from "@/lib/db/client";
import { SITE_URL } from "@/lib/shop";

// POST /api/checkout (R6.14, R8.2, R13.7). Always dynamic: it writes orders.
const MAX_BODY_BYTES = 16_000;

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json(415, { ok: false, code: "BAD_CONTENT_TYPE", message: "Send JSON." });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { ok: false, code: "TOO_LARGE", message: "Request too large." });

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, code: "BAD_JSON", message: "Invalid JSON." });
  }

  const parsed = checkoutSchema.safeParse(data);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join(".") || "_"] ??= issue.message;
    return json(400, { ok: false, code: "VALIDATION", message: "Please check your details.", fields });
  }

  try {
    const db = getDb();
    const outcome = await createOrder(
      {
        db,
        // Emails run after the response so a slow provider never delays the customer.
        onOrderPlaced: (id) =>
          runAfter(() =>
            sendOrderEmails(
              { db, sender: emailSenderFromEnv(), siteUrl: SITE_URL, shopTo: process.env.ORDER_NOTIFY_EMAIL || undefined },
              id,
            ),
          ),
        now: new Date(),
        siteUrl: SITE_URL,
        // Only Cloudflare's header is trusted: X-Forwarded-For is client-controlled.
        clientIp: request.headers.get("cf-connecting-ip"),
        ipHashKey: process.env.SECRET_BOX_KEY,
        stripeSecretKey: process.env.STRIPE_SECRET_KEY || undefined,
        turnstileSecret: process.env.TURNSTILE_SECRET_KEY || undefined,
      },
      parsed.data,
    );
    return json(outcome.status, outcome.body);
  } catch (e) {
    console.error("checkout failed", e instanceof Error ? e.message : e); // never log the body: it holds PII
    return json(500, { ok: false, code: "SERVER_ERROR", message: "Something went wrong. Please try again." });
  }
}
