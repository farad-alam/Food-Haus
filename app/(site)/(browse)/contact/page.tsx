import type { Metadata } from "next";
import { getSchedule } from "@/lib/schedule-public";
import { weekTimetable } from "@/lib/shop-status";
import { fullAddress, mapsLink, shop } from "@/lib/shop";

export const metadata: Metadata = {
  title: "Contact & Delivery Area",
  description: "Call, WhatsApp or visit Food Haus at 314-318 Selbourne Road, Luton LU4 8NU. Halal burgers, delivery and collection.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage() {
  const timetable = weekTimetable((await getSchedule()).hours);
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
