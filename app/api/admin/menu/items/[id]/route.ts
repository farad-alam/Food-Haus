import { adminRoute } from "@/lib/admin/route";
import { deleteItem, patchItemFlags, updateItem } from "@/lib/admin/menu";
import { itemFlagsSchema, itemSchema } from "@/lib/admin/menu-schema";
import { getDb } from "@/lib/db/client";

export const PUT = adminRoute({
  permission: "menu.edit",
  schema: itemSchema,
  idParam: "id",
  refreshMenu: true,
  run: ({ user, id, data }) => updateItem(getDb(), { userId: user.id, now: new Date() }, id, data),
});

// PATCH: the one-tap sold-out / hidden switches (R6.3).
export const PATCH = adminRoute({
  permission: "menu.edit",
  schema: itemFlagsSchema,
  idParam: "id",
  refreshMenu: true,
  run: ({ user, id, data }) => patchItemFlags(getDb(), { userId: user.id, now: new Date() }, id, data),
});

export const DELETE = adminRoute({
  permission: "menu.edit",
  schema: null,
  idParam: "id",
  refreshMenu: true,
  run: ({ user, id }) => deleteItem(getDb(), { userId: user.id, now: new Date() }, id),
});
