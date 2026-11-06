import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { CookiePreferences } from "@/components/cookie-consent";
import { LegalPage } from "@/components/legal";
import { validGaId } from "@/lib/consent";
import { cookiePolicy, LEGAL_APPROVED } from "@/lib/legal";

// DRAFT until the owner approves it (R11.12): lib/legal.ts holds the text and the list of open decisions.
export const metadata: Metadata = pageMetadata({ title: "Cookie Policy", description: "The cookies and browser storage the Food Haus website uses, and how to accept or reject analytics cookies.", path: "/cookies", noindex: !LEGAL_APPROVED });

export default function Page() {
  return (
    <LegalPage doc={cookiePolicy}>
      <CookiePreferences analyticsId={validGaId(process.env.NEXT_PUBLIC_GA_ID)} />
    </LegalPage>
  );
}
