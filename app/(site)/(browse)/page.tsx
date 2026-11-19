import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { RestaurantJsonLd } from "@/components/json-ld";
import { preload } from "react-dom";
import { Suspense } from "react";
import { AddToBasket } from "@/components/basket";
import { OfferStrip } from "@/components/live-offers";
import { HeroStatus } from "@/components/shop-status";
import { ReviewsBlock } from "@/components/reviews";
import { getMenu } from "@/lib/menu";
import { getSchedule } from "@/lib/schedule-public";
import { weekTimetable } from "@/lib/shop-status";
import { formatPence } from "@/lib/money";
import { getContact } from "@/lib/contact-public";
import { fullAddress, mapsLinkFor, phoneDisplay, telHref } from "@/lib/contact-format";
import { getPhotoCloudName } from "@/lib/photos";
import { photoSrcSet, photoUrl } from "@/lib/photos/keys";
import { shop } from "@/lib/shop";

export const metadata: Metadata = pageMetadata({
  title: "Food Haus — Halal Burger Takeaway & Delivery in Luton",
  absoluteTitle: true,
  description: "Order halal smash burgers, wings, loaded fries and wraps direct from Food Haus in Luton (LU4). Delivery and collection, pay by card or cash.",
  path: "/",
});

export default async function Home() {
  const menu = await getMenu();
  const contact = await getContact();
  const { hours } = await getSchedule(); // owner-entered opening hours: structured data and the hours block
  const timetable = weekTimetable(hours);
  // Hero photo (R5.1, R10.5): a real photo of the first popular item that has one. Never a stock or placeholder image.
  const photoCloud = getPhotoCloudName();
  const heroItem = photoCloud ? (menu.popular.find((i) => i.photo) ?? null) : null;
  if (heroItem?.photo) preload(photoUrl(photoCloud, heroItem.photo.key, 800), { as: "image", imageSrcSet: photoSrcSet(photoCloud, heroItem.photo.key), imageSizes: "(min-width: 768px) 480px, 100vw", fetchPriority: "high" });

  return (
    <main>
      <RestaurantJsonLd menu={menu} hours={hours} contact={contact} />

      {/* Hero: one line, one action (Build principles) */}
      <section className="border-b border-line bg-gradient-to-b from-surface to-ink">
        <div className={`mx-auto max-w-5xl px-4 py-10 sm:py-16 ${heroItem?.photo ? "grid items-center gap-8 md:grid-cols-2" : ""}`}>
          <div>
          <p className="mb-2 inline-block rounded-full border border-ok px-3 py-1 text-xs font-bold uppercase tracking-wide text-ok">
            100% Halal
          </p>
          {/* R5.1: open or closed, with the next opening time. A fixed-height row, so it streaming in shifts nothing (R10.8). */}
          <div className="mb-3 min-h-[1.5rem]">
            <Suspense fallback={null}>
              <HeroStatus />
            </Suspense>
          </div>
          <h1 className="font-display text-5xl leading-none sm:text-7xl">
            Halal burgers <span className="text-brand">in Luton</span>
          </h1>
          <p className="mt-3 max-w-xl text-lg text-muted">
            Smash burgers, wings, tenders and loaded fries — order direct from the shop for delivery or collection.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/menu" className="btn btn-primary">Order now</Link>
            <a href={telHref(contact.phone)} className="btn btn-ghost" data-event="click_call">
              Call {phoneDisplay(contact.phone)}
            </a>
          </div>
          {/* Live offers (R9.8): only what the owner is running right now */}
          <div className="mt-6 h-9">
            <Suspense fallback={null}>
              <OfferStrip />
            </Suspense>
          </div>
          </div>
          {heroItem?.photo && (
            // Fixed 4:3 box with explicit size and a high fetch priority: it is the largest thing on the page and must not shift it (R10.5, R10.8).
            // eslint-disable-next-line @next/next/no-img-element -- already resized at upload; served from our own /media route
            <img
              src={photoUrl(photoCloud, heroItem.photo.key, 800)}
              srcSet={photoSrcSet(photoCloud, heroItem.photo.key)}
              sizes="(min-width: 768px) 480px, 100vw"
              alt={heroItem.photo.alt}
              width={1200}
              height={900}
              fetchPriority="high"
              decoding="async"
              className="aspect-[4/3] w-full rounded-2xl bg-surface-2 object-cover"
            />
          )}
        </div>
      </section>

      {/* Popular items */}
      <section className="mx-auto max-w-5xl px-4 py-8" aria-labelledby="popular">
        <h2 id="popular" className="font-display text-3xl">Popular right now</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {menu.popular.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
              {photoCloud && item.photo && (
                // eslint-disable-next-line @next/next/no-img-element -- already resized at upload; served from our own /media route
                <img src={photoUrl(photoCloud, item.photo.key, 400)} alt={item.photo.alt} width={96} height={72} loading="lazy" decoding="async" className="h-[72px] w-24 shrink-0 rounded-lg bg-surface-2 object-cover" />
              )}
              <div className="min-w-0 grow">
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

      {/* Google rating and reviews (R7.1): renders nothing until configured; loads Google only after first paint */}
      <section className="mx-auto max-w-5xl px-4 pb-8">
        <ReviewsBlock />
      </section>

      {/* How ordering works */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-5xl gap-4 px-4 py-8 sm:grid-cols-3">
          <div><h3 className="font-display text-2xl">1. Pick your food</h3><p className="text-muted">Browse the menu and add to your basket. No account needed.</p></div>
          <div><h3 className="font-display text-2xl">2. Delivery or collection</h3><p className="text-muted">Enter your postcode to see your delivery fee before you go on.</p></div>
          <div><h3 className="font-display text-2xl">3. Pay your way</h3><p className="text-muted">Card, bank or cash on delivery.</p></div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-10" aria-labelledby="find">
        <h2 id="find" className="font-display text-3xl">Find us</h2>
        <p className="mt-2">{shop.name}, {fullAddress(contact)}</p>
        <p className="mt-3">
          <a href={mapsLinkFor(contact)} rel="noopener noreferrer" className="btn btn-ghost" data-event="click_directions">Get directions</a>
        </p>
        {/* Opening hours (R5.1), from the same settings as the status above and the footer. Nothing shown until the owner enters them. */}
        {timetable.length > 0 && (
          <div className="mt-6 max-w-sm" data-testid="home-hours">
            <h3 className="font-display text-2xl">Opening hours</h3>
            <dl className="mt-2 divide-y divide-line border-y border-line">
              {timetable.map((r) => (
                <div key={r.day} className="flex justify-between gap-4 py-1.5">
                  <dt className="font-bold">{r.day}</dt>
                  <dd className={r.times === "Closed" ? "text-muted" : ""}>{r.times}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-sm text-muted">Times are UK time. We may close on bank holidays.</p>
          </div>
        )}
      </section>
    </main>
  );
}
