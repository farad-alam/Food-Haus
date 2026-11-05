import { cacheLife, cacheTag } from "next/cache";
import { asc } from "drizzle-orm";
import { closure, openingHours } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import type { Db } from "@/lib/db/client";
import { normaliseTime } from "@/lib/admin/hours-validate";
import { loadGeneral } from "@/lib/admin/settings";
import type { Schedule } from "@/lib/shop-status";

// What the public pages need to say whether the shop is open. The cache holds
// the RAW schedule (tag "settings", expired at once by every admin save of hours,
// closures or the pause switch); whether the shop is open right now is decided
// at request time from the clock, so a page never says "open" after closing time.

export async function loadSchedule(db: Db): Promise<Schedule> {
  const [general, hoursRows, closureRows] = await Promise.all([
    loadGeneral(db),
    db.select().from(openingHours).orderBy(asc(openingHours.weekday), asc(openingHours.opensAt)),
    db.select().from(closure).orderBy(asc(closure.day)),
  ]);
  return {
    paused: general.paused,
    pausedMessage: general.pausedMessage,
    hours: hoursRows.map((r) => ({ weekday: r.weekday, opensAt: normaliseTime(r.opensAt)!, closesAt: normaliseTime(r.closesAt)! })),
    closures: closureRows.map((c) => ({ day: c.day, reason: c.reason })),
  };
}

export async function getSchedule(): Promise<Schedule> {
  "use cache";
  cacheTag("settings");
  cacheLife("minutes");
  return loadSchedule(getDb());
}
