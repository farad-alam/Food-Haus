"use client";

import Link from "next/link";

// R13.9: visitors never see a raw error page.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="font-display text-5xl">Something went wrong</h1>
      <p className="mt-2 text-muted">Please try again, or call the shop to order.</p>
      <p className="mt-6 flex flex-wrap justify-center gap-3">
        <button type="button" className="btn btn-primary" onClick={reset}>Try again</button>
        <Link href="/menu" className="btn btn-ghost">Back to the menu</Link>
      </p>
    </main>
  );
}
