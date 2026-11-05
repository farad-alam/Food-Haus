import { adminStore, jsonResponse, secureDeployment, trustedOrigin } from "@/lib/admin/guard";
import { clearCookie, cookieName, parseCookie } from "@/lib/admin/cookie";
import { logout } from "@/lib/auth/service";

// POST /api/admin/logout: deletes the server-side session AND clears the cookie.
export async function POST(request: Request) {
  if (!trustedOrigin(request)) return jsonResponse(403, { ok: false, code: "CROSS_SITE" });
  const secure = secureDeployment();
  const token = parseCookie(request.headers.get("cookie"), cookieName(secure));
  try {
    await logout(adminStore(), token);
  } catch (e) {
    console.error("admin logout failed", e instanceof Error ? e.message : e);
  }
  return jsonResponse(200, { ok: true }, { "Set-Cookie": clearCookie(cookieName(secure), secure) });
}
