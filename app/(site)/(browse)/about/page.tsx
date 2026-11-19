import type { Metadata } from "next";
import Link from "next/link";
import { getContact } from "@/lib/contact-public";
import { fullAddress } from "@/lib/contact-format";
import { pageMetadata } from "@/lib/seo";
import { shop } from "@/lib/shop";

export const metadata: Metadata = pageMetadata({
  title: "About Food Haus",
  description: "Food Haus is a halal takeaway in Luton (LU4): smash burgers, wings, tenders, wraps and loaded fries, for delivery or collection.",
  path: "/about",
});

// R5.7. Two short paragraphs written ONLY from facts already on the site (the menu, the address, how ordering
// works, the TikTok account). Nothing about history, owners, awards, sourcing or recipes: none of that has been
// supplied, and it must not be invented. Photos are added when the owner has real ones.
export default async function AboutPage() {
  const contact = await getContact();
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <h1 className="font-display text-5xl">About Food Haus</h1>
      <p className="text-lg">
        Food Haus is a halal takeaway at {fullAddress(contact)}. The menu is smash burgers, wings, tenders, wraps and loaded fries, and everything on it is halal.
      </p>
      <p className="text-lg">
        You can order straight from this website for delivery or collection and pay by card or cash, or <Link href="/contact" className="underline">get in touch</Link> if you have a question. For news and photos, follow us on{" "}
        <a href={shop.tiktok} rel="noopener noreferrer" className="underline">TikTok (@mia.bhai43)</a>.
      </p>
      <p className="flex flex-wrap gap-3 pt-2">
        <Link href="/menu" className="btn btn-primary">See the menu</Link>
        <Link href="/allergens" className="btn btn-ghost">Allergen information</Link>
      </p>
    </main>
  );
}
