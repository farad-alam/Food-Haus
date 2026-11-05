import { adminRoute } from "@/lib/admin/route";
import { createCategory } from "@/lib/admin/menu";
import { categorySchema } from "@/lib/admin/menu-schema";
import { getDb } from "@/lib/db/client";

export const POST = adminRoute({
  permission: "menu.edit",
  schema: categorySchema,
  refreshMenu: true,
  successStatus: 201,
  run: ({ user, data }) => createCategory(getDb(), { userId: user.id, now: new Date() }, data),
});
