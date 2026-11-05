import type { Metadata } from "next";
import { Suspense } from "react";
import { SetupFlow } from "@/components/admin/twofa";

export const metadata: Metadata = { title: "Set up two-step login", robots: { index: false } };

export default function SetupPage({ params }: { params: Promise<{ token: string }> }) {
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
