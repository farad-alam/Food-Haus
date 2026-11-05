import type { z } from "zod";
import { guard, jsonResponse, type AdminUser } from "./guard";
import { idFromParam, readJson, statusFor } from "./http";
import { refreshMenuCache, refreshOffersCache } from "@/lib/menu-cache";
import type { Result } from "./settings";

// One wrapper for a state-changing admin route: authorise + origin-check, read
// and validate the body, run the change, map the result to a status code, and
// refresh the public menu cache when asked. Keeps every route to the same
// sequence, so none can forget a step.
type Ctx = { params: Promise<Record<string, string>> };

export function adminRoute<S extends z.ZodType | null, T extends object = object>(opts: {
  permission: Parameters<typeof guard>[1];
  schema: S;
  /** Name of the numeric route param (e.g. "id"); a malformed value is a 404. */
  idParam?: string;
  refreshMenu?: boolean;
  refreshOffers?: boolean;
  successStatus?: number;
  run: (c: { user: AdminUser; id: number; data: S extends z.ZodType ? z.infer<S> : undefined }) => Promise<Result<T>>;
}) {
  return async function handler(request: Request, ctx?: Ctx): Promise<Response> {
    const g = await guard(request, opts.permission);
    if ("response" in g) return g.response;

    let id = 0;
    if (opts.idParam) {
      const parsed = idFromParam((await ctx!.params)[opts.idParam] ?? "");
      if (parsed === null) return jsonResponse(404, { ok: false, code: "NOT_FOUND" });
      id = parsed;
    }
    let data: never = undefined as never;
    if (opts.schema) {
      const b = await readJson(request, opts.schema as z.ZodType, 20_000);
      if ("response" in b) return b.response;
      data = b.data as never;
    }
    try {
      const r = await opts.run({ user: g.user, id, data });
      if (!r.ok) return jsonResponse(statusFor(r.code), r);
      if (opts.refreshMenu) refreshMenuCache();
      if (opts.refreshOffers) refreshOffersCache();
      return jsonResponse(opts.successStatus ?? 200, r);
    } catch (e) {
      console.error("admin route failed", e instanceof Error ? e.message : e);
      return jsonResponse(500, { ok: false, code: "SERVER_ERROR", message: "Something went wrong. Please try again." });
    }
  };
}
