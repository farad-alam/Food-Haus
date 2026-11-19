import { eq } from "drizzle-orm";
import { category, settings } from "@/db/schema";
import type { Db } from "@/lib/db/client";
import { loadHomeImages, parseHomeImages, type HomeImages } from "@/lib/home-images";
import type { CloudinaryConfig } from "@/lib/photos/cloudinary";
import { deletePhotoAsset, PHOTO_MESSAGES, uploadValidatedPhoto } from "@/lib/photos/pipeline";
import { MAX_ALT_LENGTH } from "@/lib/photos/types";
import { auditInsert, type Actor } from "./audit";
import type { Result } from "./settings";

// Admin side of the home page images (R5.1): upload, replace and remove the hero photo and the category tile
// photos. Same rules as item photos (checked bytes, signed Cloudinary upload, old asset destroyed), audited.

export type HomeImageSlot = { kind: "hero" } | { kind: "banner" } | { kind: "category"; slug: string };
type Deps = { cloudinary: CloudinaryConfig };

export async function loadHomeImagesAdmin(db: Db): Promise<{ images: HomeImages; categories: { slug: string; name: string }[] }> {
  const [images, cats] = await Promise.all([
    loadHomeImages(db),
    db.select({ slug: category.slug, name: category.name, visible: category.visible, sortOrder: category.sortOrder }).from(category),
  ]);
  return {
    images,
    categories: cats.filter((c) => c.visible).sort((a, b) => a.sortOrder - b.sortOrder).map((c) => ({ slug: c.slug, name: c.name })),
  };
}

/** The slot a request names, or null: a category slot must be a real, visible category. */
export async function resolveSlot(db: Db, kind: unknown, slug: unknown): Promise<HomeImageSlot | null> {
  if (kind === "hero") return { kind: "hero" };
  if (kind === "banner") return { kind: "banner" };
  if (kind !== "category" || typeof slug !== "string" || !/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const [cat] = await db.select({ slug: category.slug }).from(category).where(eq(category.slug, slug)).limit(1);
  return cat ? { kind: "category", slug: cat.slug } : null;
}

const slotName = (s: HomeImageSlot) => (s.kind === "category" ? `category:${s.slug}` : s.kind);

async function readStored(db: Db): Promise<Record<string, unknown>> {
  const [row] = await db.select({ h: settings.homeImages }).from(settings).where(eq(settings.id, 1)).limit(1);
  const o = row?.h;
  return typeof o === "object" && o !== null ? { ...o } : {};
}

export async function setHomeImage(db: Db, a: Actor, deps: Deps, slot: HomeImageSlot, bytes: Uint8Array, alt?: string | null): Promise<Result<{ photo: string }>> {
  const before = parseHomeImages(await readStored(db));
  const stored = await uploadValidatedPhoto(deps.cloudinary, bytes);
  if (!stored.ok) return { ok: false, code: "INVALID", message: PHOTO_MESSAGES[stored.error] };
  const raw = await readStored(db);
  const old = slot.kind === "hero" ? before.hero?.key : slot.kind === "banner" ? before.banner : before.categories[slot.slug];
  if (slot.kind === "hero") {
    raw.hero = stored.publicId;
    if (alt !== undefined) raw.heroAlt = (alt ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_ALT_LENGTH);
  } else if (slot.kind === "banner") {
    raw.banner = stored.publicId;
  } else {
    raw.categories = { ...(typeof raw.categories === "object" && raw.categories !== null ? raw.categories : {}), [slot.slug]: stored.publicId };
  }
  await db.batch([
    db.insert(settings).values({ id: 1, homeImages: raw }).onConflictDoUpdate({ target: settings.id, set: { homeImages: raw } }),
    auditInsert(db, a, "settings.homeImage", `home-image:${slotName(slot)}`, { photo: old ?? null }, { photo: stored.publicId }),
  ]);
  if (old && old !== stored.publicId) await deletePhotoAsset(deps.cloudinary, old);
  return { ok: true, photo: stored.publicId };
}

/** Change the hero photo's description without re-uploading it. */
export async function setHeroAlt(db: Db, a: Actor, alt: string | null): Promise<Result> {
  const raw = await readStored(db);
  const before = parseHomeImages(raw);
  if (!before.hero) return { ok: false, code: "NOT_FOUND", message: "There is no hero photo yet." };
  const clean = (alt ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_ALT_LENGTH);
  raw.heroAlt = clean;
  await db.batch([
    db.insert(settings).values({ id: 1, homeImages: raw }).onConflictDoUpdate({ target: settings.id, set: { homeImages: raw } }),
    auditInsert(db, a, "settings.homeImage.alt", "home-image:hero", { alt: before.hero.alt }, { alt: clean }),
  ]);
  return { ok: true };
}

export async function removeHomeImage(db: Db, a: Actor, deps: Deps, slot: HomeImageSlot): Promise<Result> {
  const raw = await readStored(db);
  const before = parseHomeImages(raw);
  const old = slot.kind === "hero" ? before.hero?.key : slot.kind === "banner" ? before.banner : before.categories[slot.slug];
  if (!old) return { ok: false, code: "NOT_FOUND", message: "There is no image there." };
  if (slot.kind === "hero") {
    delete raw.hero;
    delete raw.heroAlt;
  } else if (slot.kind === "banner") {
    delete raw.banner;
  } else {
    const cats = { ...(typeof raw.categories === "object" && raw.categories !== null ? (raw.categories as Record<string, unknown>) : {}) };
    delete cats[slot.slug];
    raw.categories = cats;
  }
  await db.batch([
    db.insert(settings).values({ id: 1, homeImages: raw }).onConflictDoUpdate({ target: settings.id, set: { homeImages: raw } }),
    auditInsert(db, a, "settings.homeImage.remove", `home-image:${slotName(slot)}`, { photo: old }, null),
  ]);
  await deletePhotoAsset(deps.cloudinary, old);
  return { ok: true };
}
