import { revalidateTag } from "next/cache";

/**
 * Called after every admin write to categories, items, prices, sold-out flags
 * or options (R6.3, R10.3). `{ expire: 0 }` means no stale copy is ever served:
 * the next page view rebuilds from the database, so a price or sold-out change
 * is live on the next visit. Ordering itself never uses this cache; checkout
 * reads the database directly.
 */
export function refreshMenuCache(): void {
  try {
    revalidateTag("menu", { expire: 0 });
  } catch (e) {
    // Outside a Next request (unit tests) there is nothing to refresh. In
    // production a failure is loud, but must not fail the admin's save: the
    // cache also expires by itself within the hour.
    if (!process.env.VITEST) console.error("menu cache refresh failed", e instanceof Error ? e.message : e);
  }
}
