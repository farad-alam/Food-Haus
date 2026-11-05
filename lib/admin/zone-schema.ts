import { z } from "zod";

// Delivery zone fields (R9.10). Money is whole pence at the API; the form
// converts from pounds. District is the postcode "outward code" (LU4, LU1...),
// the same thing the pricing engine matches on.
const money = (what: string, max: number) =>
  z.number().int(`${what} must be a whole number of pence.`).min(0, `${what} cannot be negative.`).max(max, `${what} is too high.`);

export const zoneFields = {
  fee: money("Delivery fee", 5_000),
  minOrder: money("Minimum order", 20_000),
  estimatedMinutes: z.number().int().min(5, "Estimated time must be 5 to 180 minutes.").max(180, "Estimated time must be 5 to 180 minutes."),
  active: z.boolean(),
};
export const DISTRICT_RE = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;
export const zoneCreateSchema = z.strictObject({
  district: z.string().trim().toUpperCase().regex(DISTRICT_RE, "Enter a postcode district like LU4."),
  ...zoneFields,
});
export const zoneUpdateSchema = z.strictObject(zoneFields); // the district itself is not editable: delete and re-add
