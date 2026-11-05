import { adminRoute } from "@/lib/admin/route";
import { reorderItems } from "@/lib/admin/menu";
import { itemReorderSchema } from "@/lib/admin/menu-schema";
import { getDb } from "@/lib/db/client";

export const POST = adminRoute({
  permission: "menu.edit",
  schema: itemReorderSchema,
  refreshMenu: true,
  run: ({ user, data }) => reorderItems(getDb(), { userId: user.id, now: new Date() }, data.categoryId, data.ids),
});
