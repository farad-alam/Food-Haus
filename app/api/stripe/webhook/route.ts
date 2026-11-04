import { getDb } from "@/lib/db/client";
import { processStripeEvent, type StripeEvent } from "@/lib/stripe-webhook";
import { verifyStripeSignature } from "@/lib/stripe-signature";

// POST /api/stripe/webhook (R8.3-R8.5). The signature is checked against the
// RAW body before anything is parsed. Returns 2xx fast; a 5xx makes Stripe retry.
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("webhook not configured", { status: 503 });

  const raw = await request.text();
  const sig = await verifyStripeSignature(raw, request.headers.get("stripe-signature"), secret);
  if (!sig.ok) return new Response("invalid signature", { status: 400 });

  let event: StripeEvent;
  try {
    event = JSON.parse(raw);
    if (typeof event?.id !== "string" || typeof event?.type !== "string") throw new Error("shape");
  } catch {
    return new Response("bad payload", { status: 400 });
  }

  try {
    const result = await processStripeEvent(getDb(), event, new Date());
    return Response.json({ received: true, result });
  } catch (e) {
    console.error("stripe webhook failed", event.id, e instanceof Error ? e.message : e);
    return new Response("processing error", { status: 500 }); // Stripe will retry
  }
}
