import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Bebas_Neue, Inter } from "next/font/google";
import "./globals.css";
import { BasketProvider, StickyBasketBar } from "@/components/basket";
import { fullAddress, mapsLink, shop, SITE_URL } from "@/lib/shop";

// R10.6: two self-hosted families, Latin subset, font-display swap.
const display = Bebas_Neue({ weight: "400", subsets: ["latin"], variable: "--font-display", display: "swap" });
const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0b0b",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Food Haus — Halal Burger Takeaway & Delivery in Luton",
    template: "%s | Food Haus",
  },
  description:
    "Order halal smash burgers, wings, loaded fries and wraps direct from Food Haus in Luton (LU4). Delivery and collection, pay by card or cash.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_GB",
    siteName: shop.name,
    title: "Food Haus — Halal Burger Takeaway & Delivery in Luton",
    description: "Halal smash burgers, wings and loaded fries. Order direct for delivery or collection in Luton.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${display.variable} ${body.variable}`}>
      <body className="flex min-h-screen flex-col">
        <BasketProvider>
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

          <Suspense fallback={null}>
            <StickyBasketBar />
          </Suspense>

          <footer className="border-t border-line bg-surface">
            <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8 pb-28 text-sm text-muted sm:grid-cols-3">
              <div>
                <p className="font-display text-2xl text-text">FOOD HAUS</p>
                <p>{shop.legalName}</p>
                {/* TODO R11.11: Companies House number, registered office, VAT number */}
                <p>Halal · Burgers · Good vibes</p>
              </div>
              <address className="not-italic">
                <p className="font-semibold text-text">Find us</p>
                <p>{fullAddress}</p>
                <p>
                  <a href={`tel:${shop.phone.replace(/\s/g, "")}`}>{shop.phoneDisplay}</a>
                </p>
                <p>
                  <a href={mapsLink} rel="noopener noreferrer">
                    Get directions
                  </a>
                </p>
              </address>
              <nav aria-label="Legal">
                <p className="font-semibold text-text">Info</p>
                <ul className="space-y-1">
                  <li><Link href="/allergens">Allergens</Link></li>
                  <li><Link href="/privacy">Privacy</Link></li>
                  <li><Link href="/cookies">Cookies</Link></li>
                  <li><Link href="/terms">Terms</Link></li>
                </ul>
              </nav>
            </div>
          </footer>
        </BasketProvider>
      </body>
    </html>
  );
}
