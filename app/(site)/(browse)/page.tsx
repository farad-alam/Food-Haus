import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { RestaurantJsonLd } from "@/components/json-ld";
import { preload } from "react-dom";
import { Suspense } from "react";
import { AddToBasket } from "@/components/basket";
import { CategoryArt, MiniIcon } from "@/components/food-art";
import { FoodPicture, HOME_DEFAULTS } from "@/components/home-photos";
import { OfferBand } from "@/components/live-offers";
import { HeroStatus } from "@/components/shop-status";
import { ReviewsBlock } from "@/components/reviews";
import { Torn } from "@/components/torn";
import { getHomeImages } from "@/lib/home-images";
import { getMenu } from "@/lib/menu";
import { getSchedule } from "@/lib/schedule-public";
import { weekTimetable } from "@/lib/shop-status";
import { formatPence } from "@/lib/money";
import { getContact } from "@/lib/contact-public";
import { fullAddress, mapsLinkFor, phoneDisplay, telHref } from "@/lib/contact-format";
import { getPhotoCloudName } from "@/lib/photos";
import { bannerSrcSet, bannerUrl, photoSrcSet, photoUrl, squareSrcSet, squareUrl } from "@/lib/photos/keys";
import { shop } from "@/lib/shop";

export const metadata: Metadata = pageMetadata({
  title: "Food Haus — Halal Burger Takeaway & Delivery in Luton",
  absoluteTitle: true,
  description: "Order halal smash burgers, wings, loaded fries and wraps direct from Food Haus in Luton (LU4). Delivery and collection, pay by card or cash.",
  path: "/",
});

