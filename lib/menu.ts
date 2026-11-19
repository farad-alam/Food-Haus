import { cached } from "./local-cache";
import { getDb } from "./db/client";
import { loadMenuRows } from "./db/menu-repo";
import { rowsToMenu, type Menu } from "./menu-model";

export * from "./menu-model";

// Menu accessor: reads categories, items and options from Postgres.
// There is deliberately NO fallback to the seed file: if the database is
// unreachable the page errors (app/error.tsx) rather than showing stale or
// invented prices. Load the initial data with `npm run db:seed`.
//
// Cache: per-instance, 30 seconds (lib/local-cache.ts), cleared by refreshMenuCache()
// after every admin write (R6.3, R10.3). Not Next's `use cache`: see local-cache.ts.
export async function getMenu(): Promise<Menu> {
  return cached("menu", async () => rowsToMenu(await loadMenuRows(getDb())));
}
