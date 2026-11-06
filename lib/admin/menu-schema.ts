import { z } from "zod";
import { ALLERGEN_KEYS, DIETARY_KEYS } from "@/lib/menu-constants";
import { slugify } from "@/lib/menu-model";

// Menu field rules (R9.7), shared by the API (the real check) and the form.
const unique = <T extends z.ZodType>(schema: T) => z.array(schema).refine((a) => new Set(a).size === a.length, "No duplicates.");

export const PRICE_MIN = 1;
export const PRICE_MAX = 50_000; // £500: far above any burger, catches a stray extra zero

const name = (what: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `Enter ${what}.`)
    .max(max, `${what[0].toUpperCase()}${what.slice(1)} must be ${max} characters or fewer.`)
    .refine((s) => slugify(s).length > 0, `${what[0].toUpperCase()}${what.slice(1)} needs at least one letter or number.`);

export const itemFields = {
  name: name("a name", 100),
  description: z.string().trim().max(600, "The description must be 600 characters or fewer."),
  price: z.number().int("Price must be a whole number of pence.").min(PRICE_MIN, "Price must be at least 1p.").max(PRICE_MAX, "Price cannot be over £500."),
  categoryId: z.number().int().positive(),
  // null = allergen information NOT entered yet (blocks launch, R11.10). An empty array
  // means the owner explicitly confirmed "contains none of the 14": it is never a default.
  allergens: unique(z.enum(ALLERGEN_KEYS)).nullable(),
  dietaryTags: unique(z.enum(DIETARY_KEYS)),
  soldOut: z.boolean(),
  visible: z.boolean(),
};
export const itemSchema = z.strictObject(itemFields);
export const itemFlagsSchema = z.strictObject({ soldOut: z.boolean().optional(), visible: z.boolean().optional() }).refine((v) => v.soldOut !== undefined || v.visible !== undefined, "Nothing to change.");

export const categorySchema = z.strictObject({ name: name("a name", 60), visible: z.boolean().optional() });
export const reorderSchema = z.strictObject({ ids: z.array(z.number().int().positive()).min(1).max(200) });
export const itemReorderSchema = z.strictObject({ categoryId: z.number().int().positive(), ids: z.array(z.number().int().positive()).min(1).max(200) });

/** Same derivation the menu uses for option ids (lib/menu-model.ts). */
export const optionSlug = (n: string) => slugify(n).slice(0, 24);

export const optionGroupSchema = z
  .strictObject({
    name: name("a group name", 60),
    required: z.boolean(),
    minPicks: z.number().int().min(0).max(30),
    maxPicks: z.number().int().min(1).max(30),
    options: z
      .array(
        z.strictObject({
          name: name("an option name", 60),
          priceChange: z.number().int("Extra price must be a whole number of pence.").min(0, "Extra price cannot be negative.").max(5_000, "Extra price cannot be over £50."),
          // Same rule as items: null = not entered yet; [] = explicitly confirmed none. Required, so it can never be left out by accident.
          allergens: unique(z.enum(ALLERGEN_KEYS)).nullable(),
        }),
      )
      .min(1, "Add at least one option.")
      .max(30),
  })
  .superRefine((g, ctx) => {
    if (g.maxPicks > g.options.length) ctx.addIssue({ code: "custom", path: ["maxPicks"], message: "Customers cannot pick more options than there are." });
    if (g.minPicks > g.maxPicks) ctx.addIssue({ code: "custom", path: ["minPicks"], message: "The minimum cannot be more than the maximum." });
    // Option ids are derived from the name (first 24 letters/digits). Two options
    // that collapse to the same id could not be told apart at checkout.
    const seen = new Set<string>();
    for (const o of g.options) {
      const id = optionSlug(o.name);
      if (seen.has(id)) ctx.addIssue({ code: "custom", path: ["options"], message: `“${o.name}” is too similar to another option. Make the names differ in their first few words.` });
      seen.add(id);
    }
  });
export type OptionGroupInput = z.infer<typeof optionGroupSchema>;
