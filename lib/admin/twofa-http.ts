import type { z } from "zod";
import { jsonResponse, trustedOrigin } from "./guard";

/** Shared request checks for the 2FA routes: same-origin, JSON, small body, schema. */
export async function readJson<T extends z.ZodType>(request: Request, schema: T): Promise<{ data: z.infer<T> } | { response: Response }> {
  if (!trustedOrigin(request)) return { response: jsonResponse(403, { ok: false, code: "CROSS_SITE" }) };
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return { response: jsonResponse(415, { ok: false, code: "BAD_CONTENT_TYPE" }) };
  }
  const raw = await request.text();
  if (raw.length > 4_000) return { response: jsonResponse(413, { ok: false, code: "TOO_LARGE" }) };
  try {
    return { data: schema.parse(JSON.parse(raw)) };
  } catch {
    return { response: jsonResponse(400, { ok: false, code: "VALIDATION", message: "Please fill in every box." }) };
  }
}

export const clientIp = (request: Request) => request.headers.get("cf-connecting-ip") ?? "unknown"; // only Cloudflare's header is trusted

export const SERVER_ERROR = () => jsonResponse(500, { ok: false, code: "SERVER_ERROR", message: "Something went wrong. Please try again." });

export const MESSAGES = {
  locked: "Too many attempts. Please wait 15 minutes and try again.",
  setup_invalid: "That setup link, email or password is not right, or the link has expired or been used. Ask the owner for a new link.",
  invalid_credentials: "Your password is incorrect.",
  invalid_code: "That code is wrong or has already been used. Wait for a new code and try again.",
  no_pending: "That QR code has expired. Start again to get a new one.",
  link_used: "This setup link has already been used. Ask the owner for a new one.",
} as const;
