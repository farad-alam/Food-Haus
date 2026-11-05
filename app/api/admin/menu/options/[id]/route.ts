import { adminRoute } from "@/lib/admin/route";
import { deleteOptionGroup, saveOptionGroup } from "@/lib/admin/menu";
import { optionGroupSchema } from "@/lib/admin/menu-schema";
import { getDb } from "@/lib/db/client";

// [id] is the CATEGORY id: one option group per category ("Make it a Meal").
export const PUT = adminRoute({
  permission: "menu.edit",
  schema: optionGroupSchema,
  idParam: "id",
  refreshMenu: true,
  run: ({ user, id, data }) => saveOptionGroup(getDb(), { userId: user.id, now: new Date() }, id, data),
});

export const DELETE = adminRoute({
  permission: "menu.edit",
  schema: null,
  idParam: "id",
  refreshMenu: true,
  run: ({ user, id }) => deleteOptionGroup(getDb(), { userId: user.id, now: new Date() }, id),
});
