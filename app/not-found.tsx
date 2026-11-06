import Link from "next/link";
import { phoneDisplay, telHref } from "@/lib/contact-format";
import { DEFAULT_CONTACT } from "@/lib/contact";
import { getContact } from "@/lib/contact-public";

// R5.12: never leave a visitor stuck — link to the menu and a phone number.
export default async function NotFound() {
  const phone = await getContact().then((c) => c.phone, () => DEFAULT_CONTACT.phone);
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="font-display text-5xl">Page not found</h1>
      <p className="mt-2 text-muted">That page doesn’t exist, but the food does.</p>
      <p className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/menu" className="btn btn-primary">Back to the menu</Link>
        <a href={telHref(phone)} className="btn btn-ghost">Call {phoneDisplay(phone)}</a>
      </p>
    </main>
  );
}
