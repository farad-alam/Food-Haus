import { adminRoute } from "@/lib/admin/route";
import { reorderCategories } from "@/lib/admin/menu";
import { reorderSchema } from "@/lib/admin/menu-schema";
import { getDb } from "@/lib/db/client";

export const POST = adminRoute({
  permission: "menu.edit",
  schema: reorderSchema,
  refreshMenu: true,
  run: ({ user, data }) => reorderCategories(getDb(), { userId: user.id, now: new Date() }, data.ids),
});
