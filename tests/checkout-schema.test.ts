import { describe, expect, it } from "vitest";
import { checkoutSchema, normaliseUkMobile } from "@/lib/checkout-schema";

const valid = {
  idempotencyKey: "3f2b8c1e-5d4a-4e7b-9c1a-0b2d3e4f5a6b",
  items: [{ itemId: "burgers-classic-burger", quantity: 2 }],
  orderType: "collection",
  paymentMethod: "cash",
  name: "  Aisha Khan ",
  phone: "07123 456789",
  email: "Aisha@Example.COM",
};

describe("checkoutSchema", () => {
  it("accepts a valid collection order and normalises it", () => {
    const r = checkoutSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.name).toBe("Aisha Khan");
    expect(r.data.phone).toBe("+447123456789");
    expect(r.data.email).toBe("aisha@example.com");
    expect(r.data.items[0].optionIds).toEqual([]);
  });

  it("rejects any client-supplied price, total or discount (strict)", () => {
    for (const extra of [{ total: 1 }, { price: 1 }, { discount: 9999 }, { deliveryFee: 0 }]) {
      expect(checkoutSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
    }
    const lineWithPrice = { ...valid, items: [{ itemId: "burgers-classic-burger", quantity: 1, price: 1 }] };
    expect(checkoutSchema.safeParse(lineWithPrice).success).toBe(false);
  });

  it("requires address and postcode for delivery only", () => {
    expect(checkoutSchema.safeParse({ ...valid, orderType: "delivery" }).success).toBe(false);
    expect(
      checkoutSchema.safeParse({ ...valid, orderType: "delivery", address: "12 Example Road", postcode: "LU4 8NU" }).success,
    ).toBe(true);
  });

  it("limits the note to 200 characters", () => {
    expect(checkoutSchema.safeParse({ ...valid, note: "x".repeat(200) }).success).toBe(true);
    expect(checkoutSchema.safeParse({ ...valid, note: "x".repeat(201) }).success).toBe(false);
  });

  it("rejects bad idempotency keys, quantities, emails and empty baskets", () => {
    expect(checkoutSchema.safeParse({ ...valid, idempotencyKey: "abc" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...valid, items: [{ itemId: "x", quantity: 0 }] }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...valid, items: [{ itemId: "x", quantity: 21 }] }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...valid, paymentMethod: "bitcoin" }).success).toBe(false);
  });
});

describe("normaliseUkMobile", () => {
  it.each([
    ["07123456789", "+447123456789"],
    ["07123 456 789", "+447123456789"],
    ["+44 7123 456789", "+447123456789"],
    ["0044 7123 456789", "+447123456789"],
    ["(07123) 456-789", "+447123456789"],
  ])("%s → %s", (input, out) => expect(normaliseUkMobile(input)).toBe(out));

  it.each(["01582 123456", "0712345678", "071234567890", "+1 555 123 4567", "abc", ""])("rejects %j", (input) => {
    expect(normaliseUkMobile(input)).toBeNull();
  });
});
