import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { loadMenuRows, loadOffers } from "@/lib/db/menu-repo";
import { buildMenu, rowsToMenu } from "@/lib/menu-model";

// Integration: needs a migrated + seeded database (npm run db:migrate && db:seed).
describe.skipIf(!process.env.DATABASE_URL)("menu from Postgres", () => {
  it("matches the seed file, so ids and prices are identical to what the pricing tests use", async () => {
    const fromDb = rowsToMenu(await loadMenuRows(getDb()));
    expect(fromDb).toEqual(buildMenu());
  });
  it("loads the wings BOGOF as a collection-only offer tied to the Wings category", async () => {
    const offers = await loadOffers(getDb());
    const o = offers.find((x) => x.type === "bogof");
    expect(o).toMatchObject({ appliesToCategory: "Wings", channel: "collection" });
  });
});
