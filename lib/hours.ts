// Opening-hours check (R6.8). Pure: the caller passes the rows and `now`.
// Times are wall-clock in Europe/London, so BST/GMT changes are handled by
// Intl rather than by hand.

export type HoursRow = { weekday: number; opensAt: string; closesAt: string }; // 0 = Sunday, "HH:MM[:SS]"
export type ClosureRow = { day: string }; // "YYYY-MM-DD" (London date)

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function londonParts(now: Date) {
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  return {
    weekday: WEEKDAYS.indexOf(p.weekday),
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

function previousDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Open if a window that started today contains the time, or a window that
 * started yesterday and runs past midnight (closesAt <= opensAt) still does.
 * A closure day closes the windows that START on that day. No rows = closed:
 * nothing is assumed about hours the owner has not supplied.
 */
export function isOpenAt(rows: HoursRow[], closures: ClosureRow[], now: Date): boolean {
  const { weekday, date, minutes } = londonParts(now);
  const closed = new Set(closures.map((c) => c.day));
  const prevDate = previousDate(date);
  const prevWeekday = (weekday + 6) % 7;

  for (const r of rows) {
    const open = toMinutes(r.opensAt);
    const close = toMinutes(r.closesAt);
    const overnight = close <= open;
    if (r.weekday === weekday && !closed.has(date)) {
      if (overnight ? minutes >= open : minutes >= open && minutes < close) return true;
    }
    if (overnight && r.weekday === prevWeekday && !closed.has(prevDate) && minutes < close) return true;
  }
  return false;
}
