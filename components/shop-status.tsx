import { connection } from "next/server";
import { closedMessage, formatClock, shopState } from "@/lib/shop-status";
import { getSchedule } from "@/lib/schedule-public";
import { londonParts } from "@/lib/hours";

// Open / closed status for the public pages (R6.8, R5.1). The schedule comes
// from the cache; "open right now" is computed at request time from the clock.
// `connection()` makes these render per request: wrap each in <Suspense>.

/** Shown under the header on every public page, ONLY when ordering is not possible. */
export async function ShopStatusBanner() {
  await connection();
  const now = new Date();
  const state = shopState(await getSchedule(), now);
  if (state.open) return null;
  return (
    <div role="status" className="border-b-2 border-brand bg-surface px-4 py-3 text-center">
      <p className="mx-auto max-w-5xl font-bold">{closedMessage(state, now)}</p>
      <p className="mx-auto max-w-5xl text-sm text-muted">You can still look at the menu and fill your basket.</p>
    </div>
  );
}

/** One line for the home-page hero: "Open now · closes at 11pm" (nothing when closed: the banner says so). */
export async function OpenNowLine() {
  await connection();
  const now = new Date();
  const state = shopState(await getSchedule(), now);
  if (!state.open) return null;
  return (
    <p className="mt-4 text-sm font-bold text-green-400">
      <span aria-hidden="true">● </span>Open now{state.closesAt ? ` · taking orders until ${formatClock(londonParts(state.closesAt).minutes)}` : ""}
    </p>
  );
}
