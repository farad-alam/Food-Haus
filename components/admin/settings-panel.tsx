"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { dayName, validateWindows, type HoursWindow } from "@/lib/admin/hours-validate";
import { formatPenceExact, parsePounds, penceToInput } from "@/lib/money";
import { api, failMessage, field, Msg, Section } from "./ui";

const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];
import type { ClosureView, General, SettingsView, ZoneRow } from "@/lib/admin/settings";

// Settings (R9.9, R9.10): pause switch, opening hours, closure days, prep time
// and cash limits, delivery zones. The server re-validates everything; the
// checks here only give instant feedback.

export function SettingsPanel() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const o = await api("GET", "/api/admin/settings");
    if (o.ok) setView(o.data as unknown as SettingsView);
    else setError(failMessage(o));
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const o = await api("GET", "/api/admin/settings");
      if (cancelled) return;
      if (o.ok) setView(o.data as unknown as SettingsView);
      else setError(failMessage(o));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p role="alert" className="p-4 text-red-400">{error} <Link href="/admin/login" className="underline">Sign in</Link></p>;
  if (!view) return <p className="p-4 text-muted" role="status">Loading settings…</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 pb-20 pt-6">
      <h1 className="font-display text-4xl">Shop settings</h1>
      <StatusBanner view={view} />
      <PauseSection general={view.general} onSaved={load} />
      <HoursSection initial={view.hours} onSaved={load} />
      <ClosuresSection closures={view.closures} onChanged={load} />
      <GeneralSection general={view.general} onSaved={load} />
      <NoticeSection general={view.general} onSaved={load} />
      <ZonesSection zones={view.zones} onChanged={load} />
    </div>
  );
}

function StatusBanner({ view }: { view: SettingsView }) {
  const s = view.status;
  const text =
    s.reason === "open" ? "Open now: customers can order."
    : s.reason === "paused" ? "Paused: customers cannot order."
    : s.reason === "no_hours" ? "No opening hours are set, so customers cannot order. Add your hours below."
    : s.reason === "closure" ? "Closed today (closure day): customers cannot order."
    : "Closed right now (outside opening hours): customers cannot order.";
  return (
    <div className="space-y-2">
      <p role="status" className={`rounded-lg border-2 p-3 font-bold ${s.open ? "border-green-500 text-green-400" : "border-yellow-400 text-yellow-400"}`}>{text}</p>
      {view.zones.filter((z) => z.active).length === 0 && <p className="rounded-lg border border-line p-3 text-sm text-muted">No active delivery zones: delivery is unavailable until you add one (collection still works).</p>}
    </div>
  );
}

// ---- pause ---------------------------------------------------------------------

