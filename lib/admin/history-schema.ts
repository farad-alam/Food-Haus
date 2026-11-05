import { z } from "zod";

// Order-history filters (R9.11), read from the query string. Strict: unknown
// parameters are refused so a typo is noticed instead of silently ignored.
export const STATUSES = ["pending_payment", "received", "preparing", "ready", "out_for_delivery", "completed", "rejected", "cancelled", "refunded"] as const;
export const PAGE_SIZE = 25;
export const EXPORT_CAP = 5000;

const realDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.").refine(realDate, "That is not a real date.");

export const historyQuerySchema = z
  .strictObject({
    from: date.optional(),
    to: date.optional(),
    status: z.string().optional(), // comma separated
    payment: z.enum(["card", "cash"]).optional(),
    type: z.enum(["delivery", "collection"]).optional(),
    q: z.string().trim().max(80, "Search text is too long.").optional(),
    page: z.coerce.number().int().min(1).max(100_000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.from && v.to && v.to < v.from) ctx.addIssue({ code: "custom", path: ["to"], message: "The end date is before the start date." });
    if (v.status) {
      const bad = v.status.split(",").find((s) => !(STATUSES as readonly string[]).includes(s));
      if (bad !== undefined) ctx.addIssue({ code: "custom", path: ["status"], message: "Unknown status." });
    }
  });
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

/** Query string -> validated filters (or the first error message). */
export function parseHistoryQuery(params: URLSearchParams): { ok: true; query: HistoryQuery } | { ok: false; message: string } {
  const raw: Record<string, string> = {};
  for (const [k, v] of params) raw[k] = v;
  for (const k of Object.keys(raw)) if (raw[k] === "") delete raw[k]; // empty form fields mean "no filter"
  const r = historyQuerySchema.safeParse(raw);
  return r.success ? { ok: true, query: r.data } : { ok: false, message: r.error.issues[0]?.message ?? "Invalid filters." };
}
