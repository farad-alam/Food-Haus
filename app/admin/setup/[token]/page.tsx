import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SetupFlow } from "@/components/admin/twofa";
import { twoStepEnabled } from "@/lib/auth/config";

export const metadata: Metadata = { title: "Set up two-step login", robots: { index: false } };

// Two-step login is off by default (ADMIN_TWO_STEP): there is nothing to set up, so old links go to the sign-in page.
export default async function SetupPage({ params }: { params: Promise<{ token: string }> }) {
  await connection(); // reads a runtime setting: never prerendered
  if (!twoStepEnabled()) redirect("/admin/login");
  return (
    <main className="mx-auto max-w-sm px-4 py-12">
      <h1 className="font-display text-4xl">Set up two-step login</h1>
      <div className="mt-6">
        <Suspense fallback={<p className="text-muted" role="status">Loading…</p>}>
          <Flow params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function Flow({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SetupFlow token={token} />;
}
