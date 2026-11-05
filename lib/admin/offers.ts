import { asc, count, eq } from "drizzle-orm";
import { category, offer, order } from "@/db/schema";
import type { Db } from "@/lib/db/client";
import { londonLocalToUtc, utcToLondonLocal } from "@/lib/london-time";
import { offerStatus, type OfferChannel, type OfferStatus, type OfferType } from "@/lib/offers";
import { auditInsert, type Actor } from "./audit";
import type { OfferInput } from "./offer-schema";
import type { Result } from "./settings";

// Offers and promo codes (R6.7, R9.8). Every change is audited in the same
// transaction (R9.13). `usedCount` is never edited here: it is maintained by
// checkout (reserve) and by cancellation/rejection (release).

export type OfferView = {
  id: number;
  name: string;
  type: OfferType;
  value: number | null;
  appliesToCategoryId: number | null;
  appliesToCategory: string | null;
  channel: OfferChannel;
  code: string | null;
  minSpend: number;
  startsAtLocal: string | null; // UK time, for the form
  endsAtLocal: string | null;
  startsAt: string | null; // ISO instants, for the preview
  endsAt: string | null;
  usageLimit: number | null;
  usedCount: number;
  showOnSite: boolean;
  status: OfferStatus;
};

export async function loadOffersAdmin(db: Db, now: Date): Promise<{ offers: OfferView[]; categories: { id: number; name: string }[] }> {
  const [rows, cats] = await db.batch([db.select().from(offer).orderBy(asc(offer.id)), db.select({ id: category.id, name: category.name }).from(category).orderBy(asc(category.sortOrder))]);
  const names = new Map(cats.map((c) => [c.id, c.name]));
  return {
    categories: cats,
    offers: rows.map((o) => ({
      id: o.id,
      name: o.name,
      type: o.type,
      value: o.value,
      appliesToCategoryId: o.appliesToCategoryId,
      appliesToCategory: o.appliesToCategoryId ? (names.get(o.appliesToCategoryId) ?? null) : null,
      channel: o.channel,
      code: o.code,
      minSpend: o.minSpend,
      startsAtLocal: o.startsAt ? utcToLondonLocal(o.startsAt) : null,
      endsAtLocal: o.endsAt ? utcToLondonLocal(o.endsAt) : null,
      startsAt: o.startsAt?.toISOString() ?? null,
      endsAt: o.endsAt?.toISOString() ?? null,
      usageLimit: o.usageLimit,
      usedCount: o.usedCount,
      showOnSite: o.showOnSite,
      status: offerStatus(o, now),
    })),
  };
}

const isUnique = (e: unknown) => /duplicate key|unique/i.test(e instanceof Error ? `${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}` : "");

async function checkCategory(db: Db, o: OfferInput): Promise<Result | null> {
  if (o.appliesToCategoryId === null) return null;
  const [c] = await db.select({ id: category.id }).from(category).where(eq(category.id, o.appliesToCategoryId)).limit(1);
  return c ? null : { ok: false, code: "INVALID", message: "That category no longer exists." };
}

const toRow = (o: OfferInput) => ({
  name: o.name,
  type: o.type,
  value: o.value,
  appliesToCategoryId: o.type === "bogof" ? o.appliesToCategoryId : null,
  channel: o.channel,
  code: o.code ? o.code.toUpperCase() : null, // stored upper-case; matching is case-insensitive
  minSpend: o.minSpend,
  startsAt: o.startsAt ? londonLocalToUtc(o.startsAt) : null,
  endsAt: o.endsAt ? londonLocalToUtc(o.endsAt) : null,
  usageLimit: o.usageLimit,
  showOnSite: o.showOnSite,
});

const DUP: Result = { ok: false, code: "DUPLICATE", message: "That promo code is already used by another offer." };

export async function createOffer(db: Db, a: Actor, input: OfferInput): Promise<Result<{ id: number }>> {
  const bad = await checkCategory(db, input);
  if (bad) return bad as Result<{ id: number }>;
  try {
    const [row] = await db.insert(offer).values(toRow(input)).returning({ id: offer.id });
    await auditInsert(db, a, "offer.create", `offer:${row.id}`, null, toRow(input));
    return { ok: true, id: row.id };
  } catch (e) {
    if (isUnique(e)) return DUP as Result<{ id: number }>;
    throw e;
  }
}

export async function updateOffer(db: Db, a: Actor, id: number, input: OfferInput): Promise<Result> {
  const [before] = await db.select().from(offer).where(eq(offer.id, id)).limit(1);
  if (!before) return { ok: false, code: "NOT_FOUND", message: "Offer not found." };
  const bad = await checkCategory(db, input);
  if (bad) return bad;
  try {
    await db.batch([db.update(offer).set(toRow(input)).where(eq(offer.id, id)), auditInsert(db, a, "offer.update", `offer:${id}`, before, toRow(input))]);
    return { ok: true };
  } catch (e) {
    if (isUnique(e)) return DUP;
    throw e;
  }
}

export async function deleteOffer(db: Db, a: Actor, id: number): Promise<Result> {
  const [before] = await db.select().from(offer).where(eq(offer.id, id)).limit(1);
  if (!before) return { ok: false, code: "NOT_FOUND", message: "Offer not found." };
  // Orders keep a reference to the offer they used, so a used offer must stay for the record.
  const [{ n }] = await db.select({ n: count() }).from(order).where(eq(order.offerId, id));
  if (n > 0) {
    return { ok: false, code: "INVALID", message: `This offer was used on ${n} order${n === 1 ? "" : "s"}, so it cannot be deleted. Use “End now” to stop it instead.` };
  }
  await db.batch([db.delete(offer).where(eq(offer.id, id)), auditInsert(db, a, "offer.delete", `offer:${id}`, before, null)]);
  return { ok: true };
}
