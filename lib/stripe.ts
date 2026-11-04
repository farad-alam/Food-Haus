// Minimal Stripe Checkout client over fetch (no SDK: smaller bundle, runs on
// Workers). Only what the order flow needs. `fetchImpl` is injectable for tests.

export type CheckoutSessionInput = {
  secretKey: string;
  orderId: number;
  orderNumber: number;
  amountPence: number;
  email: string;
  successUrl: string;
  cancelUrl: string;
  now: Date;
  fetchImpl?: typeof fetch;
};

export type StripeSession = { id: string; url: string };

const API = "https://api.stripe.com/v1/checkout/sessions";

async function parse(res: Response): Promise<StripeSession> {
  const body = (await res.json().catch(() => null)) as { id?: string; url?: string; error?: { message?: string } } | null;
  if (!res.ok || !body?.id || !body.url) {
    throw new Error(`Stripe error ${res.status}: ${body?.error?.message ?? "unexpected response"}`);
  }
  return { id: body.id, url: body.url };
}

/**
 * One line item for the whole basket at the server-computed total. Offers can
 * make the total differ from the sum of lines, and Stripe cannot take a
 * negative line, so the single summary line is what guarantees the customer is
 * charged exactly the total we stored. Itemisation lives in our own emails.
 */
export async function createCheckoutSession(i: CheckoutSessionInput): Promise<StripeSession> {
  const f = i.fetchImpl ?? fetch;
  const form = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "gbp",
    "line_items[0][price_data][unit_amount]": String(i.amountPence),
    "line_items[0][price_data][product_data][name]": `Food Haus order ${i.orderNumber}`,
    customer_email: i.email,
    client_reference_id: String(i.orderId),
    "metadata[order_id]": String(i.orderId),
    success_url: i.successUrl,
    cancel_url: i.cancelUrl,
    // R8.2: about 30 minutes. Stripe's minimum is 30, so ask for 31 to survive clock skew.
    expires_at: String(Math.floor(i.now.getTime() / 1000) + 31 * 60),
  });
  const res = await f(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${i.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      // Same order → same session even if we retry after a network failure.
      "Idempotency-Key": `food-haus-order-${i.orderId}`,
    },
    body: form,
  });
  return parse(res);
}

export async function retrieveCheckoutSession(secretKey: string, sessionId: string, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(`${API}/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${secretKey}` } });
  return parse(res);
}
