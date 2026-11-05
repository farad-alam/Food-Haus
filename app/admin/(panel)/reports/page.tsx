import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardView } from "@/components/admin/dashboard";
import { requireAdminPage } from "@/lib/admin/page-auth";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-muted" role="status">Loading…</p>}>
      <Reports />
    </Suspense>
  );
}

async function Reports() {
  await requireAdminPage("reports.view"); // owner and manager only; kitchen gets a 404
  return <DashboardView />;
}
