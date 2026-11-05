import { adminRoute } from "@/lib/admin/route";
import { deleteCategory, updateCategory } from "@/lib/admin/menu";
import { categorySchema } from "@/lib/admin/menu-schema";
import { getDb } from "@/lib/db/client";

export const PUT = adminRoute({
  permission: "menu.edit",
  schema: categorySchema,
  idParam: "id",
  refreshMenu: true,
  run: ({ user, id, data }) => updateCategory(getDb(), { userId: user.id, now: new Date() }, id, data),
});

export const DELETE = adminRoute({
  permission: "menu.edit",
  schema: null,
  idParam: "id",
  refreshMenu: true,
  run: ({ user, id }) => deleteCategory(getDb(), { userId: user.id, now: new Date() }, id),
});
