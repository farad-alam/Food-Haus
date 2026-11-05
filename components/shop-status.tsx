import { connection } from "next/server";
import { closedMessage, formatClock, shopState } from "@/lib/shop-status";
import { getSchedule } from "@/lib/schedule-public";
import { londonParts } from "@/lib/hours";

// Open / closed status for the public pages (R6.8, R5.1). The schedule comes
// from the cache; "open right now" is computed at request time from the clock.
// `connection()` makes this render per request, so it streams in AFTER the first
// paint. That is why it lives in a strip of CONSTANT height that is already in
// the static page: filling it in moves nothing (no layout shift, R10). A banner
// that appeared only when closed pushed the whole page down.

const STRIP = "flex h-12 items-center justify-center border-b-2 px-4 text-center text-sm leading-tight";

/** The empty strip: what the static page contains before the status streams in. Same height as the real one. */
export function ShopStatusSlot() {
  return <div aria-hidden="true" className={`${STRIP} border-transparent bg-surface`} />;
}

/** Under the header on every public page: "Open now…" while taking orders, otherwise why not and when it reopens. */
export async function ShopStatusBanner() {
  await connection();
  const now = new Date();
  const state = shopState(await getSchedule(), now);
  if (state.open) {
    return (
      <div role="status" className={`${STRIP} border-transparent bg-surface font-bold text-green-400`}>
        <span className="line-clamp-2"><span aria-hidden="true">● </span>Open now{state.closesAt ? ` · taking orders until ${formatClock(londonParts(state.closesAt).minutes)}` : ""}</span>
      </div>
    );
  }
  return (
    <div role="status" className={`${STRIP} border-brand bg-surface`}>
      <p className="line-clamp-2">
        <span className="font-bold">{closedMessage(state, now)}</span>
        <span className="hidden text-muted sm:inline"> You can still look at the menu and fill your basket.</span>
      </p>
    </div>
  );
}
