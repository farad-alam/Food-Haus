import type { Metadata } from "next";
import { Suspense } from "react";
import { OfferCards } from "@/components/live-offers";

export const metadata: Metadata = {
  title: "Burger Deals & Offers in Luton",
  description: "Current Food Haus offers and promo codes for delivery and collection in Luton.",
  alternates: { canonical: "/offers" },
};

// Live from the offers table (R9.8): only offers the owner chose to show, and only while they are running.
export default function OffersPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <h1 className="font-display text-5xl">Burger Deals & Offers in Luton</h1>
      <Suspense fallback={<p className="text-muted" role="status">Loading offers…</p>}>
        <OfferCards />
      </Suspense>
    </main>
  );
}
