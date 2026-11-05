"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Access = { canSettings: boolean; canMenu: boolean; canOffers: boolean; canHistory: boolean; canReports: boolean };

export function AdminHeader({ email, role, canSettings, canMenu, canOffers, canHistory, canReports }: { email: string; role: string } & Access) {
  const [busy, setBusy] = useState(false);
  const path = usePathname();
  const nav = useRef<HTMLElement>(null);
  const isActive = (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`));
  const link = (href: string, label: string) => (
    <Link key={href} href={href} aria-current={isActive(href) ? "page" : undefined} className={`inline-flex min-h-[44px] shrink-0 items-center px-2 text-sm font-bold sm:text-base ${isActive(href) ? "text-brand" : "text-text"}`}>{label}</Link>
  );
  // Six links do not fit on a phone: the row scrolls sideways, so keep the current page in view.
  useEffect(() => {
    nav.current?.querySelector<HTMLElement>("[aria-current=page]")?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [path]);

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
    <header className="sticky top-0 z-30 border-b border-line bg-ink/95 backdrop-blur print:hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2 sm:gap-3 sm:px-4">
        <p className="hidden shrink-0 whitespace-nowrap font-display text-2xl leading-none text-brand lg:block">FOOD HAUS<span className="text-text"> ADMIN</span></p>
        <nav ref={nav} aria-label="Admin" className="flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-sm:[mask-image:linear-gradient(to_right,#000_82%,transparent)]">
          {link("/admin", "Orders")}
          {canHistory && link("/admin/history", "History")}
          {canReports && link("/admin/reports", "Reports")}
          {canMenu && link("/admin/menu", "Menu")}
          {canOffers && link("/admin/offers", "Offers")}
          {canSettings && link("/admin/settings", "Settings")}
          {link("/admin/account", "Account")}
        </nav>
        <div className="flex shrink-0 items-center gap-3 text-sm">
          <span className="hidden text-muted xl:inline">{email} · {role}</span>
          <button type="button" className="btn btn-ghost !min-h-[44px] whitespace-nowrap !px-3 !py-2 text-sm" onClick={signOut} disabled={busy}>Sign out</button>
        </div>
      </div>
    </header>
  );
}
