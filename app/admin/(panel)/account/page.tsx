import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountSecurity } from "@/components/admin/twofa";
import { adminStore } from "@/lib/admin/guard";
import { requireAdminPage } from "@/lib/admin/page-auth";
import { requiresTwoStep } from "@/lib/auth/rbac";

export const metadata: Metadata = { title: "My account", robots: { index: false } };

export default function AccountPage({ searchParams }: { searchParams: Promise<{ recovery?: string }> }) {
  return (
    <main className="mx-auto max-w-lg px-4 py-6">
      <h1 className="font-display text-4xl">My account</h1>
      <Suspense fallback={<p className="mt-4 text-muted" role="status">Loading…</p>}>
        <Account searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Account({ searchParams }: { searchParams: Promise<{ recovery?: string }> }) {
  const user = await requireAdminPage("orders.view"); // every role may see its own page
  const store = adminStore();
  const [rec, left] = [await store.findUserById(user.id), await store.countRecoveryCodes(user.id)];
  const q = (await searchParams).recovery;
  const used = q !== undefined && /^\d{1,2}$/.test(q) ? Number(q) : null;
  return (
    <div className="mt-4">
      <p className="mb-4 text-muted">{user.email} · {user.role}</p>
      <AccountSecurity applicable={requiresTwoStep(user.role)} enrolled={!!rec?.totpSecret} recoveryLeft={left} usedRecovery={used} />
    </div>
  );
}
