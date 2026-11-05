import { londonParts } from "./hours";

// UK wall-clock <-> UTC for scheduling (offers start/end). The owner types
// "2026-12-01 09:00" meaning UK time; the clocks change in March and October,
// so this uses Intl's Europe/London rules rather than a fixed offset.

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * "YYYY-MM-DDTHH:mm" in UK time -> the UTC instant, or null if the text is not
 * a real date or the time does not exist (the hour skipped when clocks go
 * forward). During the repeated hour in October the EARLIER instant is used.
 */
export function londonLocalToUtc(local: string): Date | null {
  const m = LOCAL_RE.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const asUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  const check = new Date(asUtc);
  if (check.toISOString().slice(0, 10) !== `${y}-${mo}-${d}`) return null; // e.g. 2026-02-30
  const wantDate = `${y}-${mo}-${d}`;
  const wantMinutes = Number(h) * 60 + Number(mi);
  for (const offsetMinutes of [60, 0]) {
    // BST (UTC+1) first: that is the earlier instant when a wall time repeats
    const candidate = new Date(asUtc - offsetMinutes * 60_000);
    const p = londonParts(candidate);
    if (p.date === wantDate && p.minutes === wantMinutes) return candidate;
  }
  return null;
}

/** UTC instant -> "YYYY-MM-DDTHH:mm" in UK time (for form fields). */
export function utcToLondonLocal(date: Date): string {
  const p = londonParts(date);
  const hh = String(Math.floor(p.minutes / 60)).padStart(2, "0");
  const mm = String(p.minutes % 60).padStart(2, "0");
  return `${p.date}T${hh}:${mm}`;
}

/** "30 Nov" / "30 Nov 2026" for a UTC instant, shown in UK time. */
export function formatLondonDate(date: Date, withYear = false): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) }).format(date);
}
