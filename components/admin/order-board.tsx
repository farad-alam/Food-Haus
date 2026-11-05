"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatPenceExact } from "@/lib/money";
import type { BoardOrder } from "@/lib/admin/orders";

// Live order board (R9.3-R9.6, R13.10). Polls every 3 s; a new order rings and
// flashes until it is accepted or rejected. If the server cannot be reached for
// 15 s a red bar says so, because a silent board means missed orders.

type Feed = { active: BoardOrder[]; recent: BoardOrder[]; defaultPrepMinutes: number; paused: boolean; pausedMessage: string | null; canPause: boolean };
const POLL_MS = 3000;
const LOST_AFTER_MS = 15_000;
const PREP_PRESETS = [10, 15, 20, 25, 30, 40, 50, 60];
const REJECT_PRESETS = ["We are too busy right now", "We have run out of an item", "We are closing soon"];
const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
const mapsUrl = (o: BoardOrder) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.address ?? ""} ${o.postcode ?? ""}`)}`;

function beep(ctx: AudioContext) {
  // Three loud pulses. Generated, so there is no audio file to load or block.
  for (let i = 0; i < 3; i++) {
    const t = ctx.currentTime + i * 0.28;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.25);
  }
}

export function OrderBoard() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [signedOut, setSignedOut] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [mountedAt] = useState(() => Date.now());
  const audio = useRef<AudioContext | null>(null);
  const wake = useRef<WakeLockSentinel | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/orders", { cache: "no-store" });
      if (res.status === 401) return setSignedOut(true);
      if (!res.ok) return;
      const data = await res.json();
      setFeed({ active: data.active, recent: data.recent, defaultPrepMinutes: data.defaultPrepMinutes, paused: data.paused, pausedMessage: data.pausedMessage, canPause: data.canPause });
      setLastOk(Date.now());
      setSignedOut(false);
    } catch {
      /* offline: the connection bar appears after 15 s without a success */
    }
  }, []);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await refreshRef.current();
      if (!stop) timer = setTimeout(loop, POLL_MS);
    };
    void loop();
    const clockTimer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop = true;
      clearTimeout(timer);
      clearInterval(clockTimer);
    };
  }, []);

  const newOrders = feed?.active.filter((o) => o.status === "received") ?? [];
  const newCount = newOrders.length;

  // Ring every 4 s while any order is waiting to be accepted.
  useEffect(() => {
    if (!soundOn || newCount === 0 || !audio.current) return;
    const ctx = audio.current;
    beep(ctx);
    const id = setInterval(() => beep(ctx), 4000);
    return () => clearInterval(id);
  }, [soundOn, newCount]);

  useEffect(() => {
    document.title = newCount > 0 ? `(${newCount}) NEW ORDER | Food Haus admin` : "Order board | Food Haus admin";
  }, [newCount]);

  // R9.6: keep the screen awake while the board is open; re-acquire after the tab was hidden.
  useEffect(() => {
    if (!soundOn) return;
    const acquire = async () => {
      try {
        if (document.visibilityState === "visible" && !wake.current) {
          wake.current = (await navigator.wakeLock?.request("screen")) ?? null;
          wake.current?.addEventListener("release", () => (wake.current = null));
        }
      } catch {
        /* not supported or refused: the board still works */
      }
    };
    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      document.removeEventListener("visibilitychange", acquire);
      void wake.current?.release();
      wake.current = null;
    };
  }, [soundOn]);

  function startTaking() {
    // Browsers block sound until a tap, so this button is what unlocks it (R9.3).
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audio.current ??= new Ctx();
    void audio.current.resume();
    beep(audio.current);
    setSoundOn(true);
  }

  async function act(o: BoardOrder, body: { action: string; prepMinutes?: number; reason?: string }) {
    if (busyId !== null) return;
    setBusyId(o.id);
    setMessage("");
    try {
      const res = await fetch(`/api/admin/orders/${o.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json();
      if (res.status === 401) setSignedOut(true);
      else if (!out.ok) setMessage(out.message ?? "That did not work. Please try again.");
      else if (out.refundNeeded) setMessage(`Order ${o.number} was paid online. Refund it in the Stripe Dashboard.`);
    } catch {
      setMessage("No connection. That change was not saved.");
    }
    setBusyId(null);
    await refresh();
  }

  const lost = (lastOk ?? mountedAt) < now - LOST_AFTER_MS;
  const groups: { key: string; title: string; orders: BoardOrder[] }[] = [
    { key: "received", title: "New", orders: feed?.active.filter((o) => o.status === "received") ?? [] },
    { key: "preparing", title: "Preparing", orders: feed?.active.filter((o) => o.status === "preparing") ?? [] },
    { key: "ready", title: "Ready", orders: feed?.active.filter((o) => o.status === "ready") ?? [] },
    { key: "out_for_delivery", title: "Out for delivery", orders: feed?.active.filter((o) => o.status === "out_for_delivery") ?? [] },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      {(lost || signedOut) && (
        <div role="alert" className="sticky top-[61px] z-20 -mx-4 bg-red-600 px-4 py-3 text-center text-lg font-bold text-white">
          {signedOut ? (
            <>You have been signed out, so orders may be missed. <Link href="/admin/login" className="underline">Sign in again</Link></>
          ) : (
            "No connection, orders may be missed"
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 py-4">
        <h1 className="font-display text-4xl">Order board</h1>
        {soundOn ? (
          <p className="rounded-lg border border-line px-3 py-2 text-sm text-green-400" role="status">Sound on · screen kept awake</p>
        ) : (
          <button type="button" className="btn btn-primary !min-h-[56px] text-lg" onClick={startTaking}>Start taking orders</button>
        )}
      </div>
      {feed !== null && feed.canPause && <PauseControl paused={feed.paused} message={feed.pausedMessage} onChanged={refresh} />}
      {feed !== null && !feed.canPause && feed.paused && (
        <p role="status" className="mb-4 rounded-lg border-2 border-yellow-400 p-3 font-bold text-yellow-400">Orders are paused. Customers cannot order. Ask the manager to resume.</p>
      )}
      {!soundOn && newCount > 0 && <p role="alert" className="mb-3 rounded-lg border border-brand p-3 font-bold">Sound is off. Tap “Start taking orders” to hear new orders.</p>}
      {message && <p role="alert" className="mb-3 rounded-lg border border-brand bg-surface p-3 font-bold">{message}</p>}

      {feed === null && <p className="text-muted" role="status">Loading orders…</p>}
      {feed !== null && feed.active.length === 0 && <p className="rounded-lg border border-line bg-surface p-6 text-center text-muted">No orders right now. New orders appear here automatically.</p>}

      {groups.map((g) =>
        g.orders.length === 0 ? null : (
          <section key={g.key} aria-labelledby={`h-${g.key}`} className="mb-8">
            <h2 id={`h-${g.key}`} className="font-display text-2xl">{g.title} <span className="text-brand">({g.orders.length})</span></h2>
            <ul className="mt-2 grid gap-4 md:grid-cols-2">
              {g.orders.map((o) => (
                <li key={o.id}><OrderCard o={o} now={now} busy={busyId === o.id} disabled={busyId !== null} defaultPrep={feed!.defaultPrepMinutes} onAct={act} /></li>
              ))}
            </ul>
          </section>
        ),
      )}

      {feed !== null && feed.recent.length > 0 && (
        <details className="mt-6 rounded-lg border border-line p-3">
          <summary className="cursor-pointer font-bold">Finished in the last 3 hours ({feed.recent.length})</summary>
          <ul className="mt-2 divide-y divide-line text-sm">
            {feed.recent.map((o) => (
              <li key={o.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span><strong>#{o.number}</strong> · {o.customerName} · {o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</span>
                <span className="text-muted">{o.status.replace(/_/g, " ")}{o.rejectionReason ? `: ${o.rejectionReason}` : ""}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function PauseControl({ paused, message, onChanged }: { paused: boolean; message: string | null; onChanged: () => void }) {
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function put(body: { paused: boolean; message?: string }) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/settings/pause", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json();
      if (!out.ok) setError(out.message ?? "That did not work. Please try again.");
      else {
        setAsking(false);
        setText("");
        onChanged();
      }
    } catch {
      setError("No connection. That change was not saved.");
    }
    setBusy(false);
  }

  return (
    <div className="mb-4">
      {paused ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-yellow-400 p-3">
          <p className="font-bold text-yellow-400">ORDERS ARE PAUSED{message ? `: “${message}”` : ""}. Customers cannot order.</p>
          <button type="button" className="btn btn-primary !min-h-[56px]" disabled={busy} onClick={() => put({ paused: false })}>Resume orders</button>
        </div>
      ) : asking ? (
        <div className="space-y-2 rounded-lg border border-line p-3">
          <label htmlFor="pause-msg" className="font-bold">Message for customers (optional)</label>
          <input id="pause-msg" className="min-h-[52px] w-full rounded-lg border border-line bg-surface-2 px-3 text-base text-text" value={text} maxLength={200} placeholder="We are very busy, back at 8pm" onChange={(e) => setText(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-ghost !min-h-[56px]" onClick={() => setAsking(false)}>Cancel</button>
            <button type="button" className="btn btn-primary !min-h-[56px]" disabled={busy} onClick={() => put({ paused: true, message: text })}>Pause orders</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost !min-h-[48px]" onClick={() => setAsking(true)}>Pause orders…</button>
      )}
      {error && <p role="alert" className="mt-2 text-red-400">{error}</p>}
    </div>
  );
}

function OrderCard({
  o, now, busy, disabled, defaultPrep, onAct,
}: {
  o: BoardOrder; now: number; busy: boolean; disabled: boolean; defaultPrep: number;
  onAct: (o: BoardOrder, body: { action: string; prepMinutes?: number; reason?: string }) => void;
}) {
  const [prep, setPrep] = useState(defaultPrep);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const age = Math.max(0, Math.floor((now - new Date(o.createdAt).getTime()) / 60_000));
  const isNew = o.status === "received";
  const btn = "btn !min-h-[60px] w-full text-lg";

  return (
    <article aria-label={`Order ${o.number}`} className={`rounded-xl border border-line bg-surface p-4 ${isNew ? "flash-card" : ""}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-display text-4xl leading-none">#{o.number}</p>
          <p className="text-sm text-muted">{clock.format(new Date(o.createdAt))} · {age} min ago</p>
        </div>
        <div className="flex flex-col items-end gap-1 text-sm font-bold">
          <span className="rounded bg-ink px-2 py-1 uppercase">{o.type}</span>
          {o.paymentMethod === "cash" ? (
            <span className="rounded bg-yellow-400 px-2 py-1 text-black">CASH {formatPenceExact(o.total)}</span>
          ) : (
            <span className="rounded bg-green-500 px-2 py-1 text-black">PAID online</span>
          )}
        </div>
      </header>

      <ul className="mt-3 space-y-1 text-lg">
        {o.items.map((i, n) => (
          <li key={n}>
            <strong>{i.quantity} ×</strong> {i.name}
            {i.options.length > 0 && <span className="block pl-6 text-base text-muted">{i.options.map((x) => x.name).join(", ")}</span>}
          </li>
        ))}
      </ul>
      {o.note && <p className="mt-2 rounded bg-yellow-400 p-2 font-bold text-black">NOTE: {o.note}</p>}

      <div className="mt-3 text-base">
        <p className="font-bold">{o.customerName}</p>
        <a href={`tel:${o.phone}`} className="inline-flex min-h-[44px] items-center underline">{o.phone}</a>
        {o.type === "delivery" && (
          <p>
            {o.address}, {o.postcode}{" "}
            <a href={mapsUrl(o)} target="_blank" rel="noopener noreferrer" className="underline">Map</a>
          </p>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {isNew && !rejecting && (
          <>
            <label className="block text-sm text-muted" htmlFor={`prep-${o.id}`}>Ready in</label>
            <select id={`prep-${o.id}`} value={prep} onChange={(e) => setPrep(Number(e.target.value))} className="min-h-[52px] w-full rounded-lg border border-line bg-surface-2 px-3 text-lg text-text">
              {[...new Set([defaultPrep, ...PREP_PRESETS])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
            <button type="button" className={`${btn} btn-primary`} disabled={disabled} onClick={() => onAct(o, { action: "accept", prepMinutes: prep })}>{busy ? "Saving…" : "Accept order"}</button>
            <button type="button" className={`${btn} btn-ghost`} disabled={disabled} onClick={() => setRejecting(true)}>Reject…</button>
          </>
        )}
        {rejecting && (
          <div className="space-y-2">
            <p className="font-bold">Tell the customer why (they will see this):</p>
            {REJECT_PRESETS.map((r) => (
              <button key={r} type="button" className="btn btn-ghost !min-h-[52px] w-full" onClick={() => setReason(r)}>{r}</button>
            ))}
            <input aria-label="Reason" className="min-h-[52px] w-full rounded-lg border border-line bg-surface-2 px-3 text-base text-text" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Or type a reason" />
            {o.paymentMethod === "card" && o.paymentStatus === "paid" && <p className="text-sm text-yellow-400">This order was paid online. You will need to refund it in the Stripe Dashboard.</p>}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-ghost !min-h-[56px]" onClick={() => setRejecting(false)}>Back</button>
              <button type="button" className="btn btn-primary !min-h-[56px]" disabled={disabled || !reason.trim()} onClick={() => onAct(o, { action: "reject", reason })}>Reject order</button>
            </div>
          </div>
        )}
        {o.status === "preparing" && (
          <>
            {o.prepMinutes && <p className="text-sm text-muted">Promised in about {o.prepMinutes} minutes</p>}
            <button type="button" className={`${btn} btn-primary`} disabled={disabled} onClick={() => onAct(o, { action: "ready" })}>{busy ? "Saving…" : "Ready"}</button>
            <button type="button" className="btn btn-ghost !min-h-[44px] w-full text-sm" disabled={disabled} onClick={() => setRejecting(true)}>Cancel this order…</button>
          </>
        )}
        {o.status === "ready" && (
          <button type="button" className={`${btn} btn-primary`} disabled={disabled} onClick={() => onAct(o, { action: o.type === "delivery" ? "out_for_delivery" : "completed" })}>
            {busy ? "Saving…" : o.type === "delivery" ? "Out for delivery" : "Collected"}
          </button>
        )}
        {o.status === "out_for_delivery" && (
          <button type="button" className={`${btn} btn-primary`} disabled={disabled} onClick={() => onAct(o, { action: "completed" })}>{busy ? "Saving…" : "Delivered"}</button>
        )}
      </div>
    </article>
  );
}
