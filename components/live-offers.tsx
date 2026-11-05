import Link from "next/link";
import { connection } from "next/server";
import { describeConditions, describeDeal, describeShort } from "@/lib/offers";
import { getPublicOffers, liveOffers, toFacts } from "@/lib/offers-public";
import { slugify } from "@/lib/menu-model";

// Live offers for the public pages (R9.8). `connection()` makes these render at
// request time (they depend on the clock); put each inside <Suspense>.

async function current() {
  await connection();
  return liveOffers(await getPublicOffers(), new Date());
}

/**
 * Home page strip: the first live offer (and a link if there are more), in ONE row
 * of fixed height. The caller reserves that row, so this streaming in after the
 * first paint pushes nothing down (R10.8). A long offer is truncated, never wrapped.
 */
export async function OfferStrip() {
  const offers = await current();
  if (offers.length === 0) return null;
  return (
    <div className="flex h-9 items-center gap-3 overflow-hidden">
      <p className="min-w-0 truncate rounded-xl bg-brand px-4 py-2 text-sm font-bold text-black">{describeShort(toFacts(offers[0]))}</p>
      {offers.length > 1 && <Link href="/offers" className="shrink-0 text-sm underline">+{offers.length - 1} more</Link>}
    </div>
  );
}

/** Menu page: a badge under a category heading for each live buy-one-get-one on it. */
export async function CategoryOffers({ category }: { category: string }) {
  const offers = (await current()).filter((o) => o.type === "bogof" && o.categoryName === category);
  if (offers.length === 0) return null;
  return (
    <>
      {offers.map((o) => (
        <p key={o.id} className="mt-1 inline-block rounded-lg bg-brand px-3 py-1 text-sm font-bold text-black">{describeShort(toFacts(o))}</p>
      ))}
    </>
  );
}

/** The /offers page. */
export async function OfferCards() {
  const offers = await current();
  if (offers.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-5">
        <p className="text-muted">There are no offers on right now. Check back soon.</p>
        <Link href="/menu" className="btn btn-primary mt-3">See the menu</Link>
      </div>
    );
  }
  return (
    <>
      {offers.map((o) => {
        const facts = toFacts(o);
        const conditions = describeConditions(facts);
        return (
          <article key={o.id} className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-display text-3xl text-brand">{o.name}</h2>
            <p className="mt-1 font-bold">{describeDeal(facts)}</p>
            {conditions.length > 0 && <p className="text-muted">{conditions.join(" · ")}</p>}
            {o.code && (
              <p className="mt-2">
                Use code <span className="rounded bg-ink px-2 py-1 font-mono font-bold text-brand">{o.code}</span> at checkout
              </p>
            )}
            <Link href={o.categoryName ? `/menu#${slugify(o.categoryName)}` : "/menu"} className="btn btn-primary mt-3">Order now</Link>
          </article>
        );
      })}
    </>
  );
}
