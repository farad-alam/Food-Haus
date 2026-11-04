import { cacheLife, cacheTag } from "next/cache";
import { getDb } from "./db/client";
import { loadMenuRows } from "./db/menu-repo";
import { rowsToMenu, type Menu } from "./menu-model";

export * from "./menu-model";

// Menu accessor: reads categories, items and options from Postgres.
// There is deliberately NO fallback to the seed file: if the database is
// unreachable the page errors (app/error.tsx) rather than showing stale or
// invented prices. Load the initial data with `npm run db:seed`.
//
// Cache: tagged "menu". Every admin write to menu, prices, offers or sold-out
// flags must call revalidateTag("menu", "max") so the public site refreshes
// within seconds (R6.3, R10.3).
export async function getMenu(): Promise<Menu> {
  "use cache";
  cacheTag("menu");
  cacheLife("hours"); // refreshed on demand via revalidateTag; hours is the safety net
  return rowsToMenu(await loadMenuRows(getDb()));
}
