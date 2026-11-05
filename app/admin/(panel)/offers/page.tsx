import type { Metadata } from "next";
import { Suspense } from "react";
import { OffersManager } from "@/components/admin/offers-manager";
import { requireAdminPage } from "@/lib/admin/page-auth";

export const metadata: Metadata = { title: "Offers" };

export default function OffersPage() {
  return (
    <Suspense fallback={<p className="p-4 text-muted" role="status">Loading…</p>}>
      <Offers />
    </Suspense>
  );
}

async function Offers() {
  await requireAdminPage("offers.edit"); // owner and manager only; kitchen gets a 404
  return <OffersManager />;
}
