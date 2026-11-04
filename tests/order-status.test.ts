import { describe, expect, it } from "vitest";
import { ACTIVE_STATUSES, orderWasPlaced, paymentLine, statusLine } from "@/lib/order-status";

const base = { type: "collection" as const, paymentMethod: "card" as const, prepMinutes: null, rejectionReason: null };

describe("order status wording", () => {
  it("covers every status with a headline", () => {
    for (const status of ["pending_payment", "received", "preparing", "ready", "out_for_delivery", "completed", "rejected", "cancelled", "refunded"]) {
      expect(statusLine({ ...base, status }).headline.length).toBeGreaterThan(0);
    }
  });
  it("distinguishes ready for collection vs delivery, and shows prep time", () => {
    expect(statusLine({ ...base, status: "ready" }).headline).toBe("Ready to collect");
    expect(statusLine({ ...base, type: "delivery", status: "ready" }).headline).toMatch(/rider/);
    expect(statusLine({ ...base, status: "preparing", prepMinutes: 25 }).detail).toBe("About 25 minutes.");
  });
  it("shows the rejection reason and flags unpaid card cancellation", () => {
    expect(statusLine({ ...base, status: "rejected", rejectionReason: "Out of chicken" })).toMatchObject({ tone: "bad", detail: "Out of chicken" });
    expect(statusLine({ ...base, status: "cancelled" }).headline).toMatch(/wasn’t paid/);
    expect(statusLine({ ...base, paymentMethod: "cash", status: "cancelled" }).headline).toBe("This order was cancelled");
  });
  it("payment wording", () => {
    expect(paymentLine({ paymentMethod: "cash", paymentStatus: "unpaid", type: "delivery", total: 1598 })).toBe("Pay £15.98 in cash on delivery");
    expect(paymentLine({ paymentMethod: "card", paymentStatus: "paid", type: "delivery", total: 1 })).toBe("Paid by card");
    expect(paymentLine({ paymentMethod: "card", paymentStatus: "unpaid", type: "delivery", total: 1 })).toBe("Awaiting payment");
  });
  it("only real orders clear the basket; only moving orders refresh", () => {
    expect(orderWasPlaced("received")).toBe(true);
    for (const s of ["pending_payment", "cancelled", "rejected"]) expect(orderWasPlaced(s)).toBe(false);
    expect(ACTIVE_STATUSES).not.toContain("completed");
    expect(ACTIVE_STATUSES).toContain("pending_payment");
  });
});
