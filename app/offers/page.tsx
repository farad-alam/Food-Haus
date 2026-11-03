import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Burger Deals & Offers in Luton",
  description: "Current Food Haus offers: buy one get one free on wings for collection, plus promo codes for delivery.",
  alternates: { canonical: "/offers" },
};

// Replaced by the live offers module (R9.8) reading the `offer` table.
export default function OffersPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <h1 className="font-display text-5xl">Burger Deals & Offers in Luton</h1>
      <article className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-display text-3xl text-brand">Buy 1 Get 1 Free on wings</h2>
        <p className="text-muted">Collection and phone orders only.</p>
        <Link href="/menu#wings" className="btn btn-primary mt-3">Order now</Link>
      </article>
    </main>
  );
}
