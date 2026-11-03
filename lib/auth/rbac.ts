// Roles and permissions (R9.1). Every admin page AND every admin action checks
// these on the server; hiding a button is never the control.
//
//   Owner   — everything
//   Manager — menu, offers, hours/settings, zones, orders, reports; NO refunds
//             and NO user management
//   Kitchen — orders only

export type Role = "owner" | "manager" | "kitchen";

export const PERMISSIONS = [
  "orders.view",
  "orders.update",
  "orders.refund",
  "orders.export",
  "menu.edit",
  "offers.edit",
  "settings.edit", // opening hours, pause switch, notice bar, delivery zones
  "reports.view",
  "audit.view",
  "users.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(PERMISSIONS),
  manager: new Set<Permission>([
    "orders.view",
    "orders.update",
    "orders.export",
    "menu.edit",
    "offers.edit",
    "settings.edit",
    "reports.view",
    "audit.view",
  ]),
  kitchen: new Set<Permission>(["orders.view", "orders.update"]),
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return MATRIX[role]?.has(permission) ?? false;
}

// Path -> permission. Longest prefix wins. Anything under /admin that is NOT
// listed here is denied for everyone except the owner, so a new page added
// without a rule fails closed instead of open.
const ROUTES: ReadonlyArray<readonly [string, Permission]> = [
  ["/admin/orders", "orders.view"],
  ["/admin/export", "orders.export"],
  ["/admin/menu", "menu.edit"],
  ["/admin/offers", "offers.edit"],
  ["/admin/settings", "settings.edit"],
  ["/admin/zones", "settings.edit"],
  ["/admin/reports", "reports.view"],
  ["/admin/audit", "audit.view"],
  ["/admin/users", "users.manage"],
];

/** The permission needed for a path, or "owner-only" for unlisted /admin paths. */
export function permissionForPath(pathname: string): Permission | "owner-only" {
  const path = pathname.replace(/\/+$/, "") || "/";
  // Fail closed on anything that is not a plain, already-normalised path: dot
  // segments, empty segments, encoded characters or backslashes could otherwise
  // borrow a lower permission by prefix ("/admin/orders/../users").
  if (/(^|\/)\.\.?(\/|$)/.test(path) || path.includes("//") || path.includes("%") || path.includes("\\")) {
    return "owner-only";
  }
  if (path === "/admin") return "orders.view"; // landing page is the order board
  let best: { len: number; perm: Permission } | null = null;
  for (const [prefix, perm] of ROUTES) {
    if ((path === prefix || path.startsWith(`${prefix}/`)) && (!best || prefix.length > best.len)) {
      best = { len: prefix.length, perm };
    }
  }
  return best ? best.perm : "owner-only";
}

export function canAccessPath(role: Role | null | undefined, pathname: string): boolean {
  if (!role) return false;
  const needed = permissionForPath(pathname);
  return needed === "owner-only" ? role === "owner" : can(role, needed);
}

/** Roles that must use two-step login (R9.2). Kitchen's always-on board is exempt. */
export function requiresTwoStep(role: Role): boolean {
  return role === "owner" || role === "manager";
}
