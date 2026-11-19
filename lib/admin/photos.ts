import { eq } from "drizzle-orm";
import { item } from "@/db/schema";
import type { Db } from "@/lib/db/client";
import type { CloudinaryConfig } from "@/lib/photos/cloudinary";
import { deletePhotoAsset, PHOTO_MESSAGES, uploadValidatedPhoto } from "@/lib/photos/pipeline";
import { MAX_ALT_LENGTH } from "@/lib/photos/types";
import { auditInsert, type Actor } from "./audit";
import type { Result } from "./settings";

// Menu photos (R9.7, R10.5, R11.15). Every change is audited with its before and after.

type Deps = { cloudinary: CloudinaryConfig };

const cleanAlt = (alt: string | null | undefined) => {
  const t = (alt ?? "").trim().replace(/\s+/g, " ");
  return t ? t.slice(0, MAX_ALT_LENGTH) : null;
};

export async function setItemPhoto(db: Db, a: Actor, deps: Deps, itemId: number, bytes: Uint8Array, alt?: string | null): Promise<Result<{ photo: string }>> {
  const [before] = await db.select({ photo: item.photo, photoAlt: item.photoAlt }).from(item).where(eq(item.id, itemId)).limit(1);
  if (!before) return { ok: false, code: "NOT_FOUND", message: "Item not found." };
  const stored = await uploadValidatedPhoto(deps.cloudinary, bytes); // uploaded first, so nothing ever points at a missing photo
  if (!stored.ok) return { ok: false, code: "INVALID", message: PHOTO_MESSAGES[stored.error] };
  const photoAlt = alt === undefined ? before.photoAlt : cleanAlt(alt);
  await db.batch([
    db.update(item).set({ photo: stored.publicId, photoAlt }).where(eq(item.id, itemId)),
    auditInsert(db, a, "menu.item.photo", `item:${itemId}`, before, { photo: stored.publicId, photoAlt }),
  ]);
  if (before.photo && before.photo !== stored.publicId) await deletePhotoAsset(deps.cloudinary, before.photo);
  return { ok: true, photo: stored.publicId };
}

export async function setPhotoAlt(db: Db, a: Actor, itemId: number, alt: string | null): Promise<Result> {
  const [before] = await db.select({ photo: item.photo, photoAlt: item.photoAlt }).from(item).where(eq(item.id, itemId)).limit(1);
  if (!before) return { ok: false, code: "NOT_FOUND", message: "Item not found." };
  const photoAlt = cleanAlt(alt);
  await db.batch([db.update(item).set({ photoAlt }).where(eq(item.id, itemId)), auditInsert(db, a, "menu.item.photo.alt", `item:${itemId}`, { photoAlt: before.photoAlt }, { photoAlt })]);
  return { ok: true };
}

export async function removeItemPhoto(db: Db, a: Actor, deps: Deps, itemId: number): Promise<Result> {
  const [before] = await db.select({ photo: item.photo, photoAlt: item.photoAlt }).from(item).where(eq(item.id, itemId)).limit(1);
  if (!before) return { ok: false, code: "NOT_FOUND", message: "Item not found." };
  if (!before.photo) return { ok: false, code: "NOT_FOUND", message: "This item has no photo." };
  await db.batch([db.update(item).set({ photo: null, photoAlt: null }).where(eq(item.id, itemId)), auditInsert(db, a, "menu.item.photo.remove", `item:${itemId}`, before, null)]);
  await deletePhotoAsset(deps.cloudinary, before.photo);
  return { ok: true };
}
