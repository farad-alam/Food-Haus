import type { Metadata } from "next";
import { AddToBasket } from "@/components/basket";
import { getMenu } from "@/lib/menu";
import { ALLERGENS } from "@/lib/menu-constants";
import { formatPence, formatPenceExact } from "@/lib/money";
import { shop } from "@/lib/shop";

export const metadata: Metadata = {
  title: "Order Halal Burgers Online in Luton",
  description:
    "The full Food Haus menu: halal smash burgers, wings, wraps, loaded fries and tenders. Order online for delivery or collection in Luton LU4.",
  alternates: { canonical: "/menu" },
};

// R10.9: menu data ships in the HTML — no spinner on first view.
export default async function MenuPage() {
  const menu = await getMenu();

  return (
    <main>
      <div className="mx-auto max-w-5xl px-4 pt-6">
        <h1 className="font-display text-4xl sm:text-5xl">Order Halal Burgers Online in Luton</h1>
        <p className="mt-1 text-muted">Everything is halal. Prices include VAT.</p>
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
            {cat.name === "Wings" && (
              <p className="mt-1 inline-block rounded-lg bg-brand px-3 py-1 text-sm font-bold text-black">
                Buy 1 Get 1 Free on wings — collection only
              </p>
            )}
            {menu.optionGroups[cat.name] && (
              <p className="mt-1 text-sm text-muted">
                {menu.optionGroups[cat.name].name}: add {formatPenceExact(menu.optionGroups[cat.name].options[0].priceChange)}
              </p>
            )}
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {cat.items.map((item) => (
                <li key={item.id} className="flex flex-col justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
                  <div>
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="font-bold">{item.name}</h3>
                      <span className="whitespace-nowrap font-bold text-brand">{formatPence(item.price)}</span>
                    </div>
                    {item.description && <p className="mt-1 text-sm text-muted">{item.description}</p>}
                    {item.allergens === null ? (
                      <p className="mt-2 text-xs text-muted">
                        Allergens: please ask before ordering — call {shop.phoneDisplay}.
                      </p>
                    ) : item.allergens.length > 0 ? (
                      <p className="mt-2 text-xs text-muted">
                        Contains: {ALLERGENS.filter((a) => item.allergens!.includes(a.key)).map((a) => a.label).join(", ")}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-muted">No major allergens declared.</p>
                    )}
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
