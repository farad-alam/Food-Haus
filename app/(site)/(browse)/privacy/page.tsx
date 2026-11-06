import type { Metadata } from "next";
import { LegalPage } from "@/components/legal";
import { LEGAL_APPROVED, privacyPolicy } from "@/lib/legal";

// DRAFT until the owner approves it (R11.12): lib/legal.ts holds the text and the list of open decisions.
export const metadata: Metadata = {
  title: "Privacy Policy",
  alternates: { canonical: "/privacy" },
  robots: LEGAL_APPROVED ? undefined : { index: false, follow: true },
};

export default function Page() {
  return <LegalPage doc={privacyPolicy} />;
}
