"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { formatPenceExact } from "@/lib/money";
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
  add: (line: Omit<BasketLine, "qty">) => void;
  setQty: (id: string, qty: number) => void;
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

  const add = useCallback((line: Omit<BasketLine, "qty">) => write(addLine(getSnapshot(), line)), []);
  const setQty = useCallback((id: string, qty: number) => write(setLineQty(getSnapshot(), id, qty)), []);
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
}: {
  id: string;
  name: string;
  price: number;
  soldOut: boolean;
}) {
  const { add } = useBasket();
  if (soldOut) {
    return (
      <span className="inline-flex min-h-[44px] items-center rounded-xl border border-line px-4 text-sm text-muted">
        Sold out
      </span>
    );
  }
  return (
    <button type="button" className="btn btn-primary" onClick={() => add({ id, name, price })} aria-label={`Add ${name} to basket`}>
      Add
    </button>
  );
}

/** R6.5: sticky bottom bar with item count and total. Space is reserved by
 *  the page's bottom padding so nothing jumps (R10.8). */
export function StickyBasketBar() {
  const { count, total } = useBasket();
  if (count === 0) return null;
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
