import { cached } from "./local-cache";
import { getDb } from "./db/client";
import { loadZones } from "./db/menu-repo";
import { areaSlug } from "./areas";
import type { Zone } from "./pricing";

/** Active delivery zones for the public pages (30 s per instance; zone edits clear it). Sorted by district. */
export async function getLiveZones(): Promise<Zone[]> {
  return cached("settings:zones", async () => (await loadZones(getDb())).filter((z) => z.active).sort((a, b) => a.district.localeCompare(b.district)));
}

export async function getZoneBySlug(slug: string): Promise<Zone | null> {
  return (await getLiveZones()).find((z) => areaSlug(z.district) === slug) ?? null;
}
