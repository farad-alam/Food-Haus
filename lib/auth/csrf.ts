// Cross-site request protection for state-changing admin requests (R13.4).
// Session cookies are SameSite=Lax; this adds an explicit Origin check on top,
// so a forged POST from another site is refused even if a browser misbehaves.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.origin === "null" ? null : u.origin;
  } catch {
    return null;
  }
}

/**
 * Safe methods always pass. For anything else the request's Origin (or, if the
 * browser omitted it, its Referer) must equal our own origin. A state-changing
 * request with neither header is refused.
 */
export function isTrustedRequest(
  req: { method: string; origin?: string | null; referer?: string | null },
  siteUrl: string,
): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true;
  const site = originOf(siteUrl);
  if (!site) return false;
  const claimed = originOf(req.origin) ?? (req.origin ? null : originOf(req.referer));
  return claimed !== null && claimed === site;
}
