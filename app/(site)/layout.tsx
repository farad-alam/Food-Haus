import Link from "next/link";
import { Suspense } from "react";
import { BasketProvider, StickyBasketBar } from "@/components/basket";
import { Analytics, CookieBanner, CookieSettingsButton } from "@/components/cookie-consent";
import { NoticeBar } from "@/components/notice-bar";
import { validGaId } from "@/lib/consent";
import { getSchedule } from "@/lib/schedule-public";
import { weekTimetable } from "@/lib/shop-status";
import { company, fullAddress, mapsLink, shop } from "@/lib/shop";

// Public site chrome: header, basket, footer. The admin panel (app/admin) lives
// outside this group so it never inherits any of it.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  // R11.9: with no GA4 ID configured there is nothing to ask about, so no banner and no analytics code.
  const analyticsId = validGaId(process.env.NEXT_PUBLIC_GA_ID);
  return (
    <BasketProvider>
          {/* First, on purpose: its effect must run before any page component's effect, so the gtag queue exists when a page sends its first event. */}
          <Analytics id={analyticsId} />
          <Suspense fallback={null}>
            <NoticeBar />
          </Suspense>
          <header className="sticky top-0 z-30 border-b border-line bg-ink/95 backdrop-blur">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2">
              <Link href="/" className="font-display text-3xl leading-none text-brand no-underline" aria-label="Food Haus home">
                FOOD HAUS
              </Link>
              <nav aria-label="Main" className="hidden items-center gap-5 text-sm sm:flex">
                <Link href="/menu">Menu</Link>
                <Link href="/offers">Offers</Link>
                <Link href="/contact">Contact</Link>
              </nav>
              {/* R2: one primary action visible on every public page */}
              <Link href="/menu" className="btn btn-primary !min-h-[44px] !px-4 !py-2 text-sm">
                Order now
              </Link>
            </div>
          </header>

          {/* bottom padding reserves space for the sticky basket bar (R10.8) */}
          <div className="flex-1 pb-24">{children}</div>

          <CookieBanner analyticsId={analyticsId} />

          <Suspense fallback={null}>
            <StickyBasketBar />
          </Suspense>

          <footer className="border-t border-line bg-surface">
            <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8 pb-28 text-sm text-muted sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="font-display text-2xl text-text">FOOD HAUS</p>
                <p>{shop.legalName}</p>
                {company.number && <p>Company no. {company.number}</p>}
                {company.registeredOffice && <p>Registered office: {company.registeredOffice}</p>}
                {company.vatNumber && <p>VAT no. {company.vatNumber}</p>}
                <p>Halal · Burgers · Good vibes</p>
              </div>
              <address className="not-italic">
                <p className="font-semibold text-text">Find us</p>
                <p>{fullAddress}</p>
                <p>
                  <a href={`tel:${shop.phone.replace(/\s/g, "")}`} data-event="click_call">{shop.phoneDisplay}</a>
                </p>
                <p>
                  <a href={mapsLink} rel="noopener noreferrer" data-event="click_directions">
                    Get directions
                  </a>
                </p>
              </address>
              <Suspense fallback={null}>
                <FooterHours />
              </Suspense>
              <nav aria-label="Legal">
                <p className="font-semibold text-text">Info</p>
                <ul className="space-y-1">
                  <li><Link href="/allergens">Allergens</Link></li>
                  <li><Link href="/privacy">Privacy</Link></li>
                  <li><Link href="/cookies">Cookies</Link></li>
                  <li><Link href="/terms">Terms</Link></li>
                  {analyticsId && <li><CookieSettingsButton analyticsId={analyticsId} /></li>}
                </ul>
              </nav>
            </div>
          </footer>
        </BasketProvider>
  );
}

/** Opening hours in the footer (R5.1, R11.5), from the admin settings. Nothing is shown until the owner has entered them. */
async function FooterHours() {
  let rows: { day: string; times: string }[] = [];
  try {
    rows = weekTimetable((await getSchedule()).hours);
  } catch {
    return null;
  }
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="font-semibold text-text">Opening hours</p>
      <dl className="space-y-0.5">
        {rows.map((r) => (
          <div key={r.day} className="flex justify-between gap-3">
            <dt>{r.day}</dt>
            <dd>{r.times}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
