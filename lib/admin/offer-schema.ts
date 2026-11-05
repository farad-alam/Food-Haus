import { z } from "zod";
import { londonLocalToUtc } from "@/lib/london-time";

// Offer fields (R6.7, R9.8). The browser sends start/end as UK wall-clock text
// ("2026-12-01T09:00"); the server converts it, so daylight saving is handled in
// one place. The rules mirror what the pricing engine can actually apply: an
// offer the engine would silently ignore (e.g. free delivery for collection
// only) is refused here instead.
const localTime = z
  .string()
  .nullable()
  .refine((s) => s === null || londonLocalToUtc(s) !== null, "Enter a real UK date and time (that time may not exist when the clocks change).");

export const CODE_RE = /^[A-Za-z0-9]{3,20}$/;

export const offerSchema = z
  .strictObject({
    name: z.string().trim().min(1, "Enter a name.").max(80, "The name must be 80 characters or fewer."),
    type: z.enum(["percentage", "fixed", "free_delivery", "bogof"]),
    value: z.number().int("Enter a whole number.").nullable(),
    appliesToCategoryId: z.number().int().positive().nullable(),
    channel: z.enum(["any", "delivery", "collection"]),
    // Empty or missing = an automatic offer (no code needed).
    code: z
      .string()
      .trim()
      .nullable()
      .transform((c) => (c === null || c === "" ? null : c))
      .refine((c) => c === null || CODE_RE.test(c), "A code is 3 to 20 letters or numbers, with no spaces."),
    minSpend: z.number().int().min(0, "Minimum spend cannot be negative.").max(100_000, "Minimum spend is too high."),
    startsAt: localTime,
    endsAt: localTime,
    usageLimit: z.number().int().min(1, "The usage limit must be at least 1.").max(1_000_000).nullable(),
    showOnSite: z.boolean(),
  })
  .superRefine((o, ctx) => {
    const bad = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    switch (o.type) {
      case "percentage":
        if (o.value === null || o.value < 1 || o.value > 100) bad("value", "Enter a percentage from 1 to 100.");
        break;
      case "fixed":
        if (o.value === null || o.value < 1 || o.value > 50_000) bad("value", "Enter an amount from 1p to £500.");
        break;
      case "free_delivery":
        if (o.value !== null) bad("value", "Free delivery has no amount.");
        if (o.channel === "collection") bad("channel", "Free delivery cannot be limited to collection orders.");
        break;
      case "bogof":
        if (o.value !== null) bad("value", "Buy one get one free has no amount.");
        if (o.appliesToCategoryId === null) bad("appliesToCategoryId", "Choose which category it applies to.");
        break;
    }
    if (o.type !== "bogof" && o.appliesToCategoryId !== null) bad("appliesToCategoryId", "Only buy-one-get-one-free offers apply to a category.");
    if (o.startsAt && o.endsAt) {
      const s = londonLocalToUtc(o.startsAt);
      const e = londonLocalToUtc(o.endsAt);
      if (s && e && e <= s) bad("endsAt", "The end must be after the start.");
    }
  });
export type OfferInput = z.infer<typeof offerSchema>;
