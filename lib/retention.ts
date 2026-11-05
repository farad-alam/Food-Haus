import { and, inArray, isNull, lt } from "drizzle-orm";
import { order } from "@/db/schema";
import type { Db } from "@/lib/db/client";

// R13.12: customers' contact details are not kept for ever. Orders older than this
// have the personal fields wiped; the order itself (items, totals, status, dates) stays,
// so sales reports, history totals and accounts are unaffected.
export const CONTACT_RETENTION_MONTHS = 12;
export const ANONYMISE_BATCH = 500; // per run; the job runs every 5 minutes, so a backlog clears quickly without a long query

/** The date before which orders are anonymised: the same day-of-month, `months` ago (UTC). */
export function retentionCutoff(now: Date, months = CONTACT_RETENTION_MONTHS): Date {
  const d = new Date(now.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1); // avoid 31 March minus one month rolling into March
  d.setUTCMonth(d.getUTCMonth() - months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** What the personal columns are replaced with. name/phone/email are NOT NULL, so they become fixed placeholders. */
export const ANONYMISED = { customerName: "Anonymised", phone: "", email: "" } as const;

/**
 * Wipes name, phone, email, address, postcode, free-text note and the hashed IP on up to
 * `limit` orders created before the cutoff that are not anonymised yet. Returns how many.
 * Safe to run repeatedly and concurrently: each row is claimed by the `anonymised_at is null` condition.
 */
export async function anonymiseOldOrders(db: Db, now: Date, opts: { months?: number; limit?: number } = {}): Promise<number> {
  const cutoff = retentionCutoff(now, opts.months);
  const due = await db
    .select({ id: order.id })
    .from(order)
    .where(and(isNull(order.anonymisedAt), lt(order.createdAt, cutoff)))
    .limit(opts.limit ?? ANONYMISE_BATCH);
  if (!due.length) return 0;
  const done = await db
    .update(order)
    .set({ ...ANONYMISED, address: null, postcode: null, note: null, ipHash: null, anonymisedAt: now })
    .where(and(inArray(order.id, due.map((d) => d.id)), isNull(order.anonymisedAt)))
    .returning({ id: order.id });
  return done.length;
}
