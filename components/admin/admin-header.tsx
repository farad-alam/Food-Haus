"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export function AdminHeader({ email, role, canSettings, canMenu }: { email: string; role: string; canSettings: boolean; canMenu: boolean }) {
  const [busy, setBusy] = useState(false);
  const path = usePathname();
  const link = (href: string, label: string) => (
    <Link href={href} aria-current={path === href ? "page" : undefined} className={`inline-flex min-h-[44px] items-center px-2 font-bold ${path === href ? "text-brand" : "text-text"}`}>{label}</Link>
  );
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
        <p className="whitespace-nowrap font-display text-2xl leading-none text-brand">FOOD HAUS<span className="hidden text-text sm:inline"> ADMIN</span></p>
        <nav aria-label="Admin" className="flex items-center">
          {link("/admin", "Orders")}
          {canMenu && link("/admin/menu", "Menu")}
          {canSettings && link("/admin/settings", "Settings")}
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-muted sm:inline">{email} · {role}</span>
          <button type="button" className="btn btn-ghost !min-h-[44px] whitespace-nowrap !px-3 !py-2 text-sm" onClick={signOut} disabled={busy}>Sign out</button>
        </div>
      </div>
    </header>
  );
}
