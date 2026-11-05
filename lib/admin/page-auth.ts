import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { authenticate } from "@/lib/auth/service";
import { can, type Permission } from "@/lib/auth/rbac";
import { adminStore, secureDeployment, type AdminUser } from "./guard";
import { cookieName } from "./cookie";

/**
 * For admin PAGES (server components). Call it in every page, not only in a
 * layout: layouts do not re-render on client navigation, so a layout check alone
 * is not enough. Redirects to the login page when there is no valid session.
 */
export async function requireAdminPage(permission: Permission): Promise<AdminUser> {
  await connection(); // per-request work (the clock below): never part of a prerendered shell
  const token = (await cookies()).get(cookieName(secureDeployment()))?.value;
  const r = await authenticate(adminStore(), token, new Date());
  if (!r.ok) redirect(`/admin/login${r.reason === "no_session" ? "" : `?reason=${r.reason}`}`);
  if (!can(r.user.role, permission)) notFound();
  return r.user;
}
