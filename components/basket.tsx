"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { formatPenceExact } from "@/lib/money";
import { AddWithOptions } from "@/components/option-picker";
import type { PickerGroup } from "@/lib/option-select";
import { addToCartEvent, track } from "@/lib/analytics-events";
import {
  addLine,
  EMPTY,
  getServerSnapshot,
  getSnapshot,
  MAX_NOTE,
  setLineQty,
  subscribe,
  write,
  type BasketLine,
  type NewLine,
} from "@/lib/basket-store";

// R6.4: basket survives reload and a closed tab (localStorage), with a 200
// character note. Prices here are DISPLAY ONLY — the server recomputes every
// total from the database at checkout and never trusts the browser (R6.14).

export type { BasketLine };

type BasketState = {
  lines: BasketLine[];
  note: string;
  count: number;
  total: number;
  add: (line: NewLine) => void;
  setQty: (key: string, qty: number) => void;
  setNote: (note: string) => void;
  clear: () => void;
};

const Ctx = createContext<BasketState | null>(null);

export function useBasket(): BasketState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBasket must be used inside <BasketProvider>");
  return v;
}

export function BasketProvider({ children }: { children: React.ReactNode }) {
  // The server (and first client render) see an empty basket, then React swaps in
  // the stored one — no hydration mismatch, no setState-in-effect.
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const add = useCallback((line: NewLine) => {
    write(addLine(getSnapshot(), line));
    track(addToCartEvent(line)); // R11.8; does nothing unless analytics was accepted
  }, []);
  const setQty = useCallback((key: string, qty: number) => write(setLineQty(getSnapshot(), key, qty)), []);
  const setNote = useCallback((n: string) => write({ ...getSnapshot(), note: n.slice(0, MAX_NOTE) }), []);
  const clear = useCallback(() => write(EMPTY), []);

  const value = useMemo<BasketState>(
    () => ({
      lines: stored.lines,
      note: stored.note,
      count: stored.lines.reduce((n, l) => n + l.qty, 0),
      total: stored.lines.reduce((n, l) => n + l.qty * l.price, 0),
      add,
      setQty,
      setNote,
      clear,
    }),
    [stored, add, setQty, setNote, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function AddToBasket({
  id,
  name,
  price,
  soldOut,
  optionGroup,
}: {
  id: string;
  name: string;
  price: number;
  soldOut: boolean;
  /** The category's option group (e.g. "Make it a Meal"); when present, Add opens the picker. */
  optionGroup?: PickerGroup | null;
}) {
  const { add } = useBasket();
  if (soldOut) {
    return (
      <span className="inline-flex min-h-[44px] items-center rounded-xl border border-line px-4 text-sm text-muted">
        Sold out
      </span>
    );
  }
  if (optionGroup && optionGroup.options.length > 0) return <AddWithOptions id={id} name={name} price={price} group={optionGroup} />;
  return (
    <button type="button" className="btn btn-primary" onClick={() => add({ id, name, price })} aria-label={`Add ${name} to basket`}>
      Add
    </button>
  );
}

/** R6.5: sticky bottom bar with item count and total. Space is reserved by
 *  the page's bottom padding so nothing jumps (R10.8). */
const noopSubscribe = () => () => {};
export function StickyBasketBar() {
  const { count, total } = useBasket();
  const path = usePathname();
  // This bar sits in a Suspense boundary that hydrates AFTER the basket provider has already switched to the
  // saved basket, so reading the basket alone would render the bar on the first client pass while the server
  // HTML has none (React hydration error #418 for every visitor with a saved basket). `hydrated` is false for
  // exactly the hydrating render, so the first pass matches the server, then the bar appears.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!hydrated) return null;
  // The bar is for browsing; checkout and order pages have their own summary.
  if (count === 0 || path.startsWith("/checkout") || path.startsWith("/order")) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/95 p-3 backdrop-blur" role="region" aria-label="Basket">
      <Link href="/checkout" className="btn btn-primary mx-auto flex w-full max-w-xl justify-between">
        <span>
          View basket · {count} item{count === 1 ? "" : "s"}
        </span>
        <span>{formatPenceExact(total)}</span>
      </Link>
    </div>
  );
}
