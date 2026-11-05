import { auditLog } from "@/db/schema";
import type { Db } from "@/lib/db/client";

// R9.13: one place that builds audit-log inserts, so every admin module records
// who / what / before / after the same way. Returns the builder (not awaited) so
// callers can put it in the same db.batch() transaction as the change itself.
export type Actor = { userId: number; now: Date };

export const auditInsert = (db: Db, a: Actor, action: string, entity: string, before: unknown, after: unknown) =>
  db.insert(auditLog).values({ userId: a.userId, action, entity, before: before ?? null, after: after ?? null, at: a.now });
