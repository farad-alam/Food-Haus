"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { londonLocalToUtc, utcToLondonLocal } from "@/lib/london-time";
import { parsePounds, penceToInput } from "@/lib/money";
import { describeConditions, describeDeal, type OfferChannel, type OfferType } from "@/lib/offers";
import type { OfferView } from "@/lib/admin/offers";
import { api, failMessage, field, Msg } from "./ui";

// Offers and promo codes (R6.7, R9.8). The preview line uses the same wording
// customers see on the website. Start and end are UK time.

type Data = { offers: OfferView[]; categories: { id: number; name: string }[] };
const btn = "btn btn-ghost !min-h-[44px] !px-3 text-sm";
const STATUS: Record<OfferView["status"], { text: string; cls: string }> = {
  active: { text: "ACTIVE", cls: "bg-green-500 text-black" },
  scheduled: { text: "SCHEDULED", cls: "bg-yellow-400 text-black" },
  ended: { text: "ENDED", cls: "bg-red-500 text-white" },
  used_up: { text: "USED UP", cls: "bg-red-500 text-white" },
};

export function OffersManager() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    const o = await api("GET", "/api/admin/offers");
    if (o.ok) setData(o.data as unknown as Data);
    else setError(failMessage(o));
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const o = await api("GET", "/api/admin/offers");
      if (cancelled) return;
      if (o.ok) setData(o.data as unknown as Data);
      else setError(failMessage(o));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p role="alert" className="p-4 text-red-400">{error} <Link href="/admin/login" className="underline">Sign in</Link></p>;
  if (!data) return <p className="p-4 text-muted" role="status">Loading offers…</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 pb-20 pt-6">
      <h1 className="font-display text-4xl">Offers and promo codes</h1>
      <p className="text-sm text-muted">
        An offer with no code applies automatically to every order it fits. A promo code applies only when the customer types it. A customer gets one offer per order (the best automatic one, or the code they entered); offers never add together.
      </p>

      {data.offers.length === 0 && <p className="text-muted">No offers yet.</p>}
      <ul className="space-y-4">
        {data.offers.map((o) => (
          <OfferCard key={o.id} offer={o} categories={data.categories} reload={reload} />
        ))}
      </ul>

      {creating ? (
        <OfferEditor categories={data.categories} onDone={() => { setCreating(false); reload(); }} onCancel={() => setCreating(false)} />
      ) : (
        <button type="button" className="btn btn-primary !min-h-[52px]" onClick={() => setCreating(true)}>Add an offer</button>
      )}
    </div>
  );
}

