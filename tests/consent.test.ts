import { describe, expect, it } from "vitest";
import { analyticsCookieNames, consentCookie, CONSENT_COOKIE, CONSENT_MAX_AGE_S, CONSENT_VERSION, gaScriptSrc, parseConsent, readCookie, validGaId } from "@/lib/consent";
import { LEGAL_APPROVED, outstandingPlaceholders, placeholdersIn, cookiePolicy, privacyPolicy, termsPolicy } from "@/lib/legal";
import { CHECKOUT_EXPIRY_MINUTES } from "@/lib/stripe";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const val = (c: string) => c.split(";")[0].split("=")[1];

describe("consent record", () => {
  it("round-trips accept and reject", () => {
    expect(parseConsent(val(consentCookie(true, NOW, true)), NOW)).toBe("granted");
    expect(parseConsent(val(consentCookie(false, NOW, true)), NOW)).toBe("denied");
  });
  it("no record, junk, wrong version, expired or future-dated all mean 'ask again'", () => {
    const ts = Math.floor(NOW / 1000);
    for (const bad of [null, undefined, "", "granted", "1.x.1793900000", `${CONSENT_VERSION + 1}.a.${ts}`, `0.a.${ts}`, `1.a.${ts - CONSENT_MAX_AGE_S - 10}`, `1.a.${ts + 3600}`, "1.a.abc", "1.a.1793900000; evil"]) {
      expect([bad, parseConsent(bad, NOW)]).toEqual([bad, "unset"]);
    }
    expect(parseConsent(`1.a.${ts - CONSENT_MAX_AGE_S + 60}`, NOW)).toBe("granted"); // still inside 6 months
  });
  it("the cookie is first-party, site-wide, SameSite, 6 months, Secure only over https", () => {
    const c = consentCookie(true, NOW, true);
    expect(c).toMatch(/^fh_consent=1\.a\.\d+; Path=\/; Max-Age=15552000; SameSite=Lax; Secure$/);
    expect(consentCookie(false, NOW, false)).not.toContain("Secure");
    expect(c).not.toContain("HttpOnly"); // the browser code must read it
  });
  it("finds the cookie among others", () => {
    expect(readCookie("a=1; fh_consent=1.r.123456789; b=2", CONSENT_COOKIE)).toBe("1.r.123456789");
    expect(readCookie("xfh_consent=1", CONSENT_COOKIE)).toBeNull();
    expect(readCookie(null, CONSENT_COOKIE)).toBeNull();
  });
});

describe("analytics id and cookies", () => {
  it("accepts only a real-looking GA4 id, so a typo cannot reach the script URL", () => {
    expect(validGaId("G-ABC123XYZ9")).toBe("G-ABC123XYZ9");
    expect(validGaId("  G-ABC123XYZ9 ")).toBe("G-ABC123XYZ9");
    for (const bad of ["", undefined, null, "UA-12345-1", "g-abc123xyz9", "G-", "G-AB", "G-ABC123&x=1", 'G-ABC123"><script>', "G-ABC123XYZ9\nG-2"]) expect(validGaId(bad as string)).toBeNull();
    expect(gaScriptSrc("G-ABC123XYZ9")).toBe("https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ9");
  });
  it("picks out Google's cookies and nothing else", () => {
    expect(analyticsCookieNames(["_ga", "_ga_ABC123", "_gid", "_gat_gtag_G_X", "fh_consent", "__Host-fh_admin", "_gac", "ga"])).toEqual(["_ga", "_ga_ABC123", "_gid", "_gat_gtag_G_X"]);
  });
});

describe("legal pages", () => {
  it("are DRAFT: while any decision is open they cannot be marked approved", () => {
    if (LEGAL_APPROVED) expect(outstandingPlaceholders()).toEqual([]);
    else expect(outstandingPlaceholders().length).toBeGreaterThan(0);
  });
  it("mark every business/legal decision as a placeholder", () => {
    const text = (d: typeof privacyPolicy) => JSON.stringify(d);
    const priv = placeholdersIn(privacyPolicy).map((p) => p.ph.toLowerCase()).join("|");
    for (const must of ["legal name", "contact email", "retention", "legal basis", "provider name"]) expect(priv).toContain(must);
    expect(placeholdersIn(cookiePolicy).length).toBeGreaterThan(2);
    // no real third-party company is named as fact on either page
    for (const name of ["Stripe", "Cloudflare", "Neon", "Resend", "Vercel"]) expect([name, text(privacyPolicy).includes(name) || text(cookiePolicy).includes(name) || text(termsPolicy).includes(name)]).toEqual([name, false]);
  });
  it("describe the cookies the site really uses", () => {
    const t = JSON.stringify(cookiePolicy);
    for (const k of ["fh_consent", "fh-basket-v1", "_ga"]) expect(t).toContain(k);
  });
  it("state the real retention behaviour from the code", () => {
    expect(JSON.stringify(privacyPolicy)).toContain("12 months");
  });
});

describe("terms page", () => {
  const all = JSON.stringify(termsPolicy);
  it("leaves every legal decision to a placeholder", () => {
    const ph = placeholdersIn(termsPolicy).map((p) => p.ph.toLowerCase()).join("|");
    for (const must of ["cancellation policy", "refund policy", "limits on liability", "governing law", "right to cancel", "contract", "vat"]) expect(ph).toContain(must);
  });
  it("covers every section a customer needs", () => {
    expect(termsPolicy.sections.map((s) => s.id)).toEqual(["about", "ordering", "prices", "delivery", "payment", "allergens", "cancel", "refunds", "legal"]);
  });
  it("describes only what the system really does", () => {
    expect(all).toContain("no cancel button"); // there is no customer self-cancel feature
    expect(all).toContain("done by hand"); // refunds are manual (R8.10)
    expect(all).toContain("cannot choose a later time"); // ASAP only (Q5)
    expect(CHECKOUT_EXPIRY_MINUTES).toBeGreaterThanOrEqual(30); // the page says "about 30 minutes"
    expect(CHECKOUT_EXPIRY_MINUTES).toBeLessThanOrEqual(35);
  });
  it("does not invent contact details, a phone number or a governing law", () => {
    expect(all).not.toMatch(/0\d{10}|\+44|@|England|Wales|Scotland|14 days|\d+ days/i);
  });
});
