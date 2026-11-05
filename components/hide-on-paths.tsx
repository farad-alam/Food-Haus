"use client";

import { usePathname } from "next/navigation";

/** Renders its children everywhere except on pages that already say it themselves. */
export function HideOnPaths({ prefixes, children }: { prefixes: string[]; children: React.ReactNode }) {
  const path = usePathname();
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`)) ? null : <>{children}</>;
}
