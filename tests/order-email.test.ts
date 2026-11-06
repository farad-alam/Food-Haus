import { describe, expect, it } from "vitest";
import { DEFAULT_CONTACT } from "@/lib/contact";
import { escapeHtml, renderCustomerEmail, renderShopEmail, type EmailOrder } from "@/lib/order-email";
import { resendSender } from "@/lib/email";

const o: EmailOrder = {
  number: 1042,
  token: "abcdefghijklmnopqrstuv",
  type: "delivery",
  name: `Eve <script>alert(1)</script> & "Co"`,
  paymentMethod: "cash",
  paymentStatus: "unpaid",
  subtotal: 1598,
  deliveryFee: 250,
  discount: 100,
  total: 1748,
  note: `<img src=x onerror=alert(1)> no onions`,
  items: [{ name: "Classic Burger", quantity: 2, options: [{ name: "Meal", priceChange: 349 }], lineTotal: 2294 }],
};

describe("customer email", () => {
  const m = renderCustomerEmail(o, "https://foodhaus.test", DEFAULT_CONTACT);
  it("has the number, items, totals, payment, allergen reminder, phone and private link", () => {
    expect(m.subject).toBe("Food Haus order 1042 confirmed");
    for (const s of ["1042", "2 x Classic Burger (Meal)", "£17.48", "Pay £17.48 in cash on delivery", "Allergies or intolerances?", "printed allergen list", "07438 795428", "https://foodhaus.test/order/abcdefghijklmnopqrstuv"]) {
      expect(m.text).toContain(s);
    }
    expect(m.html).toContain("https://foodhaus.test/order/abcdefghijklmnopqrstuv");
  });
  it("escapes customer-supplied text in HTML", () => {
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<img");
    expect(m.html).toContain("&lt;script&gt;");
  });
  it("collection orders do not promise a delivery-bag allergen list", () => {
    expect(renderCustomerEmail({ ...o, type: "collection" }, "https://x", DEFAULT_CONTACT).text).not.toContain("delivery bag");
  });
});

describe("shop alert email", () => {
  const m = renderShopEmail(o);
  it("carries number, items, payment and note but no customer contact details (R13.10)", () => {
    expect(m.text).toContain("New order 1042");
    expect(m.text).toContain("CASH £17.48 to collect");
    expect(m.text).toContain("2 x Classic Burger");
    expect(m.text).toContain("no onions");
    expect(m.text + m.html + m.subject).not.toContain("Eve");
    expect(m.html).not.toContain("<img");
  });
});

describe("helpers", () => {
  it("escapeHtml", () => expect(escapeHtml(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;"));
  it("resend sender posts JSON with bearer auth and hides recipient in errors", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const ok = (async (url: string, init: RequestInit) => ((seen = { url, init }), new Response("{}"))) as unknown as typeof fetch;
    await resendSender("re_key", "Food Haus <o@x.test>", ok).send({ to: "a@b.co", subject: "s", text: "t", html: "h" });
    expect(seen!.url).toBe("https://api.resend.com/emails");
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer re_key");
    expect(JSON.parse(seen!.init.body as string)).toMatchObject({ from: "Food Haus <o@x.test>", to: ["a@b.co"] });
    const bad = (async () => new Response("a@b.co rejected", { status: 422 })) as unknown as typeof fetch;
    await expect(resendSender("k", "f", bad).send({ to: "a@b.co", subject: "s", text: "t", html: "h" })).rejects.toThrow(/^Email provider error 422$/);
  });
});
