import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";
import { loadMenuRows } from "../lib/db/menu-repo";
import { readinessFromMenu } from "../lib/allergen-readiness";
import { rowsToMenu } from "../lib/menu-model";

// Go-live check for allergen data: lists every visible item and option that still has no allergen
// information entered, and exits 1 if there are any (or no menu at all). Run before launch:
//   npm run allergens:check
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
const r = readinessFromMenu(rowsToMenu(await loadMenuRows(drizzle(neon(url), { schema }))));
if (r.ready) {
  console.log(`OK: allergen information is entered for all ${r.itemsTotal} items and every option.`);
} else {
  console.log(`NOT READY: ${r.itemsMissing.length} of ${r.itemsTotal} items and ${r.optionsMissing.length} options have no allergen information entered.`);
  for (const i of r.itemsMissing) console.log(`  item   ${i.category} / ${i.name}`);
  for (const o of r.optionsMissing) console.log(`  option ${o.category} / ${o.name}`);
  process.exitCode = 1;
}
