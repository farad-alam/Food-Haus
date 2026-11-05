import type { Metadata } from "next";
import { Suspense } from "react";
import { HistoryView } from "@/components/admin/history";
import { requireAdminPage } from "@/lib/admin/page-auth";
import { can } from "@/lib/auth/rbac";

export const metadata: Metadata = { title: "Order history" };

export default function HistoryPage() {
  return (
    <Suspense fallback={<p className="p-4 text-muted" role="status">Loading…</p>}>
      <History />
    </Suspense>
  );
}

async function History() {
  const user = await requireAdminPage("orders.history"); // owner and manager only; kitchen gets a 404
  return <HistoryView canExport={can(user.role, "orders.export")} />;
}
