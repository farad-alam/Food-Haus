import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Suspense } from "react";
import { AllergenGrid } from "@/components/allergen-grid";
import { LegalPage } from "@/components/legal";
import { claimText, itemClaim, optionClaim, optionText } from "@/lib/allergens";
import { readinessFromMenu } from "@/lib/allergen-readiness";
import { allergenNotice, LEGAL_APPROVED } from "@/lib/legal";
import { getMenu } from "@/lib/menu";
import { shop } from "@/lib/shop";

// SAFETY-CRITICAL (R11.10). Every line about an item comes from lib/allergens.ts, which only ever
// states what the owner explicitly entered for that item. Nothing is inferred or defaulted.
// The page is hidden from search engines until BOTH the wording is approved (LEGAL_APPROVED) and
// every item and option has its allergen data entered.
export async function generateMetadata(): Promise<Metadata> {
  const live = LEGAL_APPROVED && (await menuReady());
  return pageMetadata({ title: "Allergen Information", description: "Allergen information for every Food Haus menu item and option, covering the 14 allergens, so you can order safely.", path: "/allergens", noindex: !live });
}

async function menuReady(): Promise<boolean> {
  try {
    return readinessFromMenu(await getMenu()).ready;
  } catch {
    return false; // cannot tell: treat as not ready
  }
}

export default function Page() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl px-4 py-8"><p className="text-muted" role="status">Loading…</p></main>}>
      <Body />
    </Suspense>
  );
}

async function Body() {
  const menu = await getMenu();
  const readiness = readinessFromMenu(menu);
  const missing = readiness.itemsMissing.length + readiness.optionsMissing.length;
  return (
    <LegalPage
      doc={allergenNotice}
      extraNotice={
        !readiness.ready && (
          <p role="note" data-testid="allergen-incomplete" className="rounded-lg border border-yellow-400 bg-yellow-400/10 p-3 text-yellow-200">
            <strong>Allergen information is not complete.</strong> {readiness.itemsTotal === 0 ? "No menu items are listed yet." : `${readiness.itemsMissing.length} of ${readiness.itemsTotal} items${readiness.optionsMissing.length ? ` and ${readiness.optionsMissing.length} option${readiness.optionsMissing.length === 1 ? "" : "s"}` : ""} have no allergen information yet.`} Where an item says “not confirmed”, please ask us before ordering{missing ? `: call ${shop.phoneDisplay}` : ""}.
          </p>
        )
      }
      beforeSections={
        <div className="space-y-6" data-testid="allergen-list">
          {menu.categories.map((cat) => {
            const group = menu.optionGroups[cat.name];
            const opts = group?.options ?? [];
            return (
              <section key={cat.slug} aria-labelledby={`cat-${cat.slug}`}>
                <h2 id={`cat-${cat.slug}`} className="font-display text-3xl">{cat.name}</h2>
                <div className="mt-2"><AllergenGrid category={cat.name} items={cat.items} options={opts.map((o) => o.allergens)} /></div>
                <h3 className="mt-4 font-bold">In words</h3>
                <ul className="mt-1 divide-y divide-line border-y border-line">
                  {cat.items.map((i) => {
                    const { text, ask } = claimText(itemClaim(i.allergens, opts.map((o) => o.allergens)), opts.length > 0);
                    return (
                      <li key={i.id} className="py-2" data-item={i.slug} data-claim={i.allergens === null ? "unknown" : "entered"}>
                        <p className="font-bold">{i.name}</p>
                        <p className={ask ? "text-yellow-300" : "text-muted"}>{text}</p>
                      </li>
                    );
                  })}
                </ul>
                {group && (
                  <div className="mt-3 rounded-lg border border-line bg-surface p-3">
                    <h3 className="font-bold">{group.name} (adds to any {cat.name} item)</h3>
                    <ul className="mt-1 space-y-1">
                      {group.options.map((o) => {
                        const { text, ask } = optionText(optionClaim(o.allergens));
                        return (
                          <li key={o.id} data-option={o.id} data-claim={o.allergens === null ? "unknown" : "entered"}>
                            <span className="font-bold">{o.name}:</span> <span className={ask ? "text-yellow-300" : "text-muted"}>{text}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </section>
            );
          })}
          {menu.categories.length === 0 && <p className="text-muted">The menu is not available right now. Please call us about allergens before ordering.</p>}
        </div>
      }
    />
  );
}
