import { adminRoute } from "@/lib/admin/route";
import { guard, jsonResponse } from "@/lib/admin/guard";
import { createOffer, loadOffersAdmin } from "@/lib/admin/offers";
import { offerSchema } from "@/lib/admin/offer-schema";
import { getDb } from "@/lib/db/client";

// GET /api/admin/offers: all offers with status and usage (R9.8).
export async function GET(request: Request) {
  const g = await guard(request, "offers.edit");
  if ("response" in g) return g.response;
  try {
    return jsonResponse(200, { ok: true, ...(await loadOffersAdmin(getDb(), new Date())) });
  } catch (e) {
    console.error("offers load failed", e instanceof Error ? e.message : e);
    return jsonResponse(500, { ok: false, code: "SERVER_ERROR" });
  }
}

export const POST = adminRoute({
  permission: "offers.edit",
  schema: offerSchema,
  refreshOffers: true,
  successStatus: 201,
  run: ({ user, data }) => createOffer(getDb(), { userId: user.id, now: new Date() }, data),
});
