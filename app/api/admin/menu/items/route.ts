import { adminRoute } from "@/lib/admin/route";
import { createItem } from "@/lib/admin/menu";
import { itemSchema } from "@/lib/admin/menu-schema";
import { getDb } from "@/lib/db/client";

export const POST = adminRoute({
  permission: "menu.edit",
  schema: itemSchema,
  refreshMenu: true,
  successStatus: 201,
  run: ({ user, data }) => createItem(getDb(), { userId: user.id, now: new Date() }, data),
});
