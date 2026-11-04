// Customer-facing wording for an order (R6.12). Pure.
import { formatPence } from "./money";

export type OrderView = {
  number: number;
  type: "delivery" | "collection";
  status: string;
  paymentMethod: "card" | "cash";
  paymentStatus: string;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  prepMinutes: number | null;
  rejectionReason: string | null;
  items: { name: string; quantity: number; options: { name: string; priceChange: number }[]; lineTotal: number }[];
};

export type StatusLine = { headline: string; detail?: string; tone: "progress" | "good" | "bad" };

/** Statuses where the page keeps refreshing (R6.12: every 15 seconds). */
export const ACTIVE_STATUSES = ["pending_payment", "received", "preparing", "ready", "out_for_delivery"];

export function statusLine(o: Pick<OrderView, "status" | "type" | "paymentMethod" | "prepMinutes" | "rejectionReason">): StatusLine {
  const eta = o.prepMinutes ? `About ${o.prepMinutes} minutes.` : undefined;
  switch (o.status) {
    case "pending_payment":
      return { headline: "Confirming your payment…", detail: "This usually takes a few seconds. Keep this page open.", tone: "progress" };
    case "received":
      return { headline: "We’ve got your order", detail: eta, tone: "progress" };
    case "preparing":
      return { headline: "Your food is being prepared", detail: eta, tone: "progress" };
    case "ready":
      return o.type === "collection"
        ? { headline: "Ready to collect", detail: "Come on in. Give us your order number.", tone: "good" }
        : { headline: "Ready, waiting for the rider", tone: "progress" };
    case "out_for_delivery":
      return { headline: "Out for delivery", tone: "progress" };
    case "completed":
      return { headline: "Completed. Enjoy!", tone: "good" };
    case "rejected":
      return {
        headline: "Sorry, we couldn’t take this order",
        detail: o.rejectionReason ?? undefined,
        tone: "bad",
      };
    case "cancelled":
      return {
        headline: o.paymentMethod === "card" ? "This order wasn’t paid, so it was cancelled" : "This order was cancelled",
        detail: "You haven’t been charged for anything that didn’t go through.",
        tone: "bad",
      };
    case "refunded":
      return { headline: "This order was refunded", tone: "bad" };
    default:
      return { headline: "Order received", tone: "progress" };
  }
}

export function paymentLine(o: Pick<OrderView, "paymentMethod" | "paymentStatus" | "type" | "total">): string {
  if (o.paymentMethod === "cash") {
    return `Pay ${formatPence(o.total)} in cash on ${o.type === "delivery" ? "delivery" : "collection"}`;
  }
  switch (o.paymentStatus) {
    case "paid":
      return "Paid by card";
    case "refunded":
      return "Refunded";
    case "failed":
      return "Payment failed";
    default:
      return "Awaiting payment";
  }
}

/** Show the order's page and clear the basket only for orders that were actually placed. */
export function orderWasPlaced(status: string): boolean {
  return !["pending_payment", "cancelled", "rejected"].includes(status);
}
