"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatPenceExact } from "@/lib/money";
import type { Dashboard } from "@/lib/admin/dashboard";
import { api, failMessage } from "./ui";

// Today so far and the last 7 trading days (R9.12). The same numbers as the
// daily sales email. Refreshes every 30 seconds.

const dayLabel = (d: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${d}T12:00:00Z`));

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <p className="text-sm text-muted">{label}</p>
      <p className="font-display text-4xl leading-tight">{value}</p>
      {sub && <p className="text-sm text-muted">{sub}</p>}
    </div>
  );
}

export function DashboardView() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const o = await api("GET", "/api/admin/dashboard");
      if (stop) return;
      if (o.ok) {
        setData(o.data as unknown as Dashboard);
        setError("");
      } else setError(failMessage(o));
      timer = setTimeout(load, 30_000);
    };
    void load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  if (!data) return error ? <p role="alert" className="p-4 text-red-400">{error} <Link href="/admin/login" className="underline">Sign in</Link></p> : <p className="p-4 text-muted" role="status">Loading…</p>;
  const t = data.today.totals;
  const max = Math.max(1, ...data.days.map((d) => d.revenue));

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 pb-20 pt-6">
      <div>
        <h1 className="font-display text-4xl">Reports</h1>
        <p className="text-sm text-muted">The same figures as the daily sales email. A “day” runs from opening to closing, so a late-night shift counts as the day it started.</p>
        {error && <p role="alert" className="mt-2 text-red-400">Could not refresh: {error}</p>}
      </div>

      <section aria-labelledby="today-h">
        <h2 id="today-h" className="font-display text-3xl">Today so far <span className="text-lg text-muted">· {dayLabel(data.today.day)}</span></h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Orders" value={String(t.orders)} />
          <Stat label="Revenue" value={formatPenceExact(t.revenue)} />
          <Stat label="Average order" value={t.orders ? formatPenceExact(t.average) : "–"} />
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {([
            ["Paid online (card)", `${t.card.orders} · ${formatPenceExact(t.card.revenue)}`],
            ["Cash", `${t.cash.orders} · ${formatPenceExact(t.cash.revenue)}`],
            ["Delivery", `${t.delivery.orders} · ${formatPenceExact(t.delivery.revenue)}`],
            ["Collection", `${t.collection.orders} · ${formatPenceExact(t.collection.revenue)}`],
            ["Discounts given", formatPenceExact(t.discounts)],
            ["Delivery fees", formatPenceExact(t.deliveryFees)],
          ] as const).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-line py-1"><dt className="text-muted">{k}</dt><dd className="font-bold">{v}</dd></div>
          ))}
        </dl>
        {t.topItems.length > 0 && (
          <div className="mt-4">
            <h3 className="font-bold">Top items today</h3>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5">{t.topItems.map((i) => <li key={i.name}>{i.name}: {i.quantity} sold, {formatPenceExact(i.revenue)}</li>)}</ol>
          </div>
        )}
        {(t.rejected > 0 || t.cancelled > 0 || t.refunded.orders > 0) && (
          <p className="mt-3 text-sm text-muted">
            {[t.rejected ? `${t.rejected} rejected` : "", t.cancelled ? `${t.cancelled} unpaid card order${t.cancelled === 1 ? "" : "s"} expired` : "", t.refunded.orders ? `${t.refunded.orders} refunded (${formatPenceExact(t.refunded.revenue)})` : ""].filter(Boolean).join(" · ")} (not counted above)
          </p>
        )}
      </section>

      <section aria-labelledby="week-h">
        <h2 id="week-h" className="font-display text-3xl">Last 7 days</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Orders" value={String(data.week.orders)} />
          <Stat label="Revenue" value={formatPenceExact(data.week.revenue)} sub={`${formatPenceExact(data.week.averagePerDay)} a day`} />
          <Stat label="Best day" value={data.week.bestDay ? formatPenceExact(data.week.bestDay.revenue) : "–"} sub={data.week.bestDay ? dayLabel(data.week.bestDay.day) : undefined} />
        </div>
        <ul className="mt-4 space-y-2" aria-label="Revenue by day">
          {[...data.days].reverse().map((d) => (
            <li key={d.day} className={`rounded-lg border p-2 ${d.day === data.today.day ? "border-brand" : "border-line"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-bold">{dayLabel(d.day)}{d.day === data.today.day ? " (today)" : ""}</span>
                <span className="text-sm">{d.orders} order{d.orders === 1 ? "" : "s"} · <strong>{formatPenceExact(d.revenue)}</strong>{d.orders > 0 ? ` · avg ${formatPenceExact(d.average)}` : ""}</span>
              </div>
              <div className="mt-1 h-2 rounded bg-surface-2" role="img" aria-label={`${formatPenceExact(d.revenue)} of ${formatPenceExact(max)} best day`}>
                <div className="h-2 rounded bg-brand" style={{ width: `${Math.round((d.revenue / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p><Link href="/admin/history" className="btn btn-ghost">See order history</Link></p>
    </div>
  );
}
