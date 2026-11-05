"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { formatPenceExact } from "@/lib/money";
import type { HistoryRow } from "@/lib/admin/history";
import { api, failMessage, field, Msg } from "./ui";
import { paymentText, StatusBadge } from "./status-badge";

// Order history (R9.11): filters live in the URL, so a search can be reloaded,
// bookmarked or shared with a colleague, and Back works.

type Result = { rows: HistoryRow[]; total: number; sales: { orders: number; revenue: number }; page: number; pageSize: number };
const STATUS_OPTIONS = [
  ["", "Any status"], ["pending_payment", "Awaiting payment"], ["received", "Received"], ["preparing", "Preparing"], ["ready", "Ready"],
  ["out_for_delivery", "Out for delivery"], ["completed", "Completed"], ["rejected", "Rejected"], ["cancelled", "Cancelled"], ["refunded", "Refunded"],
] as const;
const ukDate = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(ms)); // YYYY-MM-DD
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const DAY = 86_400_000;

export function HistoryView({ canExport }: { canExport: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const qs = params.toString();
  const [result, setResult] = useState<{ qs: string; data: Result } | null>(null);
  const [error, setError] = useState<{ qs: string; text: string } | null>(null);
  const [exportMsg, setExportMsg] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const o = await api("GET", `/api/admin/history?${qs}`);
      if (cancelled) return;
      if (o.ok) setResult({ qs, data: o.data as unknown as Result });
      else setError({ qs, text: failMessage(o) });
    })();
    return () => {
      cancelled = true;
    };
  }, [qs]);

  const go = (next: URLSearchParams) => router.push(`/admin/history?${next.toString()}`);
  const withoutPage = () => {
    const p = new URLSearchParams(params.toString());
    p.delete("page");
    return p;
  };

  async function download() {
    setExporting(true);
    setExportMsg("");
    try {
      const res = await fetch(`/api/admin/history/export?${withoutPage().toString()}`);
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        setExportMsg(res.status === 401 ? "You have been signed out. Sign in again." : (out.message ?? "The export did not work. Please try again."));
      } else {
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "food-haus-orders.csv";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
      }
    } catch {
      setExportMsg("No connection. The export was not downloaded.");
    }
    setExporting(false);
  }

  const current = result && result.qs === qs ? result.data : null;
  const failed = error && error.qs === qs ? error.text : "";
  const page = Number(params.get("page") ?? 1) || 1;

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 pb-20 pt-6">
      <h1 className="font-display text-4xl">Order history</h1>
      <Filters key={qs} initial={params} onApply={go} />

      {failed && <p role="alert" className="rounded-lg border border-red-400 p-3 text-red-400">{failed}</p>}
      {!current && !failed && <p className="text-muted" role="status">Loading…</p>}

      {current && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="status">
              <strong>{current.total.toLocaleString("en-GB")}</strong> order{current.total === 1 ? "" : "s"}
              {current.total > 0 && <span className="text-muted"> · {current.sales.orders.toLocaleString("en-GB")} accepted, worth {formatPenceExact(current.sales.revenue)}</span>}
            </p>
            {canExport && current.total > 0 && (
              <button type="button" className="btn btn-ghost !min-h-[44px] text-sm" disabled={exporting} onClick={download}>{exporting ? "Preparing…" : "Download CSV"}</button>
            )}
          </div>
          <Msg text={exportMsg} />

          {current.rows.length === 0 ? (
            <p className="rounded-lg border border-line p-6 text-center text-muted">No orders match. Try wider dates or clear the filters.</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {current.rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/admin/history/${r.number}`} className="block p-3 no-underline hover:bg-surface">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-display text-2xl">#{r.number}</span>
                      <span className="font-bold">{formatPenceExact(r.total)}</span>
                    </div>
                    <p className="text-sm text-muted">{when(r.createdAt)} · {r.customerName} · {r.type === "delivery" ? "Delivery" : "Collection"} · {paymentText(r.paymentMethod, r.paymentStatus)}</p>
                    <p className="mt-1"><StatusBadge status={r.status} /></p>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {current.total > current.pageSize && (
            <nav aria-label="Pages" className="flex items-center justify-between gap-3">
              <button type="button" className="btn btn-ghost !min-h-[44px]" disabled={page <= 1} onClick={() => { const p = new URLSearchParams(params.toString()); p.set("page", String(page - 1)); go(p); }}>← Newer</button>
              <span className="text-sm text-muted">Page {page} of {Math.ceil(current.total / current.pageSize)}</span>
              <button type="button" className="btn btn-ghost !min-h-[44px]" disabled={page * current.pageSize >= current.total} onClick={() => { const p = new URLSearchParams(params.toString()); p.set("page", String(page + 1)); go(p); }}>Older →</button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function Filters({ initial, onApply }: { initial: URLSearchParams; onApply: (p: URLSearchParams) => void }) {
  const [v, setV] = useState({
    from: initial.get("from") ?? "", to: initial.get("to") ?? "", status: initial.get("status") ?? "", payment: initial.get("payment") ?? "", type: initial.get("type") ?? "", q: initial.get("q") ?? "",
  });
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const apply = (over: Partial<typeof v> = {}) => {
    const next = { ...v, ...over };
    const p = new URLSearchParams();
    for (const [k, val] of Object.entries(next)) if (val.trim() !== "") p.set(k, val.trim());
    onApply(p);
  };
  const preset = (fromDaysAgo: number, toDaysAgo: number) => apply({ from: ukDate(Date.now() - fromDaysAgo * DAY), to: ukDate(Date.now() - toDaysAgo * DAY) });
  const pill = "btn btn-ghost !min-h-[40px] !px-3 text-sm";

  return (
    <form onSubmit={(e) => { e.preventDefault(); apply(); }} className="space-y-3 rounded-xl border border-line p-3" aria-label="Filters">
      <label className="block font-bold">Search
        <input type="search" className={`${field} mt-1 block w-full font-normal`} value={v.q} maxLength={80} placeholder="Order number, name, phone, email or postcode" onChange={(e) => set({ q: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="block text-sm text-muted">From<input type="date" className={`${field} mt-1 block w-full`} value={v.from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label className="block text-sm text-muted">To<input type="date" className={`${field} mt-1 block w-full`} value={v.to} onChange={(e) => set({ to: e.target.value })} /></label>
        <label className="col-span-2 block text-sm text-muted sm:col-span-1">Status
          <select className={`${field} mt-1 block w-full`} value={v.status} onChange={(e) => set({ status: e.target.value })}>{STATUS_OPTIONS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
        </label>
        <label className="block text-sm text-muted">Payment
          <select className={`${field} mt-1 block w-full`} value={v.payment} onChange={(e) => set({ payment: e.target.value })}><option value="">Card or cash</option><option value="card">Card</option><option value="cash">Cash</option></select>
        </label>
        <label className="block text-sm text-muted">Type
          <select className={`${field} mt-1 block w-full`} value={v.type} onChange={(e) => set({ type: e.target.value })}><option value="">Delivery or collection</option><option value="delivery">Delivery</option><option value="collection">Collection</option></select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary !min-h-[44px]">Search</button>
        <button type="button" className={pill} onClick={() => preset(0, 0)}>Today</button>
        <button type="button" className={pill} onClick={() => preset(1, 1)}>Yesterday</button>
        <button type="button" className={pill} onClick={() => preset(6, 0)}>Last 7 days</button>
        <button type="button" className={pill} onClick={() => preset(29, 0)}>Last 30 days</button>
        <button type="button" className={pill} onClick={() => onApply(new URLSearchParams())}>Clear</button>
      </div>
    </form>
  );
}
