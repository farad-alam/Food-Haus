// Single source of truth for name, address and phone (R11.5: NAP must be
// identical in the footer, contact page, structured data and Google listing).
// In production these move to the `settings` table (R9.9); until then they
// live here so every page reads the same values.

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const shop = {
  name: "Food Haus",
  legalName: "Food Haus Ltd", // TODO: confirm exact legal name (client input, section 14)
  tagline: "Halal burgers, wings & loaded fries in Luton",
  phone: "+44 7438 795428",
  phoneDisplay: "07438 795428",
  email: "FoodHausfoodhaus72@gmail.com", // contact only — never the sender address (Q10)
  address: {
    street: "314-318 Selbourne Road",
    locality: "Luton",
    postcode: "LU4 8NU",
    country: "GB",
  },
  tiktok: "https://www.tiktok.com/@mia.bhai43",
  halal: true, // print menu carries the halal badge (Q4: confirm wording/certifier)
  currency: "GBP",
} as const;

// Company details for the footer (R11.11). Left empty on purpose: nothing is shown, and nothing is
// invented, until the owner supplies them. LEGAL_APPROVED cannot be switched on while the first two are empty
// (tests/consent.test.ts). VAT number only if the business is VAT registered (Q2).
export const company: { number: string | null; registeredOffice: string | null; vatNumber: string | null } = {
  number: null, // Companies House number, e.g. "12345678"
  registeredOffice: null, // registered office address as on Companies House
  vatNumber: null, // e.g. "GB123456789", or null if not VAT registered
};

// Opening hours are NOT yet supplied by the owner (section 14, "before
// start"). Nothing is shown or published as fact until `confirmed` is true.
export const hours = {
  confirmed: false,
  // weekday 0 = Sunday. Example shape once supplied: { 1: ["12:00", "23:00"] }
  weekly: {} as Record<number, [string, string] | null>,
};

export const fullAddress = `${shop.address.street}, ${shop.address.locality} ${shop.address.postcode}`;

export const mapsLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
  `${shop.name} ${fullAddress}`,
)}`;
