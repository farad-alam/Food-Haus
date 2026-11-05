import type { Metadata } from "next";
import { Suspense } from "react";
import { MenuManager } from "@/components/admin/menu-manager";
import { requireAdminPage } from "@/lib/admin/page-auth";

export const metadata: Metadata = { title: "Menu" };

export default function MenuPage() {
  return (
    <Suspense fallback={<p className="p-4 text-muted" role="status">Loading…</p>}>
      <Menu />
    </Suspense>
  );
}

async function Menu() {
  await requireAdminPage("menu.edit"); // owner and manager only; kitchen gets a 404
  return <MenuManager />;
}
