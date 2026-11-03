// localStorage-backed basket store for useSyncExternalStore (R6.4).
//
// Everything read back from storage is validated, because storage is the
// customer's own browser: it can be stale, hand-edited or corrupt. The stored
// prices are display-only anyway — the server recomputes every total.

export const MAX_QTY = 20;
export const MAX_NOTE = 200;
const KEY = "fh-basket-v1";

export type BasketLine = {
  id: string; // menu item id
  name: string;
  price: number; // pence, display only
  qty: number;
};
export type Stored = { lines: BasketLine[]; note: string };

export const EMPTY: Stored = { lines: [], note: "" };

export function parseStored(raw: string | null): Stored {
  if (!raw) return EMPTY;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return EMPTY;
    const { lines, note } = data as { lines?: unknown; note?: unknown };
    const clean: BasketLine[] = [];
    if (Array.isArray(lines)) {
      for (const l of lines.slice(0, 30)) {
        if (typeof l !== "object" || l === null) continue;
        const { id, name, price, qty } = l as Record<string, unknown>;
        if (
          typeof id === "string" && id.length > 0 && id.length <= 100 &&
          typeof name === "string" && name.length <= 200 &&
          typeof price === "number" && Number.isInteger(price) && price >= 0 && price <= 100_000 &&
          typeof qty === "number" && Number.isInteger(qty) && qty >= 1 && qty <= MAX_QTY &&
          !clean.some((c) => c.id === id)
        ) {
          clean.push({ id, name, price, qty });
        }
      }
    }
    return { lines: clean, note: typeof note === "string" ? note.slice(0, MAX_NOTE) : "" };
  } catch {
    return EMPTY;
  }
}

// ---- store ---------------------------------------------------------------

const listeners = new Set<() => void>();
let memory: Stored | null = null; // used only if storage is blocked (private mode etc.)
let cachedRaw: string | null | undefined;
let cachedValue: Stored = EMPTY;

/** Snapshot must be referentially stable between changes (useSyncExternalStore). */
export function getSnapshot(): Stored {
  if (memory) return memory;
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return cachedValue;
  }
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  cachedValue = parseStored(raw);
  return cachedValue;
}

export function getServerSnapshot(): Stored {
  return EMPTY;
}

export function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab changed the basket.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function write(next: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    memory = null;
  } catch {
    memory = next;
  }
  listeners.forEach((l) => l());
}

// ---- pure transitions ----------------------------------------------------

export function addLine(state: Stored, line: Omit<BasketLine, "qty">): Stored {
  const hit = state.lines.find((l) => l.id === line.id);
  const lines = hit
    ? state.lines.map((l) => (l.id === line.id ? { ...l, qty: Math.min(l.qty + 1, MAX_QTY) } : l))
    : [...state.lines, { ...line, qty: 1 }];
  return { ...state, lines };
}

export function setLineQty(state: Stored, id: string, qty: number): Stored {
  const lines =
    qty <= 0
      ? state.lines.filter((l) => l.id !== id)
      : state.lines.map((l) => (l.id === id ? { ...l, qty: Math.min(Math.floor(qty), MAX_QTY) } : l));
  return { ...state, lines };
}
