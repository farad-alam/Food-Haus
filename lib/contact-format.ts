import { shop } from "./shop";

// Display helpers for the contact details. No validation library here, so client components can use them cheaply.

export type Contact = {
  legalName: string | null; // exact registered name; null until the owner supplies it (never guessed)
  phone: string; // "+447438795428"
  email: string;
  street: string;
  locality: string;
  postcode: string; // "LU4 8NU"
  companyNumber: string | null; // Companies House
  registeredOffice: string | null;
  vatNumber: string | null; // only if VAT registered
};

/** National display form, e.g. "07438 795428". */
export function phoneDisplay(e164: string): string {
  const n = `0${e164.replace(/^\+44/, "")}`;
  return n.length === 11 ? `${n.slice(0, 5)} ${n.slice(5)}` : n;
}
export const telHref = (e164: string) => `tel:${e164}`;

// ---- derived values ---------------------------------------------------------------------------------

export const fullAddress = (c: Pick<Contact, "street" | "locality" | "postcode">) => `${c.street}, ${c.locality} ${c.postcode}`;
export const mapsLinkFor = (c: Pick<Contact, "street" | "locality" | "postcode">) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${shop.name} ${fullAddress(c)}`)}`;

