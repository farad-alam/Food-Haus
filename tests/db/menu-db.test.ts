import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { loadMenuRows, loadOffers } from "@/lib/db/menu-repo";
import { buildMenu, rowsToMenu } from "@/lib/menu-model";

// Integration: needs a migrated + seeded database (npm run db:migrate && db:seed).
describe.skipIf(!process.env.DATABASE_URL)("menu from Postgres", () => {
  it("matches the seed file, so ids and prices are identical to what the pricing tests use", async () => {
    // Compare only the SEEDED categories: other tests (and the owner, later) may add their own.
    const seeded = buildMenu();
    const names = new Set(seeded.categories.map((c) => c.name));
    const fromDb = rowsToMenu(await loadMenuRows(getDb()));
    const onlySeeded = {
      categories: fromDb.categories.filter((c) => names.has(c.name)),
      optionGroups: Object.fromEntries(Object.entries(fromDb.optionGroups).filter(([k]) => names.has(k))),
      popular: fromDb.popular,
    };
    expect(onlySeeded).toEqual(seeded);
  });
  it("loads the wings BOGOF as a collection-only offer tied to the Wings category", async () => {
    const offers = await loadOffers(getDb());
    const o = offers.find((x) => x.type === "bogof");
    expect(o).toMatchObject({ appliesToCategory: "Wings", channel: "collection" });
  });
});
