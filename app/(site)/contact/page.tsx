import type { Metadata } from "next";
import { fullAddress, mapsLink, shop } from "@/lib/shop";

export const metadata: Metadata = {
  title: "Contact & Delivery Area",
  description: "Call, WhatsApp or visit Food Haus at 314-318 Selbourne Road, Luton LU4 8NU. Halal burgers, delivery and collection.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  const tel = shop.phone.replace(/\s/g, "");
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <h1 className="font-display text-5xl">Contact Food Haus</h1>
      <address className="not-italic text-lg">
        <p>{shop.name}</p>
        <p>{fullAddress}</p>
      </address>
      <p className="flex flex-wrap gap-3">
        <a href={`tel:${tel}`} className="btn btn-primary" data-event="click_call">Call {shop.phoneDisplay}</a>
        <a href={`https://wa.me/${tel.replace("+", "")}`} rel="noopener noreferrer" className="btn btn-ghost">WhatsApp</a>
        <a href={mapsLink} rel="noopener noreferrer" className="btn btn-ghost" data-event="click_directions">Get directions</a>
      </p>
      {/* TODO: opening hours + delivery area render here once the owner confirms them (section 14) */}
    </main>
  );
}
