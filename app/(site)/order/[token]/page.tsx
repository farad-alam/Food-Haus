import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { OrderLive } from "@/components/order-live";
import { TrackPurchase } from "@/components/track";
import { getDb } from "@/lib/db/client";
import { formatPenceExact } from "@/lib/money";
import { ACTIVE_STATUSES, orderWasPlaced, paymentLine, statusLine } from "@/lib/order-status";
import { loadOrderByToken } from "@/lib/order-view";
import { getContact } from "@/lib/contact-public";
import { phoneDisplay, telHref } from "@/lib/contact-format";

// R5.5 / R6.12 / R13.15: reached only through the random token in the URL.
// Never indexed, never cached, and the token is not leaked in the Referer header.
export const metadata: Metadata = {
  title: "Your order",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function OrderPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <Suspense fallback={<p className="text-muted" role="status">Loading your order…</p>}>
        <OrderBody params={params} />
      </Suspense>
    </main>
  );
}

async function OrderBody({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const o = await loadOrderByToken(getDb(), token);
  if (!o) notFound();

  const line = statusLine(o);
  const contact = await getContact();
  const tel = telHref(contact.phone);
  const color = line.tone === "good" ? "text-green-400" : line.tone === "bad" ? "text-red-400" : "text-brand";

  return (
    <>
      <OrderLive active={ACTIVE_STATUSES.includes(o.status)} placed={orderWasPlaced(o.status)} orderNumber={o.number} />
      <TrackPurchase
        placed={orderWasPlaced(o.status) && (o.paymentMethod === "cash" || o.paymentStatus === "paid")}
        order={{ number: o.number, total: o.total, deliveryFee: o.deliveryFee, discount: o.discount, paymentMethod: o.paymentMethod, items: o.items.map((i) => ({ name: i.name, quantity: i.quantity, lineTotal: i.lineTotal })) }}
      />
      <p className="text-muted">Order number</p>
      <h1 className="font-display text-5xl">{o.number}</h1>

      <section aria-live="polite" className="mt-4 rounded-lg border border-line bg-surface p-4">
        <p className={`text-xl font-bold ${color}`}>{line.headline}</p>
        {line.detail && <p className="mt-1 text-muted">{line.detail}</p>}
        <p className="mt-2 text-sm text-muted">{o.type === "delivery" ? "Delivery" : "Collection"}</p>
      </section>

      <section className="mt-6">
        <h2 className="font-display text-2xl">Your order</h2>
        <ul className="mt-2 divide-y divide-line border-y border-line">
          {o.items.map((i, n) => (
            <li key={n} className="flex justify-between gap-4 py-2">
              <span>
                {i.quantity} × {i.name}
                {i.options.length > 0 && <span className="block text-sm text-muted">{i.options.map((x) => x.name).join(", ")}</span>}
              </span>
              <span>{formatPenceExact(i.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatPenceExact(o.subtotal)}</dd></div>
          {o.deliveryFee > 0 && <div className="flex justify-between"><dt>Delivery</dt><dd>{formatPenceExact(o.deliveryFee)}</dd></div>}
          {o.discount > 0 && <div className="flex justify-between"><dt>Offer</dt><dd>-{formatPenceExact(o.discount)}</dd></div>}
          <div className="flex justify-between text-lg font-bold"><dt>Total</dt><dd>{formatPenceExact(o.total)}</dd></div>
        </dl>
        <p className="mt-2 font-bold">{paymentLine(o)}</p>
      </section>

      <section className="mt-6 rounded-lg border border-line bg-surface-2 p-4 text-sm">
        <p className="font-bold">Allergies or intolerances?</p>
        <p className="mt-1 text-muted">
          Check the <Link href="/allergens" className="underline">allergen information</Link> and call us before you eat if you are unsure.
          {o.type === "delivery" && " A printed allergen list is in your delivery bag."}
        </p>
      </section>

      <p className="mt-6 flex flex-wrap gap-3">
        <a href={tel} className="btn btn-primary">Call {phoneDisplay(contact.phone)}</a>
        <Link href="/menu" className="btn btn-ghost">Back to the menu</Link>
      </p>
    </>
  );
}
