import { z } from "zod";
import { guard, jsonResponse } from "@/lib/admin/guard";
import { idFromParam, readJson, statusFor } from "@/lib/admin/http";
import { removeItemPhoto, setItemPhoto, setPhotoAlt } from "@/lib/admin/photos";
import { getDb } from "@/lib/db/client";
import { refreshMenuCache } from "@/lib/menu-cache";
import { PHOTO_SERVICE_MESSAGE, PHOTO_SETUP_MESSAGE, PhotoSetupError, requireCloudinary } from "@/lib/photos";
import { PhotoServiceError } from "@/lib/photos/cloudinary";
import { MAX_ALT_LENGTH, MAX_UPLOAD_BYTES } from "@/lib/photos/types";

// POST   multipart: `file` (JPEG, PNG or WebP) and optional `alt`: upload or replace the photo
// PUT    JSON { alt }: change the alt text only
// DELETE remove the photo
// Menu editors only (owner and manager). The file is checked on the server (real type from its bytes, size,
// minimum dimensions) and then uploaded to Cloudinary with a signed request; nothing the browser says about
// the file (name, type) is trusted, and the browser never talks to Cloudinary or sees any credential.
type Ctx = { params: Promise<{ id: string }> };

const fail = (e: unknown, what: string) => {
  if (e instanceof PhotoSetupError) return jsonResponse(501, { ok: false, code: "PHOTOS_NOT_CONFIGURED", message: PHOTO_SETUP_MESSAGE });
  if (e instanceof PhotoServiceError) {
    console.error(`${what}: cloudinary unavailable`, e.status, e.message);
    return jsonResponse(502, { ok: false, code: "PHOTO_SERVICE_FAILED", message: PHOTO_SERVICE_MESSAGE });
  }
  console.error(`${what} failed`, e instanceof Error ? e.message : e);
  return jsonResponse(500, { ok: false, code: "SERVER_ERROR", message: "Something went wrong. Please try again." });
};

export async function POST(request: Request, ctx: Ctx) {
  const g = await guard(request, "menu.edit");
  if ("response" in g) return g.response;
  const id = idFromParam((await ctx.params).id);
  if (id === null) return jsonResponse(404, { ok: false, code: "NOT_FOUND" });
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
  if (!(file instanceof File) || file.size === 0) return jsonResponse(400, { ok: false, code: "VALIDATION", message: "Choose a photo to upload." });
  if (alt !== null && (typeof alt !== "string" || alt.length > MAX_ALT_LENGTH * 2)) return jsonResponse(400, { ok: false, code: "VALIDATION", message: "The description is too long." });
  try {
    const r = await setItemPhoto(getDb(), { userId: g.user.id, now: new Date() }, { cloudinary: requireCloudinary() }, id, new Uint8Array(await file.arrayBuffer()), alt === null ? undefined : alt);
    if (!r.ok) return jsonResponse(statusFor(r.code), r);
    refreshMenuCache();
    return jsonResponse(200, r);
  } catch (e) {
    return fail(e, "photo upload");
  }
}

export async function PUT(request: Request, ctx: Ctx) {
  const g = await guard(request, "menu.edit");
  if ("response" in g) return g.response;
  const id = idFromParam((await ctx.params).id);
  if (id === null) return jsonResponse(404, { ok: false, code: "NOT_FOUND" });
  const b = await readJson(request, z.strictObject({ alt: z.string().max(MAX_ALT_LENGTH * 2).nullable() }));
  if ("response" in b) return b.response;
  try {
    const r = await setPhotoAlt(getDb(), { userId: g.user.id, now: new Date() }, id, b.data.alt);
    if (!r.ok) return jsonResponse(statusFor(r.code), r);
    refreshMenuCache();
    return jsonResponse(200, r);
  } catch (e) {
    return fail(e, "photo alt");
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  const g = await guard(request, "menu.edit");
  if ("response" in g) return g.response;
  const id = idFromParam((await ctx.params).id);
  if (id === null) return jsonResponse(404, { ok: false, code: "NOT_FOUND" });
  try {
    const r = await removeItemPhoto(getDb(), { userId: g.user.id, now: new Date() }, { cloudinary: requireCloudinary() }, id);
    if (!r.ok) return jsonResponse(statusFor(r.code), r);
    refreshMenuCache();
    return jsonResponse(200, r);
  } catch (e) {
    return fail(e, "photo remove");
  }
}
