// Admin session cookie (R9.1, R13.3): HttpOnly, Secure, SameSite=Lax, Path=/.
// In production the name carries the `__Host-` prefix, which makes browsers
// refuse the cookie unless it is Secure, has Path=/ and no Domain, so another
// subdomain cannot plant or overwrite it. On plain http (local dev) Secure
// cookies are unusable, so dev uses an unprefixed name.

export function isSecureDeployment(siteUrl: string, appEnv: string | undefined): boolean {
  return siteUrl.startsWith("https://") || appEnv === "production";
}

export function cookieName(secure: boolean): string {
  return secure ? "__Host-fh_admin" : "fh_admin";
}

export function parseCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || undefined;
  }
  return undefined;
}

export function sessionCookie(name: string, token: string, expires: Date, secure: boolean): string {
  return [`${name}=${token}`, "Path=/", `Expires=${expires.toUTCString()}`, "HttpOnly", "SameSite=Lax", ...(secure ? ["Secure"] : [])].join("; ");
}

export function clearCookie(name: string, secure: boolean): string {
  return [`${name}=`, "Path=/", "Expires=Thu, 01 Jan 1970 00:00:00 GMT", "Max-Age=0", "HttpOnly", "SameSite=Lax", ...(secure ? ["Secure"] : [])].join("; ");
}
