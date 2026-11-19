import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AREA_COPY, areaIsIndexable, isAreaSlug } from "@/lib/areas";
import { fullAddress, mapsLinkFor } from "@/lib/contact-format";
import { getContact } from "@/lib/contact-public";
import { getMenu } from "@/lib/menu";
import { formatPence, formatPenceExact } from "@/lib/money";
import { getPhotoCloudName } from "@/lib/photos";
import { photoUrl } from "@/lib/photos/keys";
import { getSchedule } from "@/lib/schedule-public";
import { pageMetadata } from "@/lib/seo";
import { weekTimetable } from "@/lib/shop-status";
import { getZoneBySlug } from "@/lib/zones-public";

// A page exists only for a district that is an active delivery zone (R5.8, R11.6). Until the SEO lead adds real
// local copy for it (lib/areas.ts) the page is noindex and not in the sitemap.
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const zone = isAreaSlug(slug) ? await getZoneBySlug(slug) : null;
  if (!zone) return { title: "Not found", robots: { index: false, follow: false } };
  return pageMetadata({
    title: `Halal burger delivery in ${zone.district}`,
    description: `Food Haus delivers to ${zone.district}: delivery from ${formatPenceExact(zone.fee)}, minimum order ${formatPenceExact(zone.minOrder)}, about ${zone.estimatedMinutes} minutes. Halal burgers, wings and loaded fries.`,
    path: `/areas/${slug}`,
    noindex: !areaIsIndexable(slug),
  });
}

export default async function AreaPage({ params }: Props) {
  const { slug } = await params;
  const zone = isAreaSlug(slug) ? await getZoneBySlug(slug) : null;
  if (!zone) notFound();
  const [menu, contact, schedule] = await Promise.all([getMenu(), getContact(), getSchedule()]);
  const timetable = weekTimetable(schedule.hours);
  const copy = AREA_COPY[slug];
  const photoCloud = getPhotoCloudName();
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <h1 className="font-display text-5xl">Halal burger delivery in {zone.district}</h1>
      {copy?.intro && <p className="text-lg">{copy.intro}</p>}
      <section aria-labelledby="deliv-h" className="rounded-2xl border border-line bg-surface p-4">
        <h2 id="deliv-h" className="font-display text-3xl">Delivery to {zone.district}</h2>
        <dl className="mt-2 grid gap-2 sm:grid-cols-3">
          <div><dt className="text-sm text-muted">Delivery fee</dt><dd className="text-xl font-bold" data-testid="area-fee">{formatPenceExact(zone.fee)}</dd></div>
          <div><dt className="text-sm text-muted">Minimum order</dt><dd className="text-xl font-bold" data-testid="area-min">{formatPenceExact(zone.minOrder)}</dd></div>
          <div><dt className="text-sm text-muted">Usual time</dt><dd className="text-xl font-bold" data-testid="area-eta">about {zone.estimatedMinutes} minutes</dd></div>
        </dl>
        <p className="mt-2 text-sm text-muted">Times are estimates and can change when the kitchen is busy. You can also collect from the shop.</p>
      </section>
      {copy?.places && copy.places.length > 0 && (
        <section aria-labelledby="places-h">
          <h2 id="places-h" className="font-display text-3xl">Areas we cover</h2>
          <ul className="mt-2 list-disc pl-6">{copy.places.map((p) => <li key={p}>{p}</li>)}</ul>
        </section>
      )}
      <section aria-labelledby="pop-h">
        <h2 id="pop-h" className="font-display text-3xl">Popular items</h2>
        <ul className="mt-2 grid gap-3 sm:grid-cols-2">
          {menu.popular.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-3 rounded-2xl border border-line bg-surface p-3">
              {photoCloud && i.photo && (
                // eslint-disable-next-line @next/next/no-img-element -- already resized at upload; served from our own /media route
                <img src={photoUrl(photoCloud, i.photo.key, 400)} alt={i.photo.alt} width={96} height={72} loading="lazy" decoding="async" className="h-[72px] w-24 shrink-0 rounded-lg bg-surface-2 object-cover" />
              )}
              <div className="min-w-0 grow"><p className="font-bold">{i.name}</p></div>
              <span className="font-bold text-brand">{formatPence(i.price)}</span>
            </li>
          ))}
        </ul>
      </section>
      {timetable.length > 0 && (
        <section aria-labelledby="hrs-h">
          <h2 id="hrs-h" className="font-display text-3xl">Opening hours</h2>
          <dl className="mt-2 divide-y divide-line border-y border-line">
            {timetable.map((r) => (
              <div key={r.day} className="flex justify-between gap-4 py-1.5"><dt className="font-bold">{r.day}</dt><dd className={r.times === "Closed" ? "text-muted" : ""}>{r.times}</dd></div>
            ))}
          </dl>
        </section>
      )}
      <p className="text-muted">{contact.legalName ?? "Food Haus"}, {fullAddress(contact)}</p>
      <p className="flex flex-wrap gap-3">
        <Link href="/menu" className="btn btn-primary">Order now</Link>
        <a href={mapsLinkFor(contact)} rel="noopener noreferrer" className="btn btn-ghost" data-event="click_directions">Get directions</a>
      </p>
    </main>
  );
}
