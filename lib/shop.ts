// Fixed facts about the site. The editable contact and company details (phone, email, address, legal
// name, Companies House and VAT numbers) are NOT here: they live in the database and are edited in
// Settings (lib/contact.ts, R9.9).

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const shop = {
  name: "Food Haus",
  tagline: "Halal burgers, wings & loaded fries in Luton",
  tiktok: "https://www.tiktok.com/@mia.bhai43",
  halal: true, // print menu carries the halal badge (Q4: confirm wording/certifier)
  currency: "GBP",
  country: "GB",
} as const;

// Opening hours are NOT yet supplied by the owner (section 14, "before
// start"). Nothing is shown or published as fact until `confirmed` is true.
export const hours = {
  confirmed: false,
  // weekday 0 = Sunday. Example shape once supplied: { 1: ["12:00", "23:00"] }
  weekly: {} as Record<number, [string, string] | null>,
};

