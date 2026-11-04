"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { EMPTY, write } from "@/lib/basket-store";

// R6.12: refresh the order status every 15 seconds while the order is still
// moving, but not while the tab is hidden. Also empties the basket once, when
// the order has really been placed (so a later visit to this old link cannot
// wipe a new basket).
export function OrderLive({ active, placed, orderNumber }: { active: boolean; placed: boolean; orderNumber: number }) {
  const router = useRouter();

  useEffect(() => {
    if (!placed) return;
    const marker = `fh-order-cleared-${orderNumber}`;
    try {
      if (localStorage.getItem(marker)) return;
      localStorage.setItem(marker, "1");
    } catch {
      return; // storage blocked: leave the basket alone rather than clear it repeatedly
    }
    write(EMPTY);
  }, [placed, orderNumber]);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 15_000);
    return () => clearInterval(id);
  }, [active, router]);

  return null;
}
