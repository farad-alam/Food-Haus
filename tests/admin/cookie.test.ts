import { describe, expect, it } from "vitest";
import { clearCookie, cookieName, isSecureDeployment, parseCookie, sessionCookie } from "@/lib/admin/cookie";
import { transition } from "@/lib/admin/orders";

describe("admin session cookie", () => {
  it("uses the __Host- prefix and Secure in production only", () => {
    expect(isSecureDeployment("https://foodhaus.co.uk", undefined)).toBe(true);
    expect(isSecureDeployment("http://localhost:3000", "production")).toBe(true);
    expect(isSecureDeployment("http://localhost:3000", undefined)).toBe(false);
    expect(cookieName(true)).toBe("__Host-fh_admin");
    expect(cookieName(false)).toBe("fh_admin");
  });
  it("sets HttpOnly, SameSite=Lax, Path=/, an expiry, and no Domain (required by __Host-)", () => {
    const c = sessionCookie("__Host-fh_admin", "tok", new Date("2026-12-01T00:00:00Z"), true);
    for (const part of ["__Host-fh_admin=tok", "Path=/", "HttpOnly", "SameSite=Lax", "Secure", "Expires=Tue, 01 Dec 2026 00:00:00 GMT"]) expect(c).toContain(part);
    expect(c).not.toMatch(/Domain=/i);
    expect(sessionCookie("fh_admin", "t", new Date(), false)).not.toContain("Secure");
  });
  it("clears with a past expiry and the same attributes", () => {
    const c = clearCookie("__Host-fh_admin", true);
    expect(c).toContain("Max-Age=0");
    expect(c).toContain("Secure");
    expect(c).toContain("Path=/");
  });
  it("parses the right cookie out of a header and ignores look-alikes", () => {
    expect(parseCookie("a=1; fh_admin=abc; b=2", "fh_admin")).toBe("abc");
    expect(parseCookie("xfh_admin=evil; fh_admin=good", "fh_admin")).toBe("good");
    expect(parseCookie("fh_admin=", "fh_admin")).toBeUndefined();
    expect(parseCookie(null, "fh_admin")).toBeUndefined();
  });
});

describe("order status transitions", () => {
  it("accept only from received; reject from received or preparing", () => {
    expect(transition("accept", "delivery")).toEqual({ from: ["received"], to: "preparing" });
    expect(transition("reject", "collection").from).toEqual(["received", "preparing"]);
  });
  it("collection goes ready -> completed; delivery goes ready -> out_for_delivery -> completed", () => {
    expect(transition("completed", "collection").from).toEqual(["ready"]);
    expect(transition("completed", "delivery").from).toEqual(["out_for_delivery"]);
    expect(transition("out_for_delivery", "delivery").from).toEqual(["ready"]);
    expect(transition("out_for_delivery", "collection").from).toEqual([]); // not allowed for collection
  });
  it("nothing can move out of a finished state", () => {
    for (const a of ["accept", "reject", "ready", "out_for_delivery", "completed"] as const) {
      for (const t of ["delivery", "collection"] as const) {
        const { from } = transition(a, t);
        for (const done of ["completed", "rejected", "cancelled", "refunded", "pending_payment"]) expect(from).not.toContain(done);
      }
    }
  });
});
