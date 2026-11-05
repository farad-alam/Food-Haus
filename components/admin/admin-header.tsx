"use client";

import { useState } from "react";

export function AdminHeader({ email, role }: { email: string; role: string }) {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } finally {
      // Deliberate hard navigation: picks up/drops the session cookie and discards any cached authenticated pages.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/admin/login";
    }
  }
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2">
        <p className="font-display text-2xl leading-none text-brand">FOOD HAUS <span className="text-text">ADMIN</span></p>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-muted sm:inline">{email} · {role}</span>
          <button type="button" className="btn btn-ghost !min-h-[44px] !px-4 !py-2 text-sm" onClick={signOut} disabled={busy}>Sign out</button>
        </div>
      </div>
    </header>
  );
}
