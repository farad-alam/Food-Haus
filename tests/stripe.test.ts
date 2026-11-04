import { describe, expect, it } from "vitest";
import { createCheckoutSession, retrieveCheckoutSession } from "@/lib/stripe";

const base = {
  secretKey: "sk_test_x",
  orderId: 7,
  orderNumber: 1007,
  amountPence: 1598,
  email: "a@b.co",
  successUrl: "https://x.test/order/tok",
  cancelUrl: "https://x.test/checkout?cancelled=1",
  now: new Date("2026-11-04T12:00:00Z"),
};

describe("stripe checkout session", () => {
  it("sends exactly the server total, an order-scoped idempotency key and a ~31 minute expiry", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return Response.json({ id: "cs_test_1", url: "https://checkout.stripe.com/c/1" });
    }) as unknown as typeof fetch;
    const s = await createCheckoutSession({ ...base, fetchImpl });
    expect(s).toEqual({ id: "cs_test_1", url: "https://checkout.stripe.com/c/1" });
    const body = new URLSearchParams(seen!.init.body as URLSearchParams);
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("1598");
    expect(body.get("line_items[0][price_data][currency]")).toBe("gbp");
    expect(body.get("metadata[order_id]")).toBe("7");
    expect(Number(body.get("expires_at"))).toBe(Math.floor(base.now.getTime() / 1000) + 31 * 60);
    const h = seen!.init.headers as Record<string, string>;
    expect(h["Idempotency-Key"]).toBe("food-haus-order-7");
    expect(h.Authorization).toBe("Bearer sk_test_x");
  });
  it("throws on Stripe errors without leaking the key", async () => {
    const fetchImpl = (async () => Response.json({ error: { message: "bad" } }, { status: 400 })) as unknown as typeof fetch;
    await expect(createCheckoutSession({ ...base, fetchImpl })).rejects.toThrow(/Stripe error 400: bad/);
    await expect(createCheckoutSession({ ...base, fetchImpl })).rejects.not.toThrow(/sk_test/);
  });
  it("retrieves an existing session", async () => {
    const fetchImpl = (async () => Response.json({ id: "cs_1", url: "https://u" })) as unknown as typeof fetch;
    expect(await retrieveCheckoutSession("sk", "cs_1", fetchImpl)).toEqual({ id: "cs_1", url: "https://u" });
  });
});
