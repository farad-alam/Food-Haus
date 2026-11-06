"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useBasket } from "@/components/basket";
import { beginCheckoutEvent, promoAppliedEvent, track } from "@/lib/analytics-events";
import { Turnstile } from "@/components/turnstile";
import { MAX_NOTE } from "@/lib/basket-store";
import { formatPenceExact } from "@/lib/money";
import { parsePostcode } from "@/lib/pricing";
import { useContact } from "@/components/contact-context";
import { phoneDisplay } from "@/lib/contact-format";

// Checkout (R6.6, R6.9, R6.10, R6.14, R13.7). Everything priced here is a
// PREVIEW from POST /api/quote; the browser sends only item ids, quantities
// and details to POST /api/checkout, and the server prices the order again.

type Err = { code: string; message: string; itemId?: string };
type Zone = { district: string; fee: number; minOrder: number; estimatedMinutes: number };
type QuoteOut =
  | { ok: true; open: boolean; closedMessage?: string; closedLabel?: string; lines: { itemId: string; lineTotal: number }[]; subtotal: number; deliveryFee: number; discount: number; total: number; appliedOffer: { name: string } | null; estimatedMinutes: number | null; zone: Zone | null }
  | { ok: false; open: boolean; closedMessage?: string; closedLabel?: string; errors: Err[]; zone: Zone | null };

