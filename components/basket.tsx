"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { formatPenceExact } from "@/lib/money";

// R6.4: basket survives reload and a closed tab (localStorage), with a 200
// character note. Prices here are DISPLAY ONLY — the server recomputes every
// total from the database at checkout and never trusts the browser (R6.14).

export type BasketLine = {
  id: string; // menu item id
  name: string;
  price: number; // pence, display only
  qty: number;
};

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

const KEY = "fh-basket-v1";
const Ctx = createContext<BasketState | null>(null);

export function useBasket(): BasketState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBasket must be used inside <BasketProvider>");
  return v;
}

export function BasketProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<BasketLine[]>([]);
  const [note, setNoteState] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { lines?: BasketLine[]; note?: string };
        if (Array.isArray(parsed.lines)) setLines(parsed.lines.filter((l) => l.qty > 0));
        if (typeof parsed.note === "string") setNoteState(parsed.note.slice(0, 200));
      }
    } catch {
      /* storage blocked or corrupt — start with an empty basket */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ lines, note }));
    } catch {
      /* ignore */
    }
  }, [lines, note, ready]);

  const add = useCallback((line: Omit<BasketLine, "qty">) => {
    setLines((prev) => {
      const hit = prev.find((l) => l.id === line.id);
      if (hit) return prev.map((l) => (l.id === line.id ? { ...l, qty: Math.min(l.qty + 1, 20) } : l));
      return [...prev, { ...line, qty: 1 }];
    });
  }, []);

  const setQty = useCallback((id: string, qty: number) => {
    setLines((prev) =>
      qty <= 0 ? prev.filter((l) => l.id !== id) : prev.map((l) => (l.id === id ? { ...l, qty: Math.min(qty, 20) } : l)),
    );
  }, []);

  const setNote = useCallback((n: string) => setNoteState(n.slice(0, 200)), []);
  const clear = useCallback(() => {
    setLines([]);
    setNoteState("");
  }, []);

  const value = useMemo<BasketState>(
    () => ({
      lines,
      note,
      count: lines.reduce((n, l) => n + l.qty, 0),
      total: lines.reduce((n, l) => n + l.qty * l.price, 0),
      add,
      setQty,
      setNote,
      clear,
    }),
    [lines, note, add, setQty, setNote, clear],
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
