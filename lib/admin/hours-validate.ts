// Opening-hours rules (R9.9), shared by the settings form (instant feedback)
// and the API (the real check). Pure, no imports.
//
// A window runs from opensAt to closesAt on `weekday` (0 = Sunday). If closesAt
// is not after opensAt the window runs past midnight into the next day, which
// is how lib/hours.ts reads it too, so what is saved is what is enforced.

export type HoursWindow = { weekday: number; opensAt: string; closesAt: string };

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MAX_WINDOWS_PER_DAY = 3;
const WEEK = 7 * 1440;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const dayName = (weekday: number) => DAY_NAMES[weekday] ?? "?";

/** "HH:MM" or "HH:MM:SS" (as Postgres returns it) to "HH:MM"; null if invalid. */
export function normaliseTime(t: string): string | null {
  const hhmm = /^\d{2}:\d{2}(:\d{2})?$/.test(t) ? t.slice(0, 5) : t;
  return TIME_RE.test(hhmm) ? hhmm : null;
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function span(w: HoursWindow): { start: number; dur: number } {
  const open = minutes(w.opensAt);
  const close = minutes(w.closesAt);
  return { start: w.weekday * 1440 + open, dur: close > open ? close - open : close + 1440 - open };
}

/** Returns a message for the first problem, or null when the windows are valid. */
export function validateWindows(windows: HoursWindow[]): string | null {
  const perDay = new Map<number, number>();
  for (const w of windows) {
    if (!Number.isInteger(w.weekday) || w.weekday < 0 || w.weekday > 6) return "Unknown day of the week.";
    if (!TIME_RE.test(w.opensAt) || !TIME_RE.test(w.closesAt)) return `${dayName(w.weekday)}: enter times like 12:00.`;
    if (w.opensAt === w.closesAt) return `${dayName(w.weekday)}: opening and closing time cannot be the same.`;
    perDay.set(w.weekday, (perDay.get(w.weekday) ?? 0) + 1);
  }
  for (const [d, n] of perDay) if (n > MAX_WINDOWS_PER_DAY) return `${dayName(d)}: at most ${MAX_WINDOWS_PER_DAY} opening periods a day.`;

  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      const a = span(windows[i]);
      const b = span(windows[j]);
      // Overlap on a circular week: either start falls inside the other window.
      const aInB = (a.start - b.start + WEEK) % WEEK < b.dur;
      const bInA = (b.start - a.start + WEEK) % WEEK < a.dur;
      if (aInB || bInA) {
        const [x, y] = [windows[i], windows[j]];
        return x.weekday === y.weekday
          ? `${dayName(x.weekday)}: opening periods overlap.`
          : `${dayName(x.weekday)} and ${dayName(y.weekday)} overlap, because one runs past midnight.`;
      }
    }
  }
  return null;
}

/** Sort for display and storage: by weekday (Mon-first not applied here), then opening time. */
export function sortWindows<T extends HoursWindow>(ws: T[]): T[] {
  return [...ws].sort((a, b) => a.weekday - b.weekday || a.opensAt.localeCompare(b.opensAt));
}
