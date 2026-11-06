import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { getSchedule } from "@/lib/schedule-public";
import { weekTimetable } from "@/lib/shop-status";
import { getContact } from "@/lib/contact-public";
import { fullAddress, mapsLinkFor, phoneDisplay, telHref } from "@/lib/contact-format";
import { shop } from "@/lib/shop";

export async function generateMetadata(): Promise<Metadata> {
  const c = await getContact(); // the description carries the address, so it follows what the owner saved
  return pageMetadata({
    title: "Contact & Delivery Area",
    description: `Call, WhatsApp or visit Food Haus at ${fullAddress(c)}. Halal burgers, delivery and collection.`,
    path: "/contact",
  });
}

export default async function ContactPage() {
  const timetable = weekTimetable((await getSchedule()).hours);
  const contact = await getContact();
  const tel = contact.phone;
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <h1 className="font-display text-5xl">Contact Food Haus</h1>
      <address className="not-italic text-lg">
        <p>{shop.name}</p>
        <p>{fullAddress(contact)}</p>
      </address>
      <p className="flex flex-wrap gap-3">
        <a href={telHref(tel)} className="btn btn-primary" data-event="click_call">Call {phoneDisplay(tel)}</a>
        <a href={`https://wa.me/${tel.replace("+", "")}`} rel="noopener noreferrer" className="btn btn-ghost">WhatsApp</a>
        <a href={mapsLinkFor(contact)} rel="noopener noreferrer" className="btn btn-ghost" data-event="click_directions">Get directions</a>
      </p>
      {/* Opening hours come from the admin settings (R9.9). Nothing is shown until the owner has entered them. */}
      {timetable.length > 0 && (
        <section aria-labelledby="hours-h">
          <h2 id="hours-h" className="font-display text-3xl">Opening hours</h2>
          <dl className="mt-2 divide-y divide-line border-y border-line">
            {timetable.map((r) => (
              <div key={r.day} className="flex justify-between gap-4 py-2">
                <dt className="font-bold">{r.day}</dt>
                <dd className={r.times === "Closed" ? "text-muted" : ""}>{r.times}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-sm text-muted">Times are UK time. We may close on bank holidays.</p>
        </section>
      )}
      {/* TODO: delivery area renders here once the owner confirms the zones (section 14) */}
    </main>
  );
}
