import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Inter } from "next/font/google";
import "./globals.css";
import { shop, SITE_URL } from "@/lib/shop";

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
      <body className="flex min-h-screen flex-col">{children}</body>
    </html>
  );
}
