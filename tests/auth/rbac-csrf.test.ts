import { describe, expect, it } from "vitest";
import { isTrustedRequest } from "@/lib/auth/csrf";
import { can, canAccessPath, PERMISSIONS, permissionForPath, requiresTwoStep, type Role } from "@/lib/auth/rbac";

describe("permission matrix (R9.1)", () => {
  it("owner can do everything", () => {
    for (const p of PERMISSIONS) expect(can("owner", p)).toBe(true);
  });
  it("manager cannot refund or manage users, but runs the shop", () => {
    expect(can("manager", "orders.refund")).toBe(false);
    expect(can("manager", "users.manage")).toBe(false);
    for (const p of ["orders.view", "orders.update", "menu.edit", "offers.edit", "settings.edit", "reports.view"] as const) {
      expect(can("manager", p)).toBe(true);
    }
  });
  it("kitchen can only view and update orders", () => {
    const allowed = PERMISSIONS.filter((p) => can("kitchen", p));
    expect(allowed.sort()).toEqual(["orders.update", "orders.view"]);
  });
  it("no role means no access", () => {
    for (const p of PERMISSIONS) {
      expect(can(null, p)).toBe(false);
      expect(can(undefined, p)).toBe(false);
      expect(can("admin" as Role, p)).toBe(false); // unknown role string
    }
  });
});

describe("path access (acceptance: a staff login cannot open any page above its role)", () => {
  const adminPaths = ["/admin", "/admin/orders", "/admin/orders/1042", "/admin/menu", "/admin/menu/items/7", "/admin/offers", "/admin/settings", "/admin/zones", "/admin/reports", "/admin/audit", "/admin/export", "/admin/users", "/admin/users/3"];

  it("kitchen reaches only the order board", () => {
    const reachable = adminPaths.filter((p) => canAccessPath("kitchen", p));
    expect(reachable).toEqual(["/admin", "/admin/orders", "/admin/orders/1042"]);
  });

  it("manager reaches everything except user management", () => {
    expect(adminPaths.filter((p) => !canAccessPath("manager", p))).toEqual(["/admin/users", "/admin/users/3"]);
  });

  it("owner reaches everything", () => {
    expect(adminPaths.every((p) => canAccessPath("owner", p))).toBe(true);
  });

  it("an unlisted /admin page fails closed: owner only", () => {
    expect(permissionForPath("/admin/brand-new-page")).toBe("owner-only");
    expect(canAccessPath("owner", "/admin/brand-new-page")).toBe(true);
    expect(canAccessPath("manager", "/admin/brand-new-page")).toBe(false);
    expect(canAccessPath("kitchen", "/admin/brand-new-page")).toBe(false);
  });

  it("prefix tricks do not borrow another page's permission", () => {
    expect(permissionForPath("/admin/orders-secret")).toBe("owner-only");
    expect(permissionForPath("/admin/ordersx/1")).toBe("owner-only");
    expect(canAccessPath("kitchen", "/admin/orders-secret")).toBe(false);
    expect(canAccessPath("kitchen", "/admin/orders/../users")).toBe(false); // literal path, not a match
  });

  it("trailing slashes and unauthenticated users", () => {
    expect(canAccessPath("kitchen", "/admin/orders/")).toBe(true);
    expect(canAccessPath(null, "/admin")).toBe(false);
  });
});

describe("two-step requirement (R9.2)", () => {
  it("owner and manager need it; the always-on kitchen board does not", () => {
    expect(requiresTwoStep("owner")).toBe(true);
    expect(requiresTwoStep("manager")).toBe(true);
    expect(requiresTwoStep("kitchen")).toBe(false);
  });
});

describe("isTrustedRequest (CSRF)", () => {
  const SITE = "https://www.foodhaus.co.uk";
  it("always lets safe methods through", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get"]) expect(isTrustedRequest({ method }, SITE)).toBe(true);
  });
  it("accepts a same-origin POST by Origin, or by Referer when Origin is absent", () => {
    expect(isTrustedRequest({ method: "POST", origin: SITE }, SITE)).toBe(true);
    expect(isTrustedRequest({ method: "POST", origin: null, referer: `${SITE}/admin/menu` }, SITE)).toBe(true);
  });
  it("refuses cross-site, look-alike, opaque and header-less POSTs", () => {
    for (const origin of ["https://evil.example", "https://www.foodhaus.co.uk.evil.example", "http://www.foodhaus.co.uk", "https://foodhaus.co.uk", "null"]) {
      expect(isTrustedRequest({ method: "POST", origin }, SITE)).toBe(false);
    }
    expect(isTrustedRequest({ method: "POST" }, SITE)).toBe(false);
    expect(isTrustedRequest({ method: "DELETE", origin: null, referer: "https://evil.example/x" }, SITE)).toBe(false);
  });
  it("a bad Origin is not rescued by a good Referer", () => {
    expect(isTrustedRequest({ method: "POST", origin: "https://evil.example", referer: `${SITE}/admin` }, SITE)).toBe(false);
  });
  it("fails closed on an unparsable site URL", () => {
    expect(isTrustedRequest({ method: "POST", origin: SITE }, "not a url")).toBe(false);
  });
});
