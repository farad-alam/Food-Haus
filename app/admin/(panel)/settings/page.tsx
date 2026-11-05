import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsPanel } from "@/components/admin/settings-panel";
import { requireAdminPage } from "@/lib/admin/page-auth";

export const metadata: Metadata = { title: "Shop settings" };

export default function SettingsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-muted" role="status">Loading…</p>}>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  await requireAdminPage("settings.edit"); // owner and manager only; kitchen gets a 404
  return <SettingsPanel />;
}
