import { isTrustedRequest } from "@/lib/auth/csrf";
import { authenticate, type AuthResult } from "@/lib/auth/service";
import { PgAdminStore } from "@/lib/auth/pg-store";
import { can, type Permission, type Role } from "@/lib/auth/rbac";
import { getDb } from "@/lib/db/client";
import { SITE_URL } from "@/lib/shop";
import { cookieName, isSecureDeployment, parseCookie } from "./cookie";

// Server-side authorisation for admin route handlers (R9.1, R13.3, R13.4).
// EVERY admin handler calls guard() itself: nothing relies on a layout, a hidden
// button or a client-side check.

export type AdminUser = { id: number; email: string; role: Role };

export const secureDeployment = () => isSecureDeployment(SITE_URL, process.env.APP_ENV);

export function adminStore(): PgAdminStore {
  const key = process.env.SECRET_BOX_KEY;
  if (!key) throw new Error("SECRET_BOX_KEY is not set.");
  return new PgAdminStore(getDb(), key);
}

const noStore = { "Cache-Control": "no-store" };
export const jsonResponse = (status: number, body: unknown, headers: HeadersInit = {}) =>
  Response.json(body, { status, headers: { ...noStore, ...headers } });

/** Same-origin check for state-changing requests: our configured site URL or the request's own origin. */
export function trustedOrigin(request: Request): boolean {
  const req = { method: request.method, origin: request.headers.get("origin"), referer: request.headers.get("referer") };
  return isTrustedRequest(req, SITE_URL) || isTrustedRequest(req, new URL(request.url).origin);
}

export async function sessionUser(
  request: Request,
  options: { touch?: boolean; now?: Date } = {},
): Promise<{ result: AuthResult; user: AdminUser | null }> {
  const token = parseCookie(request.headers.get("cookie"), cookieName(secureDeployment()));
  const result = await authenticate(adminStore(), token, options.now ?? new Date(), { touch: options.touch });
  return { result, user: result.ok ? result.user : null };
}

/**
 * Returns the signed-in user, or a ready-made error Response:
 * 403 cross-site, 401 not signed in (with the reason, so the board can say
 * "session expired"), 403 role lacks the permission.
 */
export async function guard(
  request: Request,
  permission: Permission,
  options: { touch?: boolean; now?: Date } = {},
): Promise<{ user: AdminUser } | { response: Response }> {
  if (!trustedOrigin(request)) return { response: jsonResponse(403, { ok: false, code: "CROSS_SITE" }) };
  const { result, user } = await sessionUser(request, options);
  if (!user) return { response: jsonResponse(401, { ok: false, code: "UNAUTHENTICATED", reason: result.ok ? undefined : result.reason }) };
  if (!can(user.role, permission)) return { response: jsonResponse(403, { ok: false, code: "FORBIDDEN" }) };
  return { user };
}
