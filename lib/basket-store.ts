// localStorage-backed basket store for useSyncExternalStore (R6.4).
//
// Everything read back from storage is validated, because storage is the
// customer's own browser: it can be stale, hand-edited or corrupt. The stored
// prices are display-only anyway — the server recomputes every total.

export const MAX_QTY = 20;
export const MAX_NOTE = 200;
const KEY = "fh-basket-v1";

export type BasketLine = {
  /** Identity of the line: item id plus its chosen options. The same burger with
   *  and without the meal are two lines. Always recomputed, never trusted from storage. */
  key: string;
  id: string; // menu item id
  name: string;
  price: number; // pence, display only: unit price INCLUDING chosen options
  qty: number;
  optionIds: string[]; // what the server prices; ids from the menu
  optionNames: string[]; // display only
};
export type NewLine = Omit<BasketLine, "qty" | "key" | "optionIds" | "optionNames"> & { optionIds?: string[]; optionNames?: string[] };

/** Line identity. Option order does not matter. */
export function lineKey(id: string, optionIds: string[]): string {
  return optionIds.length ? `${id}|${[...optionIds].sort().join(",")}` : id;
}
export type Stored = { lines: BasketLine[]; note: string };

export const EMPTY: Stored = { lines: [], note: "" };

/** An array of up to 10 short strings, or null if it is anything else. */
function strings(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > 10) return null;
  return v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 100) ? (v as string[]) : null;
}

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
        const { id, name, price, qty, optionIds, optionNames } = l as Record<string, unknown>;
        // Older baskets (before options existed) have neither field: treat as no options.
        const ids = optionIds === undefined ? [] : strings(optionIds);
        const names = optionNames === undefined ? [] : strings(optionNames);
        if (
          typeof id === "string" && id.length > 0 && id.length <= 100 &&
          typeof name === "string" && name.length <= 200 &&
          typeof price === "number" && Number.isInteger(price) && price >= 0 && price <= 100_000 &&
          typeof qty === "number" && Number.isInteger(qty) && qty >= 1 && qty <= MAX_QTY &&
          ids !== null && names !== null && names.length === ids.length
        ) {
          const key = lineKey(id, ids);
          if (!clean.some((c) => c.key === key)) clean.push({ key, id, name, price, qty, optionIds: ids, optionNames: names });
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

export function addLine(state: Stored, line: NewLine): Stored {
  const optionIds = line.optionIds ?? [];
  const full: Omit<BasketLine, "qty"> = { ...line, optionIds, optionNames: line.optionNames ?? [], key: lineKey(line.id, optionIds) };
  const hit = state.lines.find((l) => l.key === full.key);
  const lines = hit
    ? state.lines.map((l) => (l.key === full.key ? { ...l, qty: Math.min(l.qty + 1, MAX_QTY) } : l))
    : [...state.lines, { ...full, qty: 1 }];
  return { ...state, lines };
}

export function setLineQty(state: Stored, key: string, qty: number): Stored {
  const lines =
    qty <= 0
      ? state.lines.filter((l) => l.key !== key)
      : state.lines.map((l) => (l.key === key ? { ...l, qty: Math.min(Math.floor(qty), MAX_QTY) } : l));
  return { ...state, lines };
}
