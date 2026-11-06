import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { LegalPage } from "@/components/legal";
import { LEGAL_APPROVED, privacyPolicy } from "@/lib/legal";

// DRAFT until the owner approves it (R11.12): lib/legal.ts holds the text and the list of open decisions.
export const metadata: Metadata = pageMetadata({ title: "Privacy Policy", description: "How Food Haus collects, uses and protects your personal information when you order online, and your choices.", path: "/privacy", noindex: !LEGAL_APPROVED });

export default function Page() {
  return <LegalPage doc={privacyPolicy} />;
}
