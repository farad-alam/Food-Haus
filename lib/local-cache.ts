// A tiny per-instance cache for the public data (menu, offers, hours, notice, contact), used INSTEAD of
// Next's `use cache` on this branch.
//
// Why: on Cloudflare Workers Next's `use cache` lets a request JOIN another request's still-pending
// invocation ("joining pending cross-request invocation"). That shared promise belongs to the first
// request, so if that request ends or is cancelled first (prefetches and abandoned page loads do this
// constantly) the others wait on, or inherit the failure of, something that will never finish. The
// Worker log for the failing /menu and /offers pointed exactly there (the `use cache` wrapper awaiting
// that pending entry, called from the offers component).
//
// This cache keeps only RESOLVED plain values. A miss means each request does its own load; nothing
// pending is ever shared between requests. Cost: with several instances running, another instance can
// serve a value up to TTL_MS old after an admin edit (the instance that handled the edit refreshes at once).

export const TTL_MS = 30_000;

const store = new Map<string, { value: unknown; expires: number }>();

export async function cached<T>(key: string, load: () => Promise<T>, ttlMs: number = TTL_MS): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return structuredClone(hit.value) as T; // callers may not change what others will read
  const value = await load(); // a failure is thrown, never stored
  store.set(key, { value: structuredClone(value), expires: Date.now() + ttlMs });
  return value;
}

/** Forget everything whose key starts with `prefix` (all of it when omitted). */
export function clearLocalCache(prefix = ""): void {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}