// The home page is bands of alternating colour (ink, cream, orange, crimson) with torn edges between them
// (R5.1). Every image slot shows, in this order: the photo uploaded in Settings (Home page images), else the
// built-in photo the owner supplied (components/home-photos.tsx), else our own drawn art. The built-in photos
// are decoration for this page only and are never attached to a menu item (item photos are the shop's real
// food). All decoration is static: no JavaScript, no autoplay, no carousels, nothing moves on its own (R10).
export default async function Home() {
  const menu = await getMenu();
  const contact = await getContact();
  const { hours } = await getSchedule(); // owner-entered opening hours: structured data and the hours block
  const timetable = weekTimetable(hours);
  const photoCloud = getPhotoCloudName();
  const home = await getHomeImages();

  // Hero picture (R5.1, R10.5): the image uploaded in Settings (Home page images, hero), else the built-in
  // one. It is the page's largest element, so it is preloaded; AVIF-only preload is safe (a browser that cannot
  // use AVIF ignores a preload whose type it does not support and falls back to the <picture> sources).
  const heroBg = photoCloud && home.hero ? home.hero : null;
  const HERO_SIZES = "(min-width: 768px) 600px, 100vw";
  if (heroBg) preload(squareUrl(photoCloud, heroBg.key, 800), { as: "image", imageSrcSet: squareSrcSet(photoCloud, heroBg.key), imageSizes: HERO_SIZES, fetchPriority: "high" });
  else preload(`${HOME_DEFAULTS.hero.base}-1024.avif`, { as: "image", type: "image/avif", imageSrcSet: HOME_DEFAULTS.hero.widths.map((w) => `${HOME_DEFAULTS.hero.base}-${w}.avif ${w}w`).join(", "), imageSizes: HERO_SIZES, fetchPriority: "high" });

  /** The hero picture at one of its two placements (right-hand layer / phone strip). Decorative: the headline says everything. */
  const heroImg = (className: string) =>
    heroBg ? (
      // eslint-disable-next-line @next/next/no-img-element -- already sized by Cloudinary transformations
      <img src={squareUrl(photoCloud, heroBg.key, 800)} srcSet={squareSrcSet(photoCloud, heroBg.key)} sizes={HERO_SIZES} alt="" width={1024} height={1024} loading="eager" fetchPriority="high" decoding="async" className={className} />
    ) : (
      <FoodPicture image={HOME_DEFAULTS.hero} sizes={HERO_SIZES} loading="eager" fetchPriority="high" imgClassName={className} />
    );

  const slugOf = new Map(menu.categories.map((c) => [c.name, c.slug]));

  return (
    <main className="bg-ink">
      <RestaurantJsonLd menu={menu} hours={hours} contact={contact} />

      {/* ---- HERO (dark edge to edge: CSS glow, the burger anchored right at full hero height, text left) --- */}
      <section className="hero-bg relative overflow-hidden bg-ink">
        {/* Tablet and up: the square picture sits at the right at the hero's full height (so a ~600 px hero shows
            it at ~1.7x pixel density), its left edge masked away so there is no visible box. */}
        <div aria-hidden="true" className="absolute inset-y-0 right-0 hidden aspect-square h-full md:block">
          {heroImg("hero-mask h-full w-full object-cover")}
        </div>
        {/* Wash under the text: solid ink on the left so the words keep AA contrast over the glow or the burger. */}
        <div aria-hidden="true" className="absolute inset-0 hidden bg-gradient-to-r from-ink from-30% via-ink/70 via-50% to-transparent md:block" />
        <div className="relative mx-auto max-w-5xl px-4 pb-6 pt-8 sm:pt-14 md:flex md:min-h-[520px] md:items-center md:pb-14 lg:min-h-[600px]">
          <div className="md:max-w-sm lg:max-w-xl">
            <p className="mb-2 inline-block rounded-full border border-ok px-3 py-1 text-xs font-bold uppercase tracking-wide text-ok">100% Halal</p>
            {/* R5.1: open or closed with the next opening time; fixed-height row so it streaming in shifts nothing (R10.8) */}
            <div className="mb-3 min-h-[1.5rem]">
              <Suspense fallback={null}>
                <HeroStatus />
              </Suspense>
            </div>
            <h1 className="font-display text-6xl leading-[0.95] sm:text-8xl">
              Halal <span className="text-brand">burgers</span> in Luton
            </h1>
            <p className="mt-3 max-w-xl text-lg text-muted">Smash burgers, wings, tenders and loaded fries — order direct from the shop.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/menu" className="btn btn-primary">Order now</Link>
              <a href="#categories" className="btn btn-ghost">See the menu</a>
            </div>
            {/* Delivery and collection strip */}
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-4 text-sm text-muted">
              <li className="flex items-center gap-2"><MiniIcon kind="scooter" className="h-5 w-5 text-brand" /> Delivery &amp; collection</li>
              <li className="flex items-center gap-2"><MiniIcon kind="pay" className="h-5 w-5 text-brand" /> Card or cash</li>
              <li className="flex items-center gap-2"><MiniIcon kind="menu" className="h-5 w-5 text-brand" /> No account needed</li>
            </ul>
          </div>
        </div>
        {/* On phones the text comes first on plain ink, then the picture below it, fading in from the ink above
            so there is no box edge; the burger (right of centre) stays in view. */}
        <div aria-hidden="true" className="relative -mt-2 md:hidden">
          {heroImg("hero-mask-phone aspect-[5/4] w-full object-cover object-[right_55%]")}
        </div>
      </section>

      {/* ---- CATEGORY TILES (warm cream) ----------------------------------------------------- */}
      <Torn from="bg-ink" to="text-cream" />
      <section id="categories" aria-labelledby="categories-h" className="bg-cream text-ink">
        <div className="mx-auto max-w-5xl px-4 py-10">
          <h2 id="categories-h" className="font-display text-4xl sm:text-5xl">What are you craving?</h2>
          <ul className="mt-6 grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-6">
            {menu.categories.map((cat) => {
              const img = photoCloud ? home.categories[cat.slug] : undefined;
              const fallback = HOME_DEFAULTS.categories[cat.slug];
              return (
                <li key={cat.slug} className="text-center">
                  <Link href={`/menu#${cat.slug}`} className="group block no-underline">
                    <span className="mx-auto block h-20 w-20 overflow-hidden rounded-full border-4 border-cream-2 bg-ink shadow-md transition group-hover:border-brand motion-safe:group-hover:-translate-y-1 sm:h-24 sm:w-24">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element -- already sized by Cloudinary transformations
                        <img src={photoUrl(photoCloud, img, 400)} alt="" width={200} height={150} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                      ) : fallback ? (
                        <FoodPicture image={fallback} sizes="96px" imgClassName="h-full w-full object-cover" />
                      ) : (
                        <CategoryArt slug={cat.slug} className="h-full w-full bg-cream-2 p-2" />
                      )}
                    </span>
                    <span className="mt-2 block text-sm font-bold text-ink">{cat.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* ---- OFFERS BAND (orange) ------------------------------------------------------------ */}
      <Torn from="bg-cream" to="text-brand" rip={1} />
      <section aria-labelledby="offers-h" className="bg-brand text-ink">
        <div className="mx-auto max-w-5xl px-4 py-6">
          <h2 id="offers-h" className="text-xs font-bold uppercase tracking-[0.2em]">Offers</h2>
          <div className="mt-1 min-h-10">
            <Suspense fallback={null}>
              <OfferBand />
            </Suspense>
          </div>
        </div>
      </section>

      {/* ---- POPULAR (ink) --------------------------------------------------------------------- */}
      <Torn from="bg-brand" to="text-ink" flip />
      <section aria-labelledby="popular" className="bg-ink">
        {/* The wide feast banner (decoration): the admin-uploaded one, else the built-in one. Its black background melts into the band. */}
        <div aria-hidden="true" className="mx-auto max-w-[1100px]">
          {photoCloud && home.banner ? (
            // eslint-disable-next-line @next/next/no-img-element -- already sized by Cloudinary transformations
            <img src={bannerUrl(photoCloud, home.banner, 1024)} srcSet={bannerSrcSet(photoCloud, home.banner)} sizes="(min-width: 1100px) 1100px, 100vw" alt="" width={1600} height={900} loading="lazy" decoding="async" className="aspect-video w-full object-cover" />
          ) : (
            <FoodPicture image={HOME_DEFAULTS.banner} sizes="(min-width: 1100px) 1100px, 100vw" imgClassName="w-full" />
          )}
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-10 pt-2">
          <h2 id="popular" className="font-display text-4xl sm:text-5xl">Popular <span className="text-brand">right now</span></h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {menu.popular.map((item) => {
              const slug = slugOf.get(item.category) ?? "";
              return (
                <li key={item.id} className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition motion-safe:hover:-translate-y-0.5 hover:border-brand/60">
                  {photoCloud && item.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- already sized by Cloudinary transformations
                    <img src={photoUrl(photoCloud, item.photo.key, 400)} srcSet={photoSrcSet(photoCloud, item.photo.key)} sizes="(min-width: 1024px) 320px, (min-width: 640px) 45vw, 90vw" alt={item.photo.alt} width={400} height={300} loading="lazy" decoding="async" className="aspect-[4/3] w-full bg-surface-2 object-cover" />
                  ) : (
                    <div aria-hidden="true" className="flex aspect-[4/3] w-full items-center justify-center bg-gradient-to-br from-crimson to-ink">
                      <CategoryArt slug={slug} className="h-24 w-24 -rotate-6 opacity-90" />
                    </div>
                  )}
                  <div className="flex grow flex-col gap-2 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-bold">{item.name}</h3>
                      <span className="whitespace-nowrap rounded-full bg-brand px-2.5 py-0.5 font-bold text-ink">{formatPence(item.price)}</span>
                    </div>
                    <p className="line-clamp-2 text-sm text-muted">{item.description}</p>
                    <div className="mt-auto flex justify-end">
                      <AddToBasket id={item.id} name={item.name} price={item.price} soldOut={item.soldOut} optionGroup={menu.optionGroups[item.category] ?? null} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-6">
            <Link href="/menu" className="btn btn-ghost">See the full menu</Link>
          </p>
        </div>
      </section>

      {/* ---- HOW ORDERING WORKS (cream) -------------------------------------------------------- */}
      <Torn from="bg-ink" to="text-cream" rip={1} flip />
      <section aria-labelledby="how-h" className="bg-cream text-ink">
        <div className="mx-auto max-w-5xl px-4 py-10">
          <h2 id="how-h" className="font-display text-4xl sm:text-5xl">How it works</h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-3">
            {(
              [
                ["menu", "Pick your food", "Browse the menu and add to your basket. No account needed."],
                ["scooter", "Delivery or collection", "Enter your postcode to see your delivery fee before you go on."],
                ["pay", "Pay your way", "Card, bank or cash on delivery."],
              ] as const
            ).map(([icon, title, text], n) => (
              <li key={icon} className="relative rounded-2xl bg-cream-2 p-5 pt-6">
                <span aria-hidden="true" className="absolute -top-4 left-5 flex h-9 w-9 items-center justify-center rounded-full bg-brand font-display text-xl text-ink shadow">{n + 1}</span>
                <MiniIcon kind={icon} className="h-8 w-8 text-crimson" />
                <h3 className="mt-2 font-display text-2xl">{title}</h3>
                <p className="mt-1 text-ink/70">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---- GOOGLE REVIEWS (ink): renders nothing until configured; loads Google only after first paint */}
      <Torn from="bg-cream" to="text-ink" />
      <section className="bg-ink">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <ReviewsBlock />
        </div>
      </section>

      {/* ---- FIND US + HOURS (deep red) --------------------------------------------------------- */}
      <Torn from="bg-ink" to="text-crimson" rip={1} />
      <section aria-labelledby="find" className="bg-crimson text-cream">
        <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 md:grid-cols-2">
          <div>
            <h2 id="find" className="font-display text-4xl sm:text-5xl">Find us</h2>
            <p className="mt-3 text-lg">{shop.name}, {fullAddress(contact)}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <a href={telHref(contact.phone)} className="btn btn-primary" data-event="click_call">Call {phoneDisplay(contact.phone)}</a>
              <a href={mapsLinkFor(contact)} rel="noopener noreferrer" className="btn border-2 !border-cream/50 text-cream hover:!border-cream" data-event="click_directions">Get directions</a>
            </div>
          </div>
          {/* Opening hours (R5.1), from the same settings as the status in the hero and the footer. Nothing until the owner enters them. */}
          {timetable.length > 0 && (
            <div data-testid="home-hours">
              <h3 className="font-display text-3xl">Opening hours</h3>
              <dl className="mt-2 divide-y divide-cream/20 border-y border-cream/20">
                {timetable.map((r) => (
                  <div key={r.day} className="flex justify-between gap-4 py-1.5">
                    <dt className="font-bold">{r.day}</dt>
                    <dd className={r.times === "Closed" ? "text-cream/60" : ""}>{r.times}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-sm text-cream/70">Times are UK time. We may close on bank holidays.</p>
            </div>
          )}
        </div>
      </section>
      <Torn from="bg-crimson" to="text-surface" />
    </main>
  );
}
