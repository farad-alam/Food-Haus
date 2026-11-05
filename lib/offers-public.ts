import { cacheLife, cacheTag } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { category, offer } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import type { Db } from "@/lib/db/client";
import { offerStatus, type OfferChannel, type OfferFacts, type OfferType } from "./offers";

// Offers shown on the public site (home page, /offers, menu). Only offers the
// owner marked "show on website". The cache holds the RAW list (tag "offers",
// expired instantly by every admin save); whether an offer is live right now is
// decided at request time, so an offer that ends or starts never lingers or
// appears early because of a cached page.

export type PublicOffer = {
  id: number;
  name: string;
  type: OfferType;
  value: number | null;
  categoryName: string | null;
  channel: OfferChannel;
  code: string | null;
  minSpend: number;
  startsAt: string | null; // ISO: cache entries must be plain data
  endsAt: string | null;
  usageLimit: number | null;
  usedCount: number;
};

export async function loadPublicOffers(db: Db): Promise<PublicOffer[]> {
  const [rows, cats] = await db.batch([
    db.select().from(offer).where(eq(offer.showOnSite, true)).orderBy(asc(offer.id)),
    db.select({ id: category.id, name: category.name }).from(category),
  ]);
  const names = new Map(cats.map((c) => [c.id, c.name]));
  return rows.map((o) => ({
    id: o.id,
    name: o.name,
    type: o.type,
    value: o.value,
    categoryName: o.appliesToCategoryId ? (names.get(o.appliesToCategoryId) ?? null) : null,
    channel: o.channel,
    code: o.code,
    minSpend: o.minSpend,
    startsAt: o.startsAt?.toISOString() ?? null,
    endsAt: o.endsAt?.toISOString() ?? null,
    usageLimit: o.usageLimit,
    usedCount: o.usedCount,
  }));
}

export async function getPublicOffers(): Promise<PublicOffer[]> {
  "use cache";
  cacheTag("offers");
  cacheLife("minutes"); // admin saves expire it at once; this only bounds how stale a usage count can get
  return loadPublicOffers(getDb());
}

export const toFacts = (o: PublicOffer): OfferFacts => ({
  type: o.type,
  value: o.value,
  categoryName: o.categoryName,
  channel: o.channel,
  code: o.code,
  minSpend: o.minSpend,
  startsAt: o.startsAt ? new Date(o.startsAt) : null,
  endsAt: o.endsAt ? new Date(o.endsAt) : null,
  usageLimit: o.usageLimit,
  usedCount: o.usedCount,
});

/** Offers customers could use right now (not scheduled, not ended, not used up). */
export function liveOffers(offers: PublicOffer[], now: Date): PublicOffer[] {
  return offers.filter((o) => offerStatus(toFacts(o), now) === "active");
}
