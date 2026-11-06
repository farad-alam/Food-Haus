import Link from "next/link";
import { formatPenceExact } from "@/lib/money";
import { fullAddress, phoneDisplay, type Contact } from "@/lib/contact-format";
import { shop } from "@/lib/shop";
import type { OrderDetail } from "@/lib/admin/history";
import { paymentText, StatusBadge } from "./status-badge";
import { PrintButton } from "./print-button";

// One past order (R9.11): a receipt that prints cleanly (header, buttons and the
// dark theme are removed for print) plus the internal audit trail. Server-rendered.

const stamp = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

function actionText(t: OrderDetail["trail"][number]): string {
  const a = (t.after ?? {}) as { prepMinutes?: number; reason?: string };
  switch (t.action) {
    case "order.accept": return `Accepted${a.prepMinutes ? `, ready in ${a.prepMinutes} minutes` : ""}`;
    case "order.reject": return `Rejected${a.reason ? `: ${a.reason}` : ""}`;
    case "order.ready": return "Marked ready";
    case "order.out_for_delivery": return "Sent out for delivery";
    case "order.completed": return "Marked completed";
    default: return t.action;
  }
}

export function OrderReceipt({ o, contact }: { o: OrderDetail; contact: Contact }) {
  const tel = o.phone.replace(/\s/g, "");
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 pb-20 pt-6 print:max-w-none print:px-0 print:pt-0">
      <p className="print:hidden"><Link href="/admin/history" className="underline">← Order history</Link></p>

      <article className="receipt rounded-xl border border-line bg-surface p-5 print:border-0 print:p-0" aria-label={`Order ${o.number}`}>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-display text-2xl text-brand print:text-black">{shop.name}</p>
            <p className="text-sm text-muted print:text-black">{fullAddress(contact)}<br />{phoneDisplay(contact.phone)}</p>
          </div>
          <div className="text-right">
            <p className="font-display text-5xl leading-none">#{o.number}</p>
            <p className="text-sm text-muted print:text-black">{stamp(o.createdAt)}</p>
          </div>
        </header>

        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge status={o.status} />
          <span className="font-bold">{o.type === "delivery" ? "Delivery" : "Collection"}</span>
          <span>· {paymentText(o.paymentMethod, o.paymentStatus)}</span>
        </p>
        {o.rejectionReason && <p className="mt-2 font-bold">Rejected: {o.rejectionReason}</p>}

        <ul className="mt-4 divide-y divide-line border-y border-line print:divide-black print:border-black">
          {o.items.map((i, n) => (
            <li key={n} className="flex justify-between gap-4 py-2">
              <span>{i.quantity} × {i.name}{i.options.length > 0 && <span className="block text-sm text-muted print:text-black">{i.options.map((x) => x.name).join(", ")}</span>}</span>
              <span>{formatPenceExact(i.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatPenceExact(o.subtotal)}</dd></div>
          {o.deliveryFee > 0 && <div className="flex justify-between"><dt>Delivery</dt><dd>{formatPenceExact(o.deliveryFee)}</dd></div>}
          {o.discount > 0 && <div className="flex justify-between"><dt>Offer{o.offerName ? `: ${o.offerName}` : ""}</dt><dd>-{formatPenceExact(o.discount)}</dd></div>}
          <div className="flex justify-between text-xl font-bold"><dt>Total</dt><dd>{formatPenceExact(o.total)}</dd></div>
        </dl>

        <section className="mt-5" aria-labelledby="cust-h">
          <h2 id="cust-h" className="font-bold">Customer</h2>
          {o.anonymisedAt ? (
            <p className="text-muted print:text-black">Contact details were removed on {stamp(o.anonymisedAt)} (orders older than 12 months). The order and its totals are kept.</p>
          ) : (
            <>
              <p>{o.customerName}</p>
              <p><a href={`tel:${tel}`} className="underline">{o.phone}</a> · {o.email}</p>
              {o.type === "delivery" && <p>{o.address}, {o.postcode}</p>}
            </>
          )}
          {o.note && <p className="mt-1">Note: {o.note}</p>}
        </section>
      </article>

      <div className="print:hidden"><PrintButton /></div>

      <section aria-labelledby="trail-h" className="print:hidden">
        <h2 id="trail-h" className="font-display text-2xl">What happened</h2>
        <p className="text-sm text-muted">Who changed this order, and when. The kitchen shares one login, so this is the only record of the person.</p>
        {o.trail.length === 0 ? (
          <p className="mt-2 text-muted">No staff actions recorded{o.paymentMethod === "card" && o.paymentStatus === "paid" && o.status === "received" ? " yet" : ""}.</p>
        ) : (
          <ol className="mt-2 space-y-1">
            {o.trail.map((t, n) => (
              <li key={n} className="rounded-lg border border-line p-2"><strong>{actionText(t)}</strong><span className="block text-sm text-muted">{stamp(t.at)} · {t.by ?? "unknown user"}</span></li>
            ))}
          </ol>
        )}
        {o.prepMinutes && <p className="mt-2 text-sm text-muted">Promised in about {o.prepMinutes} minutes.</p>}
      </section>
    </div>
  );
}
