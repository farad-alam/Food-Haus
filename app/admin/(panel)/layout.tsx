import { Suspense } from "react";
import { AdminHeader } from "@/components/admin/admin-header";
import { requireAdminPage } from "@/lib/admin/page-auth";
import { can } from "@/lib/auth/rbac";

// Everything under (panel) needs a signed-in user. Each PAGE also calls
// requireAdminPage with its own permission: a layout alone is not a control,
// because layouts do not re-render on client-side navigation.
export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p className="p-4 text-muted" role="status">Loading…</p>}>
      <Gate>{children}</Gate>
    </Suspense>
  );
}

async function Gate({ children }: { children: React.ReactNode }) {
  const user = await requireAdminPage("orders.view");
  return (
    <>
      <AdminHeader email={user.email} role={user.role} canSettings={can(user.role, "settings.edit")} canMenu={can(user.role, "menu.edit")} canOffers={can(user.role, "offers.edit")} />
      {children}
    </>
  );
}