function OfferCard({ offer: o, categories, reload }: { offer: OfferView; categories: Data["categories"]; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState("");
  const facts = {
    type: o.type, value: o.value, categoryName: o.appliesToCategory, channel: o.channel, code: o.code, minSpend: o.minSpend,
    startsAt: o.startsAt ? new Date(o.startsAt) : null, endsAt: o.endsAt ? new Date(o.endsAt) : null, usageLimit: o.usageLimit, usedCount: o.usedCount,
  };
  const st = STATUS[o.status];

  async function endNow() {
    if (!window.confirm(`End “${o.name}” now? Customers will not be able to use it.`)) return;
    setMsg("");
    const out = await api("PUT", `/api/admin/offers/${o.id}`, { ...toBody(o), endsAt: utcToLondonLocal(new Date()) });
    if (out.ok) reload();
    else setMsg(failMessage(out));
  }
  async function remove() {
    if (!window.confirm(`Delete “${o.name}”? This cannot be undone.`)) return;
    setMsg("");
    const out = await api("DELETE", `/api/admin/offers/${o.id}`);
    if (out.ok) reload();
    else setMsg(failMessage(out));
  }

  return (
    <li className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-lg font-bold">{o.name} <span className={`ml-1 rounded px-2 py-0.5 align-middle text-xs font-bold ${st.cls}`}>{st.text}</span></p>
          <p>{describeDeal(facts)}</p>
          <p className="text-sm text-muted">{describeConditions(facts).join(" · ") || "No conditions"}</p>
        </div>
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span>{o.code ? <>Code: <strong className="font-mono">{o.code}</strong></> : "Automatic (no code)"}</span>
        <span>Used {o.usedCount}{o.usageLimit != null ? ` of ${o.usageLimit}` : ""} time{o.usedCount === 1 ? "" : "s"}</span>
        <span>{o.showOnSite ? "Shown on the website" : "Not shown on the website"}</span>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={btn} aria-expanded={editing} onClick={() => setEditing((v) => !v)}>{editing ? "Close" : "Edit"}</button>
        {o.status === "active" && <button type="button" className={btn} onClick={endNow}>End now</button>}
        <button type="button" className={btn} onClick={remove}>Delete</button>
      </div>
      <Msg text={msg} />
      {editing && <div className="mt-3"><OfferEditor offer={o} categories={categories} onDone={() => { setEditing(false); reload(); }} onCancel={() => setEditing(false)} /></div>}
    </li>
  );
}

const toBody = (o: OfferView) => ({
  name: o.name, type: o.type, value: o.value, appliesToCategoryId: o.appliesToCategoryId, channel: o.channel, code: o.code,
  minSpend: o.minSpend, startsAt: o.startsAtLocal, endsAt: o.endsAtLocal, usageLimit: o.usageLimit, showOnSite: o.showOnSite,
});

type Draft = { name: string; type: OfferType; value: string; categoryId: string; channel: OfferChannel; code: string; minSpend: string; startsAt: string; endsAt: string; usageLimit: string; showOnSite: boolean };

function OfferEditor({ offer, categories, onDone, onCancel }: { offer?: OfferView; categories: Data["categories"]; onDone: () => void; onCancel: () => void }) {
  const [d, setD] = useState<Draft>({
    name: offer?.name ?? "",
    type: offer?.type ?? "percentage",
    value: offer ? (offer.type === "fixed" ? penceToInput(offer.value ?? 0) : offer.value === null ? "" : String(offer.value)) : "",
    categoryId: offer?.appliesToCategoryId ? String(offer.appliesToCategoryId) : "",
    channel: offer?.channel ?? "any",
    code: offer?.code ?? "",
    minSpend: offer && offer.minSpend > 0 ? penceToInput(offer.minSpend) : "",
    startsAt: offer?.startsAtLocal ?? "",
    endsAt: offer?.endsAtLocal ?? "",
    usageLimit: offer?.usageLimit != null ? String(offer.usageLimit) : "",
    showOnSite: offer?.showOnSite ?? true,
  });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  function body(): { body?: Record<string, unknown>; error?: string } {
    let value: number | null = null;
    if (d.type === "percentage") {
      value = Number(d.value);
      if (!Number.isInteger(value) || value < 1 || value > 100) return { error: "Enter a percentage from 1 to 100." };
    } else if (d.type === "fixed") {
      value = parsePounds(d.value);
      if (value === null || value < 1) return { error: "Enter the amount off in pounds, like 2.50." };
    }
    const minSpend = d.minSpend.trim() === "" ? 0 : parsePounds(d.minSpend);
    if (minSpend === null) return { error: "Enter the minimum spend in pounds, like 15." };
    const limit = d.usageLimit.trim() === "" ? null : Number(d.usageLimit);
    if (limit !== null && !Number.isInteger(limit)) return { error: "Enter the usage limit as a whole number, or leave it empty." };
    if (d.type === "bogof" && !d.categoryId) return { error: "Choose which category it applies to." };
    return {
      body: {
        name: d.name, type: d.type, value, appliesToCategoryId: d.type === "bogof" ? Number(d.categoryId) : null, channel: d.channel,
        code: d.code.trim() === "" ? null : d.code.trim(), minSpend, startsAt: d.startsAt || null, endsAt: d.endsAt || null, usageLimit: limit, showOnSite: d.showOnSite,
      },
    };
  }

  async function save() {
    const b = body();
    if (!b.body) return setMsg(b.error!);
    setBusy(true);
    setMsg("");
    const o = offer ? await api("PUT", `/api/admin/offers/${offer.id}`, b.body) : await api("POST", "/api/admin/offers", b.body);
    setBusy(false);
    if (o.ok) onDone();
    else setMsg(failMessage(o));
  }

  // The preview is built by the SAME functions the website uses, so it cannot drift from what customers read.
  const facts = {
    type: d.type,
    value: d.type === "fixed" ? parsePounds(d.value) : d.type === "percentage" ? Number(d.value) || null : null,
    categoryName: categories.find((c) => String(c.id) === d.categoryId)?.name ?? null,
    channel: d.channel,
    code: d.code.trim() === "" ? null : d.code.trim().toUpperCase(),
    minSpend: parsePounds(d.minSpend || "0") ?? 0,
    startsAt: d.startsAt ? londonLocalToUtc(d.startsAt) : null,
    endsAt: d.endsAt ? londonLocalToUtc(d.endsAt) : null,
    usageLimit: d.usageLimit.trim() === "" ? null : Number(d.usageLimit) || null,
    usedCount: 0,
  };

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
      <h2 className="font-bold">{offer ? `Edit ${offer.name}` : "New offer"}</h2>
      <label className="block font-bold">Name (shown to customers)<input className={`${field} mt-1 block w-full font-normal`} value={d.name} maxLength={80} placeholder="Welcome offer" onChange={(e) => set({ name: e.target.value })} /></label>

      <label className="block font-bold">What it does
        <select className={`${field} mt-1 block w-full font-normal`} value={d.type} onChange={(e) => set({ type: e.target.value as OfferType })}>
          <option value="percentage">Percentage off the order</option>
          <option value="fixed">Fixed amount off the order</option>
          <option value="free_delivery">Free delivery</option>
          <option value="bogof">Buy one get one free on a category</option>
        </select>
      </label>
      {d.type === "percentage" && <label className="block font-bold">Percent off<input inputMode="numeric" className={`${field} mt-1 block w-full font-normal`} value={d.value} placeholder="10" onChange={(e) => set({ value: e.target.value })} /></label>}
      {d.type === "fixed" && <label className="block font-bold">Amount off (£)<input inputMode="decimal" className={`${field} mt-1 block w-full font-normal`} value={d.value} placeholder="2.00" onChange={(e) => set({ value: e.target.value })} /></label>}
      {d.type === "bogof" && (
        <label className="block font-bold">Category
          <select className={`${field} mt-1 block w-full font-normal`} value={d.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
            <option value="">Choose a category…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span className="mt-1 block text-sm font-normal text-muted">The cheaper item in every pair is free.</span>
        </label>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block font-bold">Who can use it
          <select className={`${field} mt-1 block w-full font-normal`} value={d.channel} onChange={(e) => set({ channel: e.target.value as OfferChannel })}>
            <option value="any">Delivery and collection</option>
            <option value="collection">Collection only</option>
            <option value="delivery">Delivery only</option>
          </select>
        </label>
        <label className="block font-bold">Minimum spend (£, optional)<input inputMode="decimal" className={`${field} mt-1 block w-full font-normal`} value={d.minSpend} placeholder="No minimum" onChange={(e) => set({ minSpend: e.target.value })} /></label>
      </div>

      <label className="block font-bold">Promo code (optional)
        <input className={`${field} mt-1 block w-full font-mono font-normal uppercase`} value={d.code} maxLength={20} placeholder="Leave empty to apply automatically" autoCapitalize="characters" onChange={(e) => set({ code: e.target.value })} />
        <span className="mt-1 block text-sm font-normal text-muted">3 to 20 letters or numbers. Customers type it at checkout.</span>
      </label>

      <fieldset>
        <legend className="font-bold">When (UK time, optional)</legend>
        <div className="mt-1 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-muted">Starts<input type="datetime-local" className={`${field} mt-1 block w-full`} value={d.startsAt} onChange={(e) => set({ startsAt: e.target.value })} /></label>
          <label className="block text-sm text-muted">Ends<input type="datetime-local" className={`${field} mt-1 block w-full`} value={d.endsAt} onChange={(e) => set({ endsAt: e.target.value })} /></label>
        </div>
      </fieldset>

      <label className="block font-bold">Limit on total uses (optional)<input inputMode="numeric" className={`${field} mt-1 block w-full font-normal`} value={d.usageLimit} placeholder="Unlimited" onChange={(e) => set({ usageLimit: e.target.value })} /></label>

      <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={d.showOnSite} onChange={(e) => set({ showOnSite: e.target.checked })} /> Show on the home page and Offers page</label>
      {d.showOnSite && d.code.trim() !== "" && <p className="text-sm text-yellow-400">The promo code will be shown publicly. Untick this to keep it for people you give the code to.</p>}

      <p className="rounded-lg border border-line p-3 text-sm">
        <span className="text-muted">Customers will see: </span><strong>{d.name || "Your offer"}</strong> · {describeDeal(facts)}
        {describeConditions(facts).map((c) => ` · ${c}`).join("")}
      </p>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary !min-h-[48px]" disabled={busy} onClick={save}>{busy ? "Saving…" : offer ? "Save changes" : "Add offer"}</button>
        <button type="button" className={btn} onClick={onCancel}>Cancel</button>
      </div>
      <Msg text={msg} />
    </div>
  );
}
