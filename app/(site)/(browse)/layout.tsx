import { Suspense } from "react";
import { ShopStatusBanner, ShopStatusSlot } from "@/components/shop-status";

// Pages for looking around (home, menu, offers, contact...). They show whether
// the shop is taking orders (R6.8, R5.1). Checkout and order tracking live in
// the sibling group and deliberately do not: checkout says it on the form and
// on its button. The strip has a constant height and is already in the static
// page, so the status streaming in afterwards shifts nothing.
export default function BrowseLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={<ShopStatusSlot />}>
        <ShopStatusBanner />
      </Suspense>
      {children}
    </>
  );
}
