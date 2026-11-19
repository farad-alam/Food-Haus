import { eq } from "drizzle-orm";
import { settings } from "@/db/schema";
import { getDb } from "./db/client";
import type { Db } from "./db/client";
import { cached } from "./local-cache";
import { isPublicId } from "./photos/keys";
import { MAX_ALT_LENGTH } from "./photos/types";

// Home page images (R5.1, R10.5): the hero photo and one round photo per category tile, uploaded in the
// admin (Settings, Home page images) through the same checked, signed Cloudinary upload as item photos.
// Stored in settings.home_images as Cloudinary public ids. Anything malformed is ignored whole, never shown,
// so a bad stored value means "no image there" — the page falls back to its own drawn placeholder art.

export type HomeImages = {
  hero: { key: string; alt: string } | null;
  /** The wide feast banner above the popular items. */
  banner: string | null;
  /** Keyed by category SLUG (stable across renames, same key the menu uses). */
  categories: Record<string, string>;
};

const cleanAlt = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_ALT_LENGTH) : "");
const SLUG_RE = /^[a-z0-9-]{1,80}$/;

/** Turns whatever is stored into trustworthy images. Exported for tests and the admin view. */
export function parseHomeImages(stored: unknown): HomeImages {
  const o = (typeof stored === "object" && stored !== null ? stored : {}) as Record<string, unknown>;
  const hero = isPublicId(o.hero) ? { key: o.hero, alt: cleanAlt(o.heroAlt) } : null;
  const banner = isPublicId(o.banner) ? o.banner : null;
  const categories: Record<string, string> = {};
  if (typeof o.categories === "object" && o.categories !== null) {
    for (const [slug, id] of Object.entries(o.categories as Record<string, unknown>)) {
      if (SLUG_RE.test(slug) && isPublicId(id)) categories[slug] = id;
    }
  }
  return { hero, banner, categories };
}

export async function loadHomeImages(db: Db): Promise<HomeImages> {
  const [row] = await db.select({ h: settings.homeImages }).from(settings).where(eq(settings.id, 1)).limit(1);
  return parseHomeImages(row?.h);
}

/** For the public pages: cached 30 s per instance; a save in Settings clears it. Never throws: no images is the fallback. */
export async function getHomeImages(): Promise<HomeImages> {
  try {
    return await cached("settings:home-images", () => loadHomeImages(getDb()));
  } catch {
    return { hero: null, banner: null, categories: {} };
  }
}
