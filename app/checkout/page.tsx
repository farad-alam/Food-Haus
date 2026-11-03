import Link from "next/link";

// Week-2 work (requirements sections 6 and 8): details form, server-side
// totals, Stripe Checkout + webhook, cash orders. Placeholder until then.
export default function CheckoutPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="font-display text-5xl">Checkout</h1>
      <p className="mt-2 text-muted">Online checkout is being built. Please call the shop to place your order.</p>
      <p className="mt-6"><Link href="/menu" className="btn btn-primary">Back to the menu</Link></p>
    </main>
  );
}
