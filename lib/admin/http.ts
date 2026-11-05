import type { z } from "zod";
import { jsonResponse } from "./guard";

/** Reads a size-capped JSON body and validates it against a strict schema. */
export async function readJson<T extends z.ZodType>(
  request: Request,
  schema: T,
  maxBytes = 4_000,
): Promise<{ data: z.infer<T> } | { response: Response }> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { response: jsonResponse(400, { ok: false, code: "VALIDATION", message: "Invalid request." }) };
  }
  if (raw.length > maxBytes) return { response: jsonResponse(413, { ok: false, code: "TOO_LARGE", message: "Request too large." }) };
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    if (parsed.success) return { data: parsed.data };
    return { response: jsonResponse(400, { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Invalid request." }) };
  } catch {
    return { response: jsonResponse(400, { ok: false, code: "VALIDATION", message: "Invalid JSON." }) };
  }
}

export const idFromParam = (s: string): number | null => (/^\d{1,9}$/.test(s) ? Number(s) : null);
export const statusFor = (code: "INVALID" | "NOT_FOUND" | "DUPLICATE") => (code === "NOT_FOUND" ? 404 : code === "DUPLICATE" ? 409 : 400);
