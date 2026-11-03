import { cacheLife, cacheTag } from "next/cache";
import { buildMenu, type Menu } from "./menu-model";

export * from "./menu-model";

// Menu accessor. Today it builds from the seed file extracted from the print
// menu (sample data until the owner confirms it). When DATABASE_URL is wired
// up, only buildMenu() changes — pages call getMenu() and never care.
//
// Cache: tagged "menu". Every admin write to menu, prices, offers or sold-out
// flags must call revalidateTag("menu", "max") so the public site refreshes
// within seconds (R6.3, R10.3).
export async function getMenu(): Promise<Menu> {
  "use cache";
  cacheTag("menu");
  cacheLife("hours"); // refreshed on demand via revalidateTag; hours is the safety net
  return buildMenu();
}
