import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetForm } from "@/components/admin/reset-forms";

export const metadata: Metadata = { title: "Set a new password" };

export default function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <main className="mx-auto max-w-sm px-4 py-12">
      <h1 className="font-display text-4xl">Set a new password</h1>
      <div className="mt-6">
        <Suspense fallback={<p className="text-muted" role="status">Loading…</p>}>
          <Form params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function Form({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ResetForm token={token} />;
}
