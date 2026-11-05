import { z } from "zod";
import { guard, jsonResponse } from "@/lib/admin/guard";
import { applyOrderAction, ORDER_ACTIONS } from "@/lib/admin/orders";
import { getDb } from "@/lib/db/client";

// POST /api/admin/orders/[id]: accept / reject / ready / out_for_delivery /
// completed (R9.5). Authorised and CSRF-checked here, every time.
const body = z.strictObject({
  action: z.enum(ORDER_ACTIONS as unknown as [string, ...string[]]),
  prepMinutes: z.number().int().min(1).max(180).optional(),
  reason: z.string().trim().max(200).optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard(request, "orders.update");
  if ("response" in g) return g.response;

  const { id } = await ctx.params;
  if (!/^\d{1,9}$/.test(id)) return jsonResponse(404, { ok: false, code: "NOT_FOUND" });
  let parsed: z.infer<typeof body>;
  try {
    const raw = await request.text();
    if (raw.length > 2_000) throw new Error("large");
    parsed = body.parse(JSON.parse(raw));
  } catch {
    return jsonResponse(400, { ok: false, code: "VALIDATION", message: "Invalid request." });
  }
  try {
    const r = await applyOrderAction(getDb(), {
      orderId: Number(id),
      action: parsed.action as (typeof ORDER_ACTIONS)[number],
      prepMinutes: parsed.prepMinutes,
      reason: parsed.reason,
      userId: g.user.id,
      now: new Date(),
    });
    if (r.ok) return jsonResponse(200, r);
    return jsonResponse(r.code === "NOT_FOUND" ? 404 : r.code === "INVALID" ? 400 : 409, r);
  } catch (e) {
    console.error("order action failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR", message: "Something went wrong. Please try again." });
  }
}
