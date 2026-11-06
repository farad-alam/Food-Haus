import type { Metadata } from "next";
import { CookiePreferences } from "@/components/cookie-consent";
import { LegalPage } from "@/components/legal";
import { validGaId } from "@/lib/consent";
import { cookiePolicy, LEGAL_APPROVED } from "@/lib/legal";

// DRAFT until the owner approves it (R11.12): lib/legal.ts holds the text and the list of open decisions.
export const metadata: Metadata = {
  title: "Cookie Policy",
  alternates: { canonical: "/cookies" },
  robots: LEGAL_APPROVED ? undefined : { index: false, follow: true },
};

export default function Page() {
  return (
    <LegalPage doc={cookiePolicy}>
      <CookiePreferences analyticsId={validGaId(process.env.NEXT_PUBLIC_GA_ID)} />
    </LegalPage>
  );
}