function PauseSection({ general, onSaved }: { general: General; onSaved: () => void }) {
  const [message, setMessage] = useState(general.pausedMessage ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function set(paused: boolean) {
    setBusy(true);
    setMsg("");
    const o = await api("PUT", "/api/admin/settings/pause", { paused, message });
    if (o.ok) onSaved();
    else setMsg(failMessage(o));
    setBusy(false);
  }
  return (
    <Section id="pause-h" title="Pause orders" hint="Stops new orders straight away. Customers see your message at checkout. Orders already placed are not affected.">
      <label htmlFor="pause-message" className="font-bold">Message for customers</label>
      <input id="pause-message" className={`${field} w-full`} value={message} maxLength={200} onChange={(e) => setMessage(e.target.value)} placeholder="We are very busy, back at 8pm" />
      <div className="mt-3">
        {general.paused ? (
          <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={busy} onClick={() => set(false)}>Resume orders</button>
        ) : (
          <button type="button" className="btn btn-ghost w-full sm:w-auto" disabled={busy} onClick={() => set(true)}>Pause orders</button>
        )}
      </div>
      <Msg text={msg} />
    </Section>
  );
}

// ---- opening hours -----------------------------------------------------------------

function HoursSection({ initial, onSaved }: { initial: HoursWindow[]; onSaved: () => void }) {
  const [windows, setWindows] = useState<HoursWindow[]>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; good?: boolean }>({ text: "" });
  const problem = validateWindows(windows);
  const patch = (i: number, p: Partial<HoursWindow>) => setWindows((ws) => ws.map((w, n) => (n === i ? { ...w, ...p } : w)));

  async function save() {
    if (problem) return setMsg({ text: problem });
    setBusy(true);
    const o = await api("PUT", "/api/admin/settings/hours", { windows });
    setMsg(o.ok ? { text: "Opening hours saved.", good: true } : { text: failMessage(o) });
    if (o.ok) onSaved();
    setBusy(false);
  }
  const copyToAll = (weekday: number) =>
    setWindows((ws) => {
      const src = ws.filter((w) => w.weekday === weekday);
      return [...ws.filter((w) => w.weekday === weekday), ...[0, 1, 2, 3, 4, 5, 6].filter((d) => d !== weekday).flatMap((d) => src.map((w) => ({ ...w, weekday: d })))];
    });

  return (
    <Section id="hours-h" title="Opening hours" hint="Customers can order only during these times (UK time). If a period ends at or before it starts, it runs past midnight into the next day.">
      <ul className="space-y-4">
        {MON_FIRST.map((d) => {
          const mine = windows.map((w, i) => ({ w, i })).filter((x) => x.w.weekday === d);
          return (
            <li key={d} className="rounded-lg border border-line p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold">{dayName(d)}</p>
                {mine.length === 0 && <span className="text-sm text-muted">Closed</span>}
              </div>
              {mine.map(({ w, i }) => (
                <div key={i} className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="text-sm text-muted">Opens<input type="time" aria-label={`${dayName(d)} opens`} className={`${field} mt-1 block`} value={w.opensAt} onChange={(e) => patch(i, { opensAt: e.target.value })} /></label>
                  <label className="text-sm text-muted">Closes<input type="time" aria-label={`${dayName(d)} closes`} className={`${field} mt-1 block`} value={w.closesAt} onChange={(e) => patch(i, { closesAt: e.target.value })} /></label>
                  <button type="button" className="btn btn-ghost !min-h-[48px]" onClick={() => setWindows((ws) => ws.filter((_, n) => n !== i))} aria-label={`Remove ${dayName(d)} period`}>Remove</button>
                </div>
              ))}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn btn-ghost !min-h-[44px] text-sm" onClick={() => setWindows((ws) => [...ws, { weekday: d, opensAt: "12:00", closesAt: "22:00" }])}>{mine.length ? "Add another period" : "Open this day"}</button>
                {mine.length > 0 && <button type="button" className="btn btn-ghost !min-h-[44px] text-sm" onClick={() => copyToAll(d)}>Copy to every day</button>}
              </div>
            </li>
          );
        })}
      </ul>
      {problem && <Msg text={problem} />}
      {windows.length === 0 && <p className="mt-3 rounded-lg border border-yellow-400 p-3 text-sm text-yellow-400">With no opening hours at all, customers cannot order.</p>}
      <button type="button" className="btn btn-primary mt-4 w-full sm:w-auto" disabled={busy || !!problem} onClick={save}>{busy ? "Saving…" : "Save opening hours"}</button>
      {!problem && <Msg text={msg.text} good={msg.good} />}
    </Section>
  );
}

// ---- closures ----------------------------------------------------------------------

