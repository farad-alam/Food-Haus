"use client";

import { useEffect } from "react";
import { purchaseEvent, track, viewMenuEvent } from "@/lib/analytics-events";
import { useConsent } from "@/lib/consent-store";

/** view_menu: once per visit to the menu page, if analytics is accepted. */
export function TrackMenuView() {
  const consent = useConsent();
  useEffect(() => {
    if (consent === "granted") track(viewMenuEvent());
  }, [consent]);
  return null;
}

type PurchaseProps = Parameters<typeof purchaseEvent>[0];

/**
 * purchase: once per order, only for an order that was really placed (the page passes `placed`),
 * and only after analytics is accepted. A tab that comes back to the page does not count it twice.
 */
export function TrackPurchase({ placed, order }: { placed: boolean; order: PurchaseProps }) {
  const consent = useConsent();
  useEffect(() => {
    if (!placed || consent !== "granted") return;
    const marker = `fh-purchase-tracked-${order.number}`;
    try {
      if (localStorage.getItem(marker)) return;
      if (track(purchaseEvent(order))) localStorage.setItem(marker, "1"); // remembered only if it was really sent
    } catch {
      /* storage blocked: skip rather than risk counting twice */
    }
  }, [placed, consent, order]);
  return null;
}
