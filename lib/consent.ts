// Cookie consent record (R11.9). Pure functions only; the browser side is in consent-store.ts.
//
// The choice is remembered in ONE first-party cookie, `fh_consent` (strictly necessary: it only
// stores that you answered). Value: "<version>.<a|r>.<epoch seconds>", e.g. "1.r.1793900000".
//  - a = analytics accepted, r = rejected.
//  - Bump CONSENT_VERSION whenever a NEW kind of non-essential cookie is added, so everyone is asked again.
//  - A choice older than 6 months is treated as unanswered and asked again.

export const CONSENT_COOKIE = "fh_consent";
export const CONSENT_VERSION = 1;
export const CONSENT_MAX_AGE_S = 180 * 86_400;

export type ConsentState = "unset" | "granted" | "denied";

export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  for (const part of (cookieHeader ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function parseConsent(raw: string | null | undefined, nowMs: number): ConsentState {
  const m = /^(\d{1,3})\.(a|r)\.(\d{9,11})$/.exec(raw ?? "");
  if (!m || Number(m[1]) !== CONSENT_VERSION) return "unset";
  const ageS = nowMs / 1000 - Number(m[3]);
  if (ageS > CONSENT_MAX_AGE_S || ageS < -300) return "unset"; // expired, or a timestamp from the future
  return m[2] === "a" ? "granted" : "denied";
}

export function consentCookie(granted: boolean, nowMs: number, secure: boolean): string {
  const value = `${CONSENT_VERSION}.${granted ? "a" : "r"}.${Math.floor(nowMs / 1000)}`;
  return `${CONSENT_COOKIE}=${value}; Path=/; Max-Age=${CONSENT_MAX_AGE_S}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** A GA4 measurement ID, or null. Anything else is ignored so a typo in the environment cannot inject into the script URL. */
export function validGaId(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return /^G-[A-Z0-9]{6,14}$/.test(v) ? v : null;
}

export const gaScriptSrc = (id: string) => `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;

/** Names of Google Analytics cookies among the given cookie names (to remove when consent is withdrawn). */
export const analyticsCookieNames = (names: string[]) => names.filter((n) => /^(_ga|_gid|_gat)(_[A-Za-z0-9]+)*$/.test(n));
