import type { Metadata } from "next";
import { ForgotForm } from "@/components/admin/reset-forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPage() {
  return (
    <main className="mx-auto max-w-sm px-4 py-12">
      <h1 className="font-display text-4xl">Reset your password</h1>
      <p className="mt-2 text-muted">Enter your email and we will send a link that works once for 30 minutes.</p>
      <div className="mt-6"><ForgotForm /></div>
    </main>
  );
}
