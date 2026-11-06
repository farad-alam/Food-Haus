import { Suspense } from "react";
import { AdminHeader } from "@/components/admin/admin-header";
import { AllergenWarning } from "@/components/admin/allergen-warning";
import { requireAdminPage } from "@/lib/admin/page-auth";
import { readinessFromMenu } from "@/lib/allergen-readiness";
import { can } from "@/lib/auth/rbac";
import { getMenu } from "@/lib/menu";

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
  // Owners and managers (who can fix it) see a warning on every page while any allergen data is missing.
  const readiness = can(user.role, "menu.edit") ? readinessFromMenu(await getMenu()) : null;
  return (
    <>
      <AdminHeader email={user.email} role={user.role} canSettings={can(user.role, "settings.edit")} canMenu={can(user.role, "menu.edit")} canOffers={can(user.role, "offers.edit")} canHistory={can(user.role, "orders.history")} canReports={can(user.role, "reports.view")} />
      {readiness && <AllergenWarning readiness={readiness} />}
      {children}
    </>
  );
}
