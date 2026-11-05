import { adminRoute } from "@/lib/admin/route";
import { deleteOffer, updateOffer } from "@/lib/admin/offers";
import { offerSchema } from "@/lib/admin/offer-schema";
import { getDb } from "@/lib/db/client";

export const PUT = adminRoute({
  permission: "offers.edit",
  schema: offerSchema,
  idParam: "id",
  refreshOffers: true,
  run: ({ user, id, data }) => updateOffer(getDb(), { userId: user.id, now: new Date() }, id, data),
});

export const DELETE = adminRoute({
  permission: "offers.edit",
  schema: null,
  idParam: "id",
  refreshOffers: true,
  run: ({ user, id }) => deleteOffer(getDb(), { userId: user.id, now: new Date() }, id),
});
