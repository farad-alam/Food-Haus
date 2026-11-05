import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/admin/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-sm px-4 py-12">
      <p className="font-display text-3xl text-brand">FOOD HAUS</p>
      <h1 className="font-display text-4xl">Staff sign in</h1>
      <div className="mt-6">
        <Suspense fallback={<p className="text-muted" role="status">Loading…</p>}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
