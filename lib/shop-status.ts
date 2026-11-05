import { londonParts, isOpenAt, type ClosureRow, type HoursRow } from "./hours";
import { londonLocalToUtc } from "./london-time";

// Is the shop taking orders, and if not, when does it reopen? One pure module
// feeds the website banner, the checkout button and the order API's messages,
// so they cannot disagree (R6.8). Callers pass `now`.

export type Schedule = {
  paused: boolean;
  pausedMessage: string | null;
  hours: HoursRow[];
  closures: (ClosureRow & { reason?: string | null })[];
};
export type ShopState = {
  open: boolean;
  reason: "open" | "paused" | "no_hours" | "closure" | "outside_hours";
  /** When ordering next opens (null when open, paused, or no hours are set). */
  opensAt: Date | null;
  /** When the current period ends (only while open). */
  closesAt: Date | null;
  /** Reason given for today's closure day, if any. */
  closureReason: string | null;
  pausedMessage: string | null;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MINUTE = 60_000;
const hhmm = (t: string) => t.slice(0, 5);
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** "12pm", "5:30pm", "midnight"-free 12-hour clock for customers. */
export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

/** The next time a period STARTS, looking up to two weeks ahead, skipping closure days. */
export function nextOpening(hours: HoursRow[], closures: { day: string }[], now: Date): Date | null {
  const today = londonParts(now).date;
  const closed = new Set(closures.map((c) => c.day));
  let best: Date | null = null;
  for (let i = 0; i <= 14; i++) {
    const date = addDays(today, i);
    if (closed.has(date)) continue;
    const wd = weekdayOf(date);
    for (const h of hours) {
      if (h.weekday !== wd) continue;
      const start = londonLocalToUtc(`${date}T${hhmm(h.opensAt)}`);
      if (start && start > now && (!best || start < best)) best = start;
    }
  }
  return best;
}

/** The end of the opening period that contains `now` (null if none). Handles periods past midnight. */
export function currentClosing(hours: HoursRow[], closures: { day: string }[], now: Date): Date | null {
  const today = londonParts(now).date;
  const closed = new Set(closures.map((c) => c.day));
  for (const date of [today, addDays(today, -1)]) {
    if (closed.has(date)) continue;
    const wd = weekdayOf(date);
    for (const h of hours) {
      if (h.weekday !== wd) continue;
      const start = londonLocalToUtc(`${date}T${hhmm(h.opensAt)}`);
      if (!start) continue;
      const open = mins(h.opensAt);
      const close = mins(h.closesAt);
      const end = new Date(start.getTime() + (close > open ? close - open : close + 1440 - open) * MINUTE);
      if (start <= now && now < end) return end;
    }
  }
  return null;
}

export function shopState(s: Schedule, now: Date): ShopState {
  const base = { opensAt: null, closesAt: null, closureReason: null, pausedMessage: s.pausedMessage } as const;
  if (s.paused) return { ...base, open: false, reason: "paused" };
  if (s.hours.length === 0) return { ...base, open: false, reason: "no_hours" };
  if (isOpenAt(s.hours, s.closures, now)) return { ...base, open: true, reason: "open", closesAt: currentClosing(s.hours, s.closures, now) };
  const today = londonParts(now).date;
  const closure = s.closures.find((c) => c.day === today);
  return {
    ...base,
    open: false,
    reason: closure ? "closure" : "outside_hours",
    closureReason: closure?.reason ?? null,
    opensAt: nextOpening(s.hours, s.closures, now),
  };
}

/** "today at 12pm", "tomorrow at 12pm", "Friday at 5:30pm", "Friday 20 Nov at 12pm". */
export function describeReopening(opensAt: Date, now: Date): string {
  const o = londonParts(opensAt);
  const days = Math.round((Date.parse(`${o.date}T12:00:00Z`) - Date.parse(`${londonParts(now).date}T12:00:00Z`)) / 86_400_000);
  const time = formatClock(o.minutes);
  if (days <= 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  const name = DAY_NAMES[o.weekday];
  if (days < 7) return `${name} at ${time}`;
  const [, mo, d] = o.date.split("-");
  return `${name} ${Number(d)} ${MONTHS[Number(mo) - 1]} at ${time}`;
}

/** The sentence customers see when ordering is not possible; null when open. */
export function closedMessage(state: ShopState, now: Date): string | null {
  if (state.open) return null;
  if (state.reason === "paused") return state.pausedMessage || "We are not taking orders right now.";
  if (state.reason === "no_hours") return "We are not taking orders right now.";
  const when = state.opensAt ? ` Ordering opens ${describeReopening(state.opensAt, now)}.` : "";
  if (state.reason === "closure") return `We are closed today${state.closureReason ? ` (${state.closureReason})` : ""}.${when}`;
  return `We are closed right now.${when}`;
}

/** Short label for a disabled button: "Ordering opens today at 12pm". */
export function closedButtonLabel(state: ShopState, now: Date): string {
  if (state.open) return "";
  if (state.reason === "paused") return "Orders are paused";
  return state.opensAt ? `Ordering opens ${describeReopening(state.opensAt, now)}` : "Closed";
}

/** Monday-first weekly timetable for the contact page. Empty when no hours are set. */
export function weekTimetable(hours: HoursRow[]): { day: string; times: string }[] {
  if (hours.length === 0) return [];
  return [1, 2, 3, 4, 5, 6, 0].map((wd) => {
    const ws = hours.filter((h) => h.weekday === wd).sort((a, b) => hhmm(a.opensAt).localeCompare(hhmm(b.opensAt)));
    return { day: DAY_NAMES[wd], times: ws.length ? ws.map((w) => `${formatClock(mins(w.opensAt))} – ${formatClock(mins(w.closesAt))}`).join(", ") : "Closed" };
  });
}
