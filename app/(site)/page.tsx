import type { Metadata } from "next";
import Link from "next/link";
import { RestaurantJsonLd } from "@/components/json-ld";
import { Suspense } from "react";
import { AddToBasket } from "@/components/basket";
import { OfferStrip } from "@/components/live-offers";
import { getMenu } from "@/lib/menu";
import { formatPence } from "@/lib/money";
import { fullAddress, mapsLink, shop } from "@/lib/shop";

export const metadata: Metadata = {
  title: { absolute: "Food Haus — Halal Burger Takeaway & Delivery in Luton" },
  alternates: { canonical: "/" },
};

export default async function Home() {
  const menu = await getMenu();

  return (
    <main>
      <RestaurantJsonLd menu={menu} />

      {/* Hero: one line, one action (Build principles) */}
      <section className="border-b border-line bg-gradient-to-b from-surface to-ink">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:py-16">
          <p className="mb-2 inline-block rounded-full border border-ok px-3 py-1 text-xs font-bold uppercase tracking-wide text-ok">
            100% Halal
          </p>
          <h1 className="font-display text-5xl leading-none sm:text-7xl">
            Halal burgers <span className="text-brand">in Luton</span>
          </h1>
          <p className="mt-3 max-w-xl text-lg text-muted">
            Smash burgers, wings, tenders and loaded fries — order direct from the shop for delivery or collection.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/menu" className="btn btn-primary">Order now</Link>
            <a href={`tel:${shop.phone.replace(/\s/g, "")}`} className="btn btn-ghost" data-event="click_call">
              Call {shop.phoneDisplay}
            </a>
          </div>
          {/* Live offers (R9.8): only what the owner is running right now */}
          <Suspense fallback={null}>
            <OfferStrip />
          </Suspense>
        </div>
      </section>

      {/* Popular items */}
      <section className="mx-auto max-w-5xl px-4 py-8" aria-labelledby="popular">
        <h2 id="popular" className="font-display text-3xl">Popular right now</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {menu.popular.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
              <div>
                <h3 className="font-bold">{item.name}</h3>
                <p className="line-clamp-2 text-sm text-muted">{item.description}</p>
                <p className="mt-1 font-bold text-brand">{formatPence(item.price)}</p>
              </div>
              <AddToBasket id={item.id} name={item.name} price={item.price} soldOut={item.soldOut} optionGroup={menu.optionGroups[item.category] ?? null} />
            </li>
          ))}
        </ul>
        <p className="mt-4">
          <Link href="/menu" className="btn btn-ghost">See the full menu</Link>
        </p>
      </section>

      {/* How ordering works */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-5xl gap-4 px-4 py-8 sm:grid-cols-3">
          <div><h3 className="font-display text-2xl">1. Pick your food</h3><p className="text-muted">Browse the menu and add to your basket. No account needed.</p></div>
          <div><h3 className="font-display text-2xl">2. Delivery or collection</h3><p className="text-muted">Enter your postcode to see your delivery fee before you go on.</p></div>
          <div><h3 className="font-display text-2xl">3. Pay your way</h3><p className="text-muted">Card, bank or cash on delivery.</p></div>
        </div>
      </section>

      {/* Google reviews: Places UI Kit element goes here (R7) — reserved space */}
      <section className="mx-auto max-w-5xl px-4 py-8" aria-labelledby="reviews">
        <h2 id="reviews" className="font-display text-3xl">What customers say</h2>
        <div className="mt-4 min-h-[160px] rounded-2xl border border-dashed border-line p-4 text-sm text-muted">
          Live Google rating and reviews load here (requirement R7, Places UI Kit). Space is reserved so the page never jumps.
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-10" aria-labelledby="find">
        <h2 id="find" className="font-display text-3xl">Find us</h2>
        <p className="mt-2">{shop.name}, {fullAddress}</p>
        <p className="mt-3">
          <a href={mapsLink} rel="noopener noreferrer" className="btn btn-ghost" data-event="click_directions">Get directions</a>
        </p>
      </section>
    </main>
  );
}
