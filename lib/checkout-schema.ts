import { z } from "zod";
import { MAX_LINES, MAX_QUANTITY } from "./pricing";

// R6.9, R6.14, R13.4: every checkout field is validated on the server against
// this schema. The object is STRICT: any key we don't define — including a
// `total`, `price` or `discount` a tampering client adds — is rejected, not
// silently ignored, so an attempt to inject prices is visible in the logs.

/** Normalises UK mobile numbers to +447XXXXXXXXX, or null if not a UK mobile. */
export function normaliseUkMobile(raw: string): string | null {
  let s = raw.replace(/[\s().-]/g, "");
  if (s.startsWith("0044")) s = `+${s.slice(2)}`;
  else if (s.startsWith("0")) s = `+44${s.slice(1)}`;
  return /^\+447\d{9}$/.test(s) ? s : null;
}

const ukMobile = z
  .string()
  .trim()
  .max(25)
  .transform((value, ctx) => {
    const n = normaliseUkMobile(value);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "Enter a UK mobile number, for example 07123 456789." });
      return z.NEVER;
    }
    return n;
  });

export const cartLine = z.strictObject({
  itemId: z.string().min(1).max(100),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
  optionIds: z.array(z.string().min(1).max(100)).max(10).default([]),
});

export const checkoutSchema = z
  .strictObject({
    // Generated in the browser per checkout attempt; makes a double tap or a
    // retry create exactly one order (R13.7).
    idempotencyKey: z.uuid(),
    items: z.array(cartLine).min(1).max(MAX_LINES),
    orderType: z.enum(["delivery", "collection"]),
    paymentMethod: z.enum(["card", "cash"]),
    name: z.string().trim().min(1, "Enter your name.").max(80),
    phone: ukMobile,
    email: z.email().max(254).transform((e) => e.toLowerCase()),
    address: z.string().trim().max(200).optional(),
    postcode: z.string().trim().max(10).optional(),
    note: z.string().trim().max(200).optional(), // R6.4: up to 200 characters
    promoCode: z.string().trim().max(40).optional(),
    // Cloudflare Turnstile token (R13.13); verified server-side before use.
    turnstileToken: z.string().max(2048).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.orderType === "delivery") {
      if (!v.address || v.address.length < 5) {
        ctx.addIssue({ code: "custom", path: ["address"], message: "Enter your delivery address." });
      }
      if (!v.postcode) {
        ctx.addIssue({ code: "custom", path: ["postcode"], message: "Enter your postcode." });
      }
    }
  });

export type CheckoutInput = z.infer<typeof checkoutSchema>;

// Input for POST /api/quote: what the form needs priced. Same strictness and
// limits as checkout; no personal details, so nothing sensitive is sent just
// to preview a total.
export const quoteSchema = z.strictObject({
  items: z.array(cartLine).min(1).max(MAX_LINES),
  orderType: z.enum(["delivery", "collection"]),
  paymentMethod: z.enum(["card", "cash"]),
  postcode: z.string().trim().max(10).optional(),
  promoCode: z.string().trim().max(40).optional(),
});
export type QuoteInput = z.infer<typeof quoteSchema>;
