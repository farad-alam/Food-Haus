import Link from "next/link";
import { shop } from "@/lib/shop";

// R5.12: never leave a visitor stuck — link to the menu and a phone number.
export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="font-display text-5xl">Page not found</h1>
      <p className="mt-2 text-muted">That page doesn’t exist, but the food does.</p>
      <p className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/menu" className="btn btn-primary">Back to the menu</Link>
        <a href={`tel:${shop.phone.replace(/\s/g, "")}`} className="btn btn-ghost">Call {shop.phoneDisplay}</a>
      </p>
    </main>
  );
}
