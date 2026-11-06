import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { LegalPage } from "@/components/legal";
import { LEGAL_APPROVED, termsPolicy } from "@/lib/legal";

// DRAFT until the owner approves it (R11.12): lib/legal.ts holds the text and the list of open decisions.
export const metadata: Metadata = pageMetadata({ title: "Terms & Cancellation Policy", description: "How ordering from Food Haus works: orders, payment, delivery and collection, cancellations and refunds.", path: "/terms", noindex: !LEGAL_APPROVED });

export default function Page() {
  return <LegalPage doc={termsPolicy} />;
}