const input = "w-full min-h-[48px] rounded-lg border border-line bg-surface-2 px-3 py-2 text-base text-text";
const noop = () => () => {};
const turnstileKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export function CheckoutForm() {
  const router = useRouter();
  const cancelled = useSearchParams().get("cancelled") === "1";
  const { lines, note, setQty, setNote } = useBasket();
  const contact = useContact();
  // Server render and first client render see an empty basket; wait for the real one.
  const hydrated = useSyncExternalStore(noop, () => true, () => false);

  const [orderType, setOrderType] = useState<"delivery" | "collection">("collection");
  const [payment, setPayment] = useState<"card" | "cash">("card");
  const [postcode, setPostcode] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "" });
  const [promoInput, setPromoInput] = useState("");
  const [promo, setPromo] = useState("");
  const [promoMsg, setPromoMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [token, setToken] = useState<string | null>(null);
  const [tsReset, setTsReset] = useState(0);
  const attempt = useRef<{ fp: string; key: string } | null>(null);

  const items = lines.map((l) => ({ itemId: l.id, quantity: l.qty, optionIds: l.optionIds }));
  const pc = orderType === "delivery" ? parsePostcode(postcode) : null;
  const canQuote = items.length > 0 && (orderType === "collection" || pc !== null);
  // The exact JSON sent to /api/quote, doubling as the cache key for its answer.
  const reqKey = JSON.stringify({ items, orderType, paymentMethod: payment, postcode: pc?.formatted, promoCode: promo || undefined });
  const [quote, setQuote] = useState<{ key: string; out: QuoteOut } | null>(null);

  useEffect(() => {
    if (!canQuote) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: reqKey, signal: ctrl.signal });
        const out = (await res.json()) as QuoteOut;
        if (!("errors" in out) && !("ok" in out)) return;
        setQuote({ key: reqKey, out });
        const bad = !out.ok && out.errors.find((e) => e.code.startsWith("PROMO_"));
        if (bad) {
          setPromoMsg(bad.message);
          setPromo(""); // drop the rejected code; the next quote shows the order without it
        }
      } catch {
        /* aborted or offline: the previous quote simply stays stale */
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [reqKey, canQuote]);

  const current = quote && quote.key === reqKey ? quote.out : null;
  const loading = canQuote && !current;
  const ok = current?.ok ? current : null;
  const zone = current?.zone ?? null;
  const errors = current && !current.ok ? current.errors.filter((e) => !e.code.startsWith("PROMO_")) : [];
  const closed = current && !current.open ? (current.closedMessage ?? "We are closed right now.") : null;
  // The quote returns one priced line per basket line, in the same order.
  const lineTotal = (index: number, qty: number, price: number) => ok?.lines[index]?.lineTotal ?? qty * price;

  const needsToken = !!turnstileKey && !token;
  const canSubmit = hydrated && ok !== null && !closed && !submitting && !needsToken;

  // R11.8: begin_checkout once, when the first price comes back; promo_applied when an offer starts applying.
  const began = useRef(false);
  const lastPromo = useRef<string | null>(null);
  useEffect(() => {
    if (!ok) return;
    if (!began.current) {
      began.current = true;
      track(beginCheckoutEvent(ok.total));
    }
    const name = ok.appliedOffer?.name ?? null;
    if (name && name !== lastPromo.current) track(promoAppliedEvent(name));
    lastPromo.current = name;
  }, [ok]);

  const onToken = useCallback((t: string | null) => setToken(t), []);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setBanner("");
    setFieldErrors({});

    const details = {
      name: form.name,
      phone: form.phone,
      email: form.email,
      ...(orderType === "delivery" ? { address: form.address, postcode } : {}),
      note: note || undefined,
    };
    // One idempotency key per distinct order (R13.7): retries and double taps of
    // the same order reuse it; changing anything creates a fresh one.
    const fp = JSON.stringify([reqKey, details]);
    if (attempt.current?.fp !== fp) attempt.current = { fp, key: crypto.randomUUID() };

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: attempt.current.key,
          items,
          orderType,
          paymentMethod: payment,
          ...details,
          promoCode: promo || undefined,
          turnstileToken: token ?? undefined,
        }),
      });
      const out = await res.json();
      if (out.ok) {
        if (out.checkoutUrl) window.location.assign(out.checkoutUrl); // Stripe; keep the button disabled while leaving
        else router.push(`/order/${out.token}`);
        return;
      }
      if (out.code === "VALIDATION") {
        setFieldErrors(out.fields ?? {});
        setBanner("Please check the highlighted details.");
      } else {
        setBanner(out.message ?? "Something went wrong. Please try again.");
      }
    } catch {
      setBanner("We couldn’t reach the server. Check your connection and try again.");
    }
    setToken(null);
    setTsReset((n) => n + 1); // Turnstile tokens are single-use
    setSubmitting(false);
  }

  if (hydrated && lines.length === 0) {
    return (
      <div className="text-center">
        <p className="text-muted">Your basket is empty.</p>
        <p className="mt-6"><Link href="/menu" className="btn btn-primary">Back to the menu</Link></p>
      </div>
    );
  }

  const fieldErr = (k: string) =>
    fieldErrors[k] ? (
      <p id={`${k}-err`} className="mt-1 text-sm text-red-400">{fieldErrors[k]}</p>
    ) : null;
  const aria = (k: string) => ({ "aria-invalid": fieldErrors[k] ? true : undefined, "aria-describedby": fieldErrors[k] ? `${k}-err` : undefined });

  return (
    <form onSubmit={submit} className="space-y-8">
      {cancelled && (
        <p role="status" className="rounded-lg border border-line bg-surface p-3">
          Payment cancelled. Your basket is still here, so you can try again.
        </p>
      )}
      {closed && (
        <p role="alert" className="rounded-lg border border-brand p-3 font-bold">{closed}</p>
      )}

      <section aria-labelledby="basket-h">
        <h2 id="basket-h" className="font-display text-2xl">Your basket</h2>
        <ul className="mt-2 divide-y divide-line border-y border-line">
          {lines.map((l, i) => {
            const label = l.optionNames.length ? `${l.name} (${l.optionNames.join(", ")})` : l.name;
            return (
            <li key={l.key} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate font-bold">{l.name}</p>
                {l.optionNames.length > 0 && <p className="text-sm">{l.optionNames.join(", ")}</p>}
                <p className="text-sm text-muted">{formatPenceExact(lineTotal(i, l.qty, l.price))}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`Quantity of ${label}`}>
                <button type="button" className="btn btn-ghost !min-h-[44px] !min-w-[44px] !px-0" onClick={() => setQty(l.key, l.qty - 1)} aria-label={l.qty === 1 ? `Remove ${label}` : `One fewer ${label}`}>
                  {l.qty === 1 ? "✕" : "−"}
                </button>
                <span className="w-8 text-center" aria-live="polite">{l.qty}</span>
                <button type="button" className="btn btn-ghost !min-h-[44px] !min-w-[44px] !px-0" onClick={() => setQty(l.key, l.qty + 1)} aria-label={`One more ${label}`}>+</button>
              </div>
            </li>
            );
          })}
        </ul>
      </section>

      <fieldset>
        <legend className="font-display text-2xl">Delivery or collection</legend>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {(["collection", "delivery"] as const).map((t) => (
            <label key={t} className={`flex min-h-[48px] cursor-pointer items-center justify-center rounded-lg border px-3 font-bold ${orderType === t ? "border-brand bg-surface text-brand" : "border-line"}`}>
              <input type="radio" name="orderType" value={t} checked={orderType === t} onChange={() => setOrderType(t)} className="sr-only" />
              {t === "delivery" ? "Delivery" : "Collection"}
            </label>
          ))}
        </div>
        {orderType === "collection" && <p className="mt-2 text-sm text-muted">Collect from {contact.street}, {contact.postcode}.</p>}
        {orderType === "delivery" && (
          <div className="mt-3">
            <label htmlFor="postcode" className="font-bold">Postcode</label>
            <input id="postcode" name="postcode" className={input} autoComplete="postal-code" autoCapitalize="characters" value={postcode} onChange={(e) => setPostcode(e.target.value)} required {...aria("postcode")} />
            {fieldErr("postcode")}
            {zone && (
              <p className="mt-2 text-sm" role="status">
                Delivery {formatPenceExact(zone.fee)} · minimum order {formatPenceExact(zone.minOrder)} · about {zone.estimatedMinutes} minutes
              </p>
            )}
            {postcode.trim() !== "" && !pc && <p className="mt-2 text-sm text-muted">Enter a full UK postcode, for example LU4 8NU.</p>}
          </div>
        )}
      </fieldset>

      <section aria-labelledby="details-h" className="space-y-4">
        <h2 id="details-h" className="font-display text-2xl">Your details</h2>
        <div>
          <label htmlFor="name" className="font-bold">Name</label>
          <input id="name" name="name" className={input} autoComplete="name" value={form.name} onChange={set("name")} required maxLength={80} {...aria("name")} />
          {fieldErr("name")}
        </div>
        <div>
          <label htmlFor="phone" className="font-bold">UK mobile number</label>
          <input id="phone" name="phone" type="tel" inputMode="tel" className={input} autoComplete="tel" value={form.phone} onChange={set("phone")} required {...aria("phone")} />
          {fieldErr("phone")}
        </div>
        <div>
          <label htmlFor="email" className="font-bold">Email</label>
          <input id="email" name="email" type="email" inputMode="email" className={input} autoComplete="email" value={form.email} onChange={set("email")} required {...aria("email")} />
          <p className="mt-1 text-sm text-muted">We email your order confirmation here.</p>
          {fieldErr("email")}
        </div>
        {orderType === "delivery" && (
          <div>
            <label htmlFor="address" className="font-bold">Delivery address</label>
            <input id="address" name="address" className={input} autoComplete="street-address" value={form.address} onChange={set("address")} required maxLength={200} {...aria("address")} />
            {fieldErr("address")}
          </div>
        )}
        <div>
          <label htmlFor="note" className="font-bold">Note for the kitchen (optional)</label>
          <input id="note" name="note" className={input} value={note} maxLength={MAX_NOTE} onChange={(e) => setNote(e.target.value)} {...aria("note")} />
          <p className="mt-1 text-sm text-muted">
            Allergies or intolerances? Tell us here and check the <Link href="/allergens" className="underline">allergen information</Link>; call {phoneDisplay(contact.phone)} if you are unsure.
          </p>
          {fieldErr("note")}
        </div>
      </section>

      <section aria-labelledby="promo-h">
        <h2 id="promo-h" className="font-display text-2xl">Promo code</h2>
        <div className="mt-2 flex gap-2">
          <input aria-label="Promo code" name="promo" className={`${input} uppercase`} autoComplete="off" autoCapitalize="characters" value={promoInput} onChange={(e) => { setPromoInput(e.target.value); setPromoMsg(""); }} maxLength={40} />
          <button type="button" className="btn btn-ghost shrink-0" disabled={!promoInput.trim()} onClick={() => { setPromo(promoInput.trim()); setPromoMsg(""); }}>Apply</button>
        </div>
        <p className="mt-1 min-h-5 text-sm" role="status">
          {promoMsg ? <span className="text-red-400">{promoMsg}</span> : ok?.appliedOffer ? <span className="text-green-400">Offer applied: {ok.appliedOffer.name}</span> : null}
        </p>
      </section>

      <fieldset>
        <legend className="font-display text-2xl">Payment</legend>
        <div className="mt-2 space-y-2">
          <label className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg border px-3 ${payment === "card" ? "border-brand bg-surface" : "border-line"}`}>
            <input type="radio" name="payment" value="card" checked={payment === "card"} onChange={() => setPayment("card")} />
            <span><strong>Pay online</strong><span className="block text-sm text-muted">Card, Apple Pay, Google Pay or bank payment through Stripe</span></span>
          </label>
          <label className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg border px-3 ${payment === "cash" ? "border-brand bg-surface" : "border-line"}`}>
            <input type="radio" name="payment" value="cash" checked={payment === "cash"} onChange={() => setPayment("cash")} />
            <span><strong>Cash on {orderType === "delivery" ? "delivery" : "collection"}</strong></span>
          </label>
        </div>
      </fieldset>

      <section aria-labelledby="total-h" aria-live="polite">
        <h2 id="total-h" className="sr-only">Order total</h2>
        {errors.length > 0 && (
          <ul role="alert" className="mb-3 space-y-1 rounded-lg border border-red-400 p-3 text-red-400">
            {errors.map((e, n) => <li key={n}>{e.message}</li>)}
          </ul>
        )}
        {!canQuote && orderType === "delivery" && <p className="text-muted">Enter your postcode to see delivery cost and your total.</p>}
        {loading && canQuote && <p className="text-muted">Working out your total…</p>}
        {ok && (
          <dl className="space-y-1">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatPenceExact(ok.subtotal)}</dd></div>
            {ok.deliveryFee > 0 && <div className="flex justify-between"><dt>Delivery</dt><dd>{formatPenceExact(ok.deliveryFee)}</dd></div>}
            {ok.discount > 0 && <div className="flex justify-between"><dt>Offer</dt><dd>-{formatPenceExact(ok.discount)}</dd></div>}
            <div className="flex justify-between text-xl font-bold"><dt>Total</dt><dd>{formatPenceExact(ok.total)}</dd></div>
            {ok.estimatedMinutes && <p className="text-sm text-muted">Estimated {ok.estimatedMinutes} minutes</p>}
          </dl>
        )}
      </section>

      {turnstileKey && <Turnstile siteKey={turnstileKey} onToken={onToken} resetKey={tsReset} />}

      {banner && <p role="alert" className="rounded-lg border border-red-400 p-3 text-red-400">{banner}</p>}

      <button type="submit" className="btn btn-primary w-full" disabled={!canSubmit}>
        {submitting ? "Placing your order…" : closed ? (current?.closedLabel ?? "Closed") : ok ? (payment === "card" ? `Pay ${formatPenceExact(ok.total)}` : `Place order · ${formatPenceExact(ok.total)}`) : "Place order"}
      </button>
      <p className="text-center text-sm text-muted">
        By ordering you agree to our <Link href="/terms" className="underline">terms</Link> and <Link href="/privacy" className="underline">privacy policy</Link>.
      </p>
    </form>
  );
}
