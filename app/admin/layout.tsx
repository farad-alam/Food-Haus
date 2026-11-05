import type { Metadata } from "next";

// The admin panel is never indexed or cached (R11.4); the real protection is
// the login (R9.1), checked on the server for every page and every action.
export const metadata: Metadata = {
  title: { default: "Admin", template: "%s | Food Haus admin" },
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex-1">{children}</div>;
}
