import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckoutForm } from "@/components/checkout-form";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export default function CheckoutPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="font-display text-4xl">Checkout</h1>
      {/* useSearchParams (payment-cancelled notice) needs a Suspense boundary */}
      <div className="mt-4">
        <Suspense fallback={<p className="text-muted" role="status">Loading…</p>}>
          <CheckoutForm />
        </Suspense>
      </div>
    </main>
  );
}
