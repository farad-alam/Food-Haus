import { z } from "zod";
import { parsePostcode } from "./pricing";
import type { Contact } from "./contact-format";
export * from "./contact-format";

// The shop's contact and company details (R9.9, R11.5, R11.11). One source for the footer, contact page,
// structured data, order emails and receipts, so they can never disagree. They are edited in
// Settings and stored in the database (settings.contact); the values below are only where a fresh
// database starts, taken from the shop's Google Maps listing. The owner confirms them by saving once.

export const DEFAULT_CONTACT: Contact = {
  legalName: null,
  phone: "+447438795428",
  email: "FoodHausfoodhaus72@gmail.com",
  street: "314-318 Selbourne Road",
  locality: "Luton",
  postcode: "LU4 8NU",
  companyNumber: null,
  registeredOffice: null,
  vatNumber: null,
};

// ---- field rules (shared by the form, the API and the loader) -------------------------------------

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** A UK phone number as "+44…" with no spaces, or null. Accepts 07…, +44 7…, 0044 7…, with spaces, dashes or brackets. */
export function normaliseUkPhone(raw: string): string | null {
  let d = raw.replace(/[\s\-().]/g, "");
  if (d.startsWith("+44")) d = d.slice(3);
  else if (d.startsWith("0044")) d = d.slice(4);
  else if (d.startsWith("0")) d = d.slice(1);
  else return null;
  if (!/^(?:7\d{9}|[1-389]\d{8,9})$/.test(d)) return null; // mobiles (07) are 10 digits after the 0; other UK numbers 9 or 10
  return `+44${d}`;
}

export const normaliseCompanyNumber = (raw: string) => {
  const t = raw.replace(/\s+/g, "").toUpperCase();
  return /^(?:\d{8}|[A-Z]{2}\d{6})$/.test(t) ? t : null; // England and Wales 8 digits; Scotland etc. two letters then six digits
};
export const normaliseVat = (raw: string) => {
  const t = raw.replace(/\s+/g, "").toUpperCase();
  return /^GB(?:\d{9}|\d{12}|GD\d{3}|HA\d{3})$/.test(t) ? t : null;
};

const optional = (norm: (s: string) => string | null, msg: string) =>
  z
    .string()
    .nullable()
    .transform((v, ctx) => {
      const t = v === null ? "" : clean(v);
      if (!t) return null;
      const r = norm(t);
      if (r === null) ctx.addIssue({ code: "custom", message: msg });
      return r;
    });

const text = (what: string, max: number) =>
  z
    .string()
    .transform((s) => clean(s))
    .pipe(z.string().min(1, `Enter ${what}.`).max(max, `${what[0].toUpperCase()}${what.slice(1)} must be ${max} characters or fewer.`).refine((s) => !/[<>]/.test(s), `${what[0].toUpperCase()}${what.slice(1)} cannot contain < or >.`));

/** What the admin sends. Everything is normalised, so what is stored is always tidy. */
export const contactSchema = z.strictObject({
  legalName: z.string().nullable().transform((v) => (v === null || !clean(v) ? null : clean(v))).pipe(z.string().max(120, "The legal name must be 120 characters or fewer.").refine((s) => !/[<>]/.test(s), "The legal name cannot contain < or >.").nullable()),
  phone: z.string().transform((v, ctx) => { const r = normaliseUkPhone(v); if (!r) ctx.addIssue({ code: "custom", message: "Enter a UK phone number, like 07438 795428." }); return r ?? ""; }),
  email: z.string().trim().max(254).pipe(z.email("Enter a valid email address.")),
  street: text("the street address", 100),
  locality: text("the town", 60),
  postcode: z.string().transform((v, ctx) => { const r = parsePostcode(v); if (!r) ctx.addIssue({ code: "custom", message: "Enter a UK postcode, like LU4 8NU." }); return r?.formatted ?? ""; }),
  companyNumber: optional(normaliseCompanyNumber, "A Companies House number is 8 characters, like 12345678 or SC123456."),
  registeredOffice: z.string().nullable().transform((v) => (v === null || !clean(v) ? null : clean(v))).pipe(z.string().max(250, "The registered office must be 250 characters or fewer.").refine((s) => !/[<>]/.test(s), "The registered office cannot contain < or >.").nullable()),
  vatNumber: optional(normaliseVat, "A VAT number looks like GB123456789."),
});

/** What is in the database (settings.contact) merged over the starting values. Anything invalid is ignored, never shown. */
export function contactFromStored(stored: unknown): Contact {
  const base = { ...DEFAULT_CONTACT };
  if (typeof stored !== "object" || stored === null) return base;
  const parsed = contactSchema.safeParse({ ...DEFAULT_CONTACT, ...(stored as object) });
  return parsed.success ? parsed.data : base;
}

/** True once the owner has saved details (the stored object has content). */
export const isConfirmed = (stored: unknown) => typeof stored === "object" && stored !== null && Object.keys(stored).length > 0;

/** Fields the owner must have supplied before the pages are approved (R11.11). */
export const missingForApproval = (c: Contact): string[] => [
  ...(c.legalName ? [] : ["legal name"]),
  ...(c.companyNumber ? [] : ["Companies House number"]),
  ...(c.registeredOffice ? [] : ["registered office"]),
];
