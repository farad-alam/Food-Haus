import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Suspense } from "react";
import { AddToBasket } from "@/components/basket";
import { CategoryOffers } from "@/components/live-offers";
import { ReviewsBadge } from "@/components/reviews";
import { TrackMenuView } from "@/components/track";
import { getMenu } from "@/lib/menu";
import { claimText, itemClaim } from "@/lib/allergens";
import { photoSrcSet, photoUrl } from "@/lib/photos/keys";
import { formatPence, formatPenceExact } from "@/lib/money";
import { getContact } from "@/lib/contact-public";
import { phoneDisplay } from "@/lib/contact-format";

export const metadata: Metadata = pageMetadata({
  title: "Order Halal Burgers Online in Luton",
  description: "The full Food Haus menu: halal smash burgers, wings, wraps, loaded fries and tenders. Order online for delivery or collection in Luton LU4.",
  path: "/menu",
});

// R10.9: menu data ships in the HTML — no spinner on first view.
export default async function MenuPage() {
  const menu = await getMenu();
  const phone = phoneDisplay((await getContact()).phone);

  return (
    <main>
      <TrackMenuView />
      <div className="mx-auto max-w-5xl px-4 pt-6">
        <h1 className="font-display text-4xl sm:text-5xl">Order Halal Burgers Online in Luton</h1>
        <p className="mt-1 text-muted">Everything is halal. Prices include VAT.</p>
        <div className="mt-3 max-w-xs"><ReviewsBadge /></div>
      </div>

      {/* Sticky category tabs — plain anchor links, no JavaScript needed */}
      <nav aria-label="Menu categories" className="sticky top-[57px] z-20 mt-4 border-y border-line bg-ink/95 backdrop-blur">
        <ul className="mx-auto flex max-w-5xl gap-2 overflow-x-auto px-4 py-2">
          {menu.categories.map((c) => (
            <li key={c.slug}>
              <a href={`#${c.slug}`} className="btn btn-ghost !min-h-[44px] whitespace-nowrap !px-4 !py-2 text-sm">
                {c.name}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mx-auto max-w-5xl space-y-10 px-4 py-6">
        {menu.categories.map((cat) => (
          <section key={cat.slug} id={cat.slug} aria-labelledby={`${cat.slug}-h`}>
            <h2 id={`${cat.slug}-h`} className="font-display text-3xl text-brand">{cat.name}</h2>
            <Suspense fallback={null}>
              <CategoryOffers category={cat.name} />
            </Suspense>
            {menu.optionGroups[cat.name] && (
              <p className="mt-1 text-sm text-muted">
                {menu.optionGroups[cat.name].name}: add {formatPenceExact(menu.optionGroups[cat.name].options[0].priceChange)}
              </p>
            )}
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {cat.items.map((item) => (
                <li key={item.id} className="flex flex-col justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
                  <div>
                    {item.photo && (
                      // Fixed 4:3 box with explicit size: nothing moves when the photo arrives (R10.8). Lazy, resized, WebP (R10.5).
                      // eslint-disable-next-line @next/next/no-img-element -- already resized at upload; served from our own /media route
                      <img src={photoUrl(item.photo.key, 400)} srcSet={photoSrcSet(item.photo.key)} sizes="(min-width: 640px) 320px, 90vw" alt={item.photo.alt} width={400} height={300} loading="lazy" decoding="async" className="mb-3 aspect-[4/3] w-full rounded-xl bg-surface-2 object-cover" />
                    )}
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="font-bold">{item.name}</h3>
                      <span className="whitespace-nowrap font-bold text-brand">{formatPence(item.price)}</span>
                    </div>
                    {item.description && <p className="mt-1 text-sm text-muted">{item.description}</p>}
                    <ItemAllergens phone={phone} item={item} options={menu.optionGroups[item.category]?.options ?? []} />
                  </div>
                  <div className="flex justify-end">
                    <AddToBasket id={item.id} name={item.name} price={item.price} soldOut={item.soldOut} optionGroup={menu.optionGroups[item.category] ?? null} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
          Food allergies or intolerances? Tell us in the note at checkout or call us before you order.
        </p>
      </div>
    </main>
  );
}

/** The ONLY allergen line on a menu card: whatever lib/allergens.ts says may be claimed, never anything inferred. */
function ItemAllergens({ phone, item, options }: { phone: string; item: { allergens: string[] | null }; options: { allergens: string[] | null }[] }) {
  const { text, ask } = claimText(itemClaim(item.allergens, options.map((o) => o.allergens)), options.length > 0);
  return (
    <p className="mt-2 text-xs text-muted" data-allergen-claim={item.allergens === null ? "unknown" : "entered"}>
      {text}
      {ask && <> Call {phone}.</>}
    </p>
  );
}