function ClosuresSection({ closures, onChanged }: { closures: ClosureView[]; onChanged: () => void }) {
  const [day, setDay] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  async function add() {
    setMsg("");
    const o = await api("POST", "/api/admin/settings/closures", { day, reason: reason || undefined });
    if (o.ok) {
      setDay("");
      setReason("");
      onChanged();
    } else setMsg(failMessage(o));
  }
  async function remove(id: number) {
    const o = await api("DELETE", `/api/admin/settings/closures/${id}`);
    if (o.ok) onChanged();
    else setMsg(failMessage(o));
  }
  return (
    <Section id="closures-h" title="Closed days" hint="Bank holidays and other days you will not open. These override the weekly hours.">
      {closures.length === 0 ? <p className="text-muted">No upcoming closed days.</p> : (
        <ul className="divide-y divide-line border-y border-line">
          {closures.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2">
              <span><strong>{new Date(`${c.day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</strong>{c.reason ? ` · ${c.reason}` : ""}</span>
              <button type="button" className="btn btn-ghost !min-h-[44px] text-sm" onClick={() => remove(c.id)} aria-label={`Remove closed day ${c.day}`}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-sm text-muted">Date<input type="date" className={`${field} mt-1 block`} value={day} onChange={(e) => setDay(e.target.value)} /></label>
        <label className="grow text-sm text-muted">Reason (optional)<input className={`${field} mt-1 block w-full`} value={reason} maxLength={100} onChange={(e) => setReason(e.target.value)} placeholder="Christmas Day" /></label>
        <button type="button" className="btn btn-primary !min-h-[48px]" disabled={!day} onClick={add}>Add closed day</button>
      </div>
      <Msg text={msg} />
    </Section>
  );
}

// ---- prep time + cash limits ----------------------------------------------------------

function GeneralSection({ general, onSaved }: { general: General; onSaved: () => void }) {
  const [prep, setPrep] = useState(String(general.defaultPrepMinutes));
  const [cashMax, setCashMax] = useState(general.cashMaxPence === null ? "" : penceToInput(general.cashMaxPence));
  const [perPhone, setPerPhone] = useState(String(general.cashDailyCapPerPhone));
  const [perIp, setPerIp] = useState(String(general.cashDailyCapPerIp));
  const [msg, setMsg] = useState<{ text: string; good?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);

  async function save() {
    const cashMaxPence = cashMax.trim() === "" ? null : parsePounds(cashMax);
    if (cashMax.trim() !== "" && cashMaxPence === null) return setMsg({ text: "Enter the cash limit in pounds, like 40 or 40.00." });
    const nums = [Number(prep), Number(perPhone), Number(perIp)];
    if (nums.some((n) => !Number.isInteger(n))) return setMsg({ text: "Use whole numbers for minutes and limits." });
    setBusy(true);
    const o = await api("PUT", "/api/admin/settings/general", { defaultPrepMinutes: nums[0], cashMaxPence, cashDailyCapPerPhone: nums[1], cashDailyCapPerIp: nums[2] });
    setMsg(o.ok ? { text: "Saved.", good: true } : { text: failMessage(o) });
    if (o.ok) onSaved();
    setBusy(false);
  }
  return (
    <Section id="general-h" title="Preparation time and cash orders">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="font-bold">Usual preparation time (minutes)<input inputMode="numeric" className={`${field} mt-1 block w-full font-normal`} value={prep} onChange={(e) => setPrep(e.target.value)} /></label>
        <label className="font-bold">Largest cash order (£)<input inputMode="decimal" className={`${field} mt-1 block w-full font-normal`} value={cashMax} onChange={(e) => setCashMax(e.target.value)} placeholder="No limit" /></label>
        <label className="font-bold">Cash orders per phone number a day<input inputMode="numeric" className={`${field} mt-1 block w-full font-normal`} value={perPhone} onChange={(e) => setPerPhone(e.target.value)} /></label>
        <label className="font-bold">Cash orders per device/network a day<input inputMode="numeric" className={`${field} mt-1 block w-full font-normal`} value={perIp} onChange={(e) => setPerIp(e.target.value)} /></label>
      </div>
      <p className="mt-2 text-sm text-muted">Leave the cash limit empty for no limit. The daily limits stop people placing lots of cash orders they never collect.</p>
      <button type="button" className="btn btn-primary mt-3 w-full sm:w-auto" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
      <Msg text={msg.text} good={msg.good} />
    </Section>
  );
}

// ---- site-wide notice bar ---------------------------------------------------------------

function NoticeSection({ general, onSaved }: { general: General; onSaved: () => void }) {
  const [text, setText] = useState(general.noticeBar ?? "");
  const [msg, setMsg] = useState<{ text: string; good?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);
  async function save(next: string) {
    setBusy(true);
    const o = await api("PUT", "/api/admin/settings/notice", { text: next.trim() || null });
    setMsg(o.ok ? { text: next.trim() ? "Notice saved. It shows at the top of every page within a minute." : "Notice removed.", good: true } : { text: failMessage(o) });
    if (o.ok) onSaved();
    setBusy(false);
  }
  return (
    <Section id="notice-h" title="Notice bar" hint="One short message shown in an orange bar at the top of every page, for example “Closed this Sunday” or “Free delivery this weekend”. Leave it empty for no bar.">
      <label className="block font-bold">Message<input className={`${field} mt-1 block w-full font-normal`} value={text} maxLength={200} placeholder="No notice" onChange={(e) => setText(e.target.value)} /></label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => save(text)}>{busy ? "Saving…" : "Save notice"}</button>
        {general.noticeBar && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setText(""); void save(""); }}>Remove notice</button>}
      </div>
      <Msg text={msg.text} good={msg.good} />
    </Section>
  );
}

// ---- delivery zones -----------------------------------------------------------------------

function ZonesSection({ zones, onChanged }: { zones: ZoneRow[]; onChanged: () => void }) {
  return (
    <Section id="zones-h" title="Delivery zones" hint="Delivery is offered only to postcode districts listed here (LU1, LU4…). Orders from anywhere else are politely refused; collection always works.">
      {zones.length === 0 ? <p className="text-muted">No zones yet.</p> : (
        <ul className="space-y-3">{zones.map((z) => <ZoneCard key={z.id} zone={z} onChanged={onChanged} />)}</ul>
      )}
      <AddZone onAdded={onChanged} />
    </Section>
  );
}

type ZoneForm = { fee: string; minOrder: string; minutes: string; active: boolean };
function zoneBody(f: ZoneForm): { body?: { fee: number; minOrder: number; estimatedMinutes: number; active: boolean }; error?: string } {
  const fee = parsePounds(f.fee);
  const minOrder = parsePounds(f.minOrder);
  const minutes = Number(f.minutes);
  if (fee === null) return { error: "Enter the delivery fee in pounds, like 2.50." };
  if (minOrder === null) return { error: "Enter the minimum order in pounds, like 10." };
  if (!Number.isInteger(minutes)) return { error: "Enter the estimated time as whole minutes." };
  return { body: { fee, minOrder, estimatedMinutes: minutes, active: f.active } };
}

function ZoneFields({ f, set }: { f: ZoneForm; set: (p: Partial<ZoneForm>) => void }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <label className="text-sm text-muted">Fee (£)<input inputMode="decimal" className={`${field} mt-1 block w-full`} value={f.fee} onChange={(e) => set({ fee: e.target.value })} /></label>
      <label className="text-sm text-muted">Minimum order (£)<input inputMode="decimal" className={`${field} mt-1 block w-full`} value={f.minOrder} onChange={(e) => set({ minOrder: e.target.value })} /></label>
      <label className="text-sm text-muted">Estimated minutes<input inputMode="numeric" className={`${field} mt-1 block w-full`} value={f.minutes} onChange={(e) => set({ minutes: e.target.value })} /></label>
      <label className="flex min-h-[48px] items-center gap-2 self-end"><input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} className="h-5 w-5" /> Delivering</label>
    </div>
  );
}

function ZoneCard({ zone, onChanged }: { zone: ZoneRow; onChanged: () => void }) {
  const [f, setF] = useState<ZoneForm>({ fee: penceToInput(zone.fee), minOrder: penceToInput(zone.minOrder), minutes: String(zone.estimatedMinutes), active: zone.active });
  const [msg, setMsg] = useState<{ text: string; good?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);
  async function save() {
    const z = zoneBody(f);
    if (!z.body) return setMsg({ text: z.error! });
    setBusy(true);
    const o = await api("PUT", `/api/admin/zones/${zone.id}`, z.body);
    setMsg(o.ok ? { text: "Saved.", good: true } : { text: failMessage(o) });
    if (o.ok) onChanged();
    setBusy(false);
  }
  async function remove() {
    if (!window.confirm(`Delete the ${zone.district} zone? Customers there will no longer be able to order delivery.`)) return;
    const o = await api("DELETE", `/api/admin/zones/${zone.id}`);
    if (o.ok) onChanged();
    else setMsg({ text: failMessage(o) });
  }
  return (
    <li className="rounded-lg border border-line p-3">
      <p className="font-bold">{zone.district} <span className="font-normal text-muted">· {formatPenceExact(zone.fee)} fee · min {formatPenceExact(zone.minOrder)} · {zone.estimatedMinutes} min{!zone.active ? " · not delivering" : ""}</span></p>
      <ZoneFields f={f} set={(p) => setF((x) => ({ ...x, ...p }))} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary !min-h-[48px]" disabled={busy} onClick={save}>Save {zone.district}</button>
        <button type="button" className="btn btn-ghost !min-h-[48px]" onClick={remove}>Delete</button>
      </div>
      <Msg text={msg.text} good={msg.good} />
    </li>
  );
}

function AddZone({ onAdded }: { onAdded: () => void }) {
  const [district, setDistrict] = useState("");
  const [f, setF] = useState<ZoneForm>({ fee: "2.50", minOrder: "10.00", minutes: "40", active: true });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    const z = zoneBody(f);
    if (!z.body) return setMsg(z.error!);
    setBusy(true);
    setMsg("");
    const o = await api("POST", "/api/admin/zones", { district, ...z.body });
    if (o.ok) {
      setDistrict("");
      onAdded();
    } else setMsg(failMessage(o));
    setBusy(false);
  }
  return (
    <div className="mt-6 rounded-lg border border-dashed border-line p-3">
      <h3 className="font-bold">Add a zone</h3>
      <label className="mt-2 block text-sm text-muted">Postcode district<input className={`${field} mt-1 block w-40 uppercase`} value={district} maxLength={4} placeholder="LU4" onChange={(e) => setDistrict(e.target.value)} /></label>
      <ZoneFields f={f} set={(p) => setF((x) => ({ ...x, ...p }))} />
      <button type="button" className="btn btn-primary mt-3 !min-h-[48px]" disabled={busy || !district.trim()} onClick={add}>Add zone</button>
      <Msg text={msg} />
    </div>
  );
}
