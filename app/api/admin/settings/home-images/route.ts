import { guard, jsonResponse } from "@/lib/admin/guard";
import { loadHomeImagesAdmin, removeHomeImage, resolveSlot, setHeroAlt, setHomeImage } from "@/lib/admin/home-images";
import { readJson, statusFor } from "@/lib/admin/http";
import { getDb } from "@/lib/db/client";
import { refreshSettingsCache } from "@/lib/menu-cache";
import { getPhotoCloudName, PHOTO_SERVICE_MESSAGE, PHOTO_SETUP_MESSAGE, PhotoSetupError, requireCloudinary } from "@/lib/photos";
import { PhotoServiceError } from "@/lib/photos/cloudinary";
import { MAX_ALT_LENGTH, MAX_UPLOAD_BYTES } from "@/lib/photos/types";
import { z } from "zod";

// GET    the home page images, the categories they can be set for, and the Cloudinary cloud name
// POST   multipart: `slot` ("hero" | "category"), `slug` (for category), `file`, `alt` (hero only)
// DELETE JSON { slot, slug? }: remove an image (and its Cloudinary asset)
// Settings editors only (owner and manager). Same checks and signed upload as item photos (R5.1, R9.7, R10.5).

const fail = (e: unknown, what: string) => {
  if (e instanceof PhotoSetupError) return jsonResponse(501, { ok: false, code: "PHOTOS_NOT_CONFIGURED", message: PHOTO_SETUP_MESSAGE });
  if (e instanceof PhotoServiceError) {
    console.error(`${what}: cloudinary unavailable`, e.status, e.message);
    return jsonResponse(502, { ok: false, code: "PHOTO_SERVICE_FAILED", message: PHOTO_SERVICE_MESSAGE });
  }
  console.error(`${what} failed`, e instanceof Error ? e.message : e);
  return jsonResponse(500, { ok: false, code: "SERVER_ERROR", message: "Something went wrong. Please try again." });
};

export async function GET(request: Request) {
  const g = await guard(request, "settings.edit");
  if ("response" in g) return g.response;
  try {
    return jsonResponse(200, { ok: true, ...(await loadHomeImagesAdmin(getDb())), photoCloud: getPhotoCloudName() });
  } catch (e) {
    return fail(e, "home images load");
  }
}

export async function POST(request: Request) {
  const g = await guard(request, "settings.edit");
  if ("response" in g) return g.response;
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) return jsonResponse(415, { ok: false, code: "BAD_CONTENT_TYPE", message: "Choose a photo to upload." });
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES + 100_000) return jsonResponse(413, { ok: false, code: "TOO_LARGE", message: `That file is too big. Photos can be up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse(400, { ok: false, code: "VALIDATION", message: "Choose a photo to upload." });
  }
  const file = form.get("file");
  const alt = form.get("alt");
  if (alt !== null && typeof alt !== "string") return jsonResponse(400, { ok: false, code: "VALIDATION", message: "The description is too long." });
  if (!(file instanceof File) || file.size === 0) {
    // No file but a description for the existing hero photo: change the description alone.
    if (form.get("slot") === "hero" && typeof alt === "string") {
      try {
        const r = await setHeroAlt(getDb(), { userId: g.user.id, now: new Date() }, alt.slice(0, MAX_ALT_LENGTH * 2));
        if (!r.ok) return jsonResponse(statusFor(r.code), r);
        refreshSettingsCache();
        return jsonResponse(200, r);
      } catch (e) {
        return fail(e, "home image alt");
      }
    }
    return jsonResponse(400, { ok: false, code: "VALIDATION", message: "Choose a photo to upload." });
  }
  if (alt !== null && (typeof alt !== "string" || alt.length > MAX_ALT_LENGTH * 2)) return jsonResponse(400, { ok: false, code: "VALIDATION", message: "The description is too long." });
  try {
    const db = getDb();
    const slot = await resolveSlot(db, form.get("slot"), form.get("slug"));
    if (!slot) return jsonResponse(400, { ok: false, code: "VALIDATION", message: "Choose where this image goes." });
    const r = await setHomeImage(db, { userId: g.user.id, now: new Date() }, { cloudinary: requireCloudinary() }, slot, new Uint8Array(await file.arrayBuffer()), slot.kind === "hero" && alt !== null ? String(alt) : undefined);
    if (!r.ok) return jsonResponse(statusFor(r.code), r);
    refreshSettingsCache();
    return jsonResponse(200, r);
  } catch (e) {
    return fail(e, "home image upload");
  }
}

const deleteBody = z.strictObject({ slot: z.enum(["hero", "banner", "category"]), slug: z.string().max(80).optional() });

export async function DELETE(request: Request) {
  const g = await guard(request, "settings.edit");
  if ("response" in g) return g.response;
  const b = await readJson(request, deleteBody, 1_000);
  if ("response" in b) return b.response;
  try {
    const db = getDb();
    const slot = await resolveSlot(db, b.data.slot, b.data.slug);
    if (!slot) return jsonResponse(400, { ok: false, code: "VALIDATION", message: "Choose where this image goes." });
    const r = await removeHomeImage(db, { userId: g.user.id, now: new Date() }, { cloudinary: requireCloudinary() }, slot);
    if (!r.ok) return jsonResponse(statusFor(r.code), r);
    refreshSettingsCache();
    return jsonResponse(200, r);
  } catch (e) {
    return fail(e, "home image remove");
  }
}
