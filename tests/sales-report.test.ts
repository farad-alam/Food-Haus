import { describe, expect, it } from "vitest";
import { buildReportEmail, buildTotals, closingOf, tradingPeriod, type ReportItem, type ReportOrder } from "@/lib/sales-report";
import { addDays } from "@/lib/shop-status";

const w = (weekday: number, opensAt: string, closesAt: string) => ({ weekday, opensAt, closesAt });
const daily = [0, 1, 2, 3, 4, 5, 6].map((d) => w(d, "12:00", "23:00"));
const iso = (d: Date) => d.toISOString();

describe("trading periods", () => {
  it("an ordinary day runs midnight to midnight and reports 15 minutes after closing", () => {
    const p = tradingPeriod(daily, "2026-11-04"); // Wednesday, GMT
    expect(iso(p.start)).toBe("2026-11-04T00:00:00.000Z");
    expect(iso(p.end)).toBe("2026-11-05T00:00:00.000Z");
    expect(iso(p.closesAt!)).toBe("2026-11-04T23:00:00.000Z");
    expect(iso(p.reportAt)).toBe("2026-11-04T23:15:00.000Z");
  });
  it("uses UK time in summer (closing 23:00 BST is 22:00 UTC)", () => {
    const p = tradingPeriod(daily, "2026-07-15");
    expect(iso(p.start)).toBe("2026-07-14T23:00:00.000Z"); // UK midnight
    expect(iso(p.reportAt)).toBe("2026-07-15T22:15:00.000Z");
  });
  it("a Friday-night shift to 2am belongs to Friday: Friday ends at 2am Saturday and Saturday starts there", () => {
    const hours = [w(5, "17:00", "02:00"), w(6, "17:00", "02:00")];
    const fri = tradingPeriod(hours, "2026-11-06");
    const sat = tradingPeriod(hours, "2026-11-07");
    expect(iso(fri.closesAt!)).toBe("2026-11-07T02:00:00.000Z");
    expect(iso(fri.end)).toBe("2026-11-07T02:00:00.000Z");
    expect(iso(fri.reportAt)).toBe("2026-11-07T02:15:00.000Z");
    expect(iso(sat.start)).toBe("2026-11-07T02:00:00.000Z"); // not midnight: the 00:00-02:00 orders were Friday's
    expect(iso(sat.end)).toBe("2026-11-08T02:00:00.000Z");
  });
  it("a day with no opening hours reports at 23:30 UK and has no closing time", () => {
    const p = tradingPeriod([w(1, "12:00", "22:00")], "2026-11-04"); // Wednesday: none
    expect(p.closesAt).toBeNull();
    expect(iso(p.reportAt)).toBe("2026-11-04T23:30:00.000Z");
    expect(closingOf([], "2026-11-04")).toBeNull();
  });
  it("split periods close at the LAST period's end", () => {
    expect(iso(closingOf([w(3, "12:00", "15:00"), w(3, "17:00", "22:30")], "2026-11-04")!)).toBe("2026-11-04T22:30:00.000Z");
  });

  it("consecutive days tile exactly (end of D = start of D+1) across overnight shifts and both clock changes", () => {
    const schedules = [
      daily,
      [w(5, "17:00", "02:00"), w(6, "17:00", "03:30"), w(0, "13:00", "23:00")],
      [w(1, "12:00", "15:00"), w(1, "17:00", "01:00"), w(2, "00:30", "02:00")],
      [],
    ];
    for (const hours of schedules) {
      for (let start = "2026-03-20", n = 0; n < 20; n++, start = addDays(start, 1)) {
        const a = tradingPeriod(hours, start);
        const b = tradingPeriod(hours, addDays(start, 1));
        expect([start, iso(a.end)]).toEqual([start, iso(b.start)]);
        expect(a.end > a.start).toBe(true);
      }
      for (let start = "2026-10-20", n = 0; n < 15; n++, start = addDays(start, 1)) {
        expect(iso(tradingPeriod(hours, start).end)).toBe(iso(tradingPeriod(hours, addDays(start, 1)).start));
      }
    }
  });
  it("days around the clock changes are 23 and 25 hours long, not 24", () => {
    const hrs = (a: string) => (new Date(tradingPeriod([], a).end).getTime() - new Date(tradingPeriod([], a).start).getTime()) / 3_600_000;
    expect(hrs("2026-03-29")).toBe(23);
    expect(hrs("2026-10-25")).toBe(25);
    expect(hrs("2026-11-04")).toBe(24);
  });
});

const o = (id: number, over: Partial<ReportOrder> = {}): ReportOrder => ({ id, total: 1000, discount: 0, deliveryFee: 0, type: "collection", paymentMethod: "cash", status: "completed", paymentStatus: "unpaid", ...over });
const it_ = (orderId: number, name: string, quantity: number, lineTotal: number): ReportItem => ({ orderId, name, quantity, lineTotal });

describe("totals", () => {
  it("counts accepted orders, splits by payment and type, and averages", () => {
    const t = buildTotals(
      [
        o(1, { total: 1598, paymentMethod: "card", paymentStatus: "paid", status: "completed" }),
        o(2, { total: 1848, paymentMethod: "card", paymentStatus: "paid", type: "delivery", deliveryFee: 250, discount: 0, status: "received" }),
        o(3, { total: 900, discount: 100, status: "preparing" }),
        o(4, { total: 700, status: "out_for_delivery", type: "delivery" }),
      ],
      [],
    );
    expect(t).toMatchObject({ orders: 4, revenue: 1598 + 1848 + 900 + 700, discounts: 100, deliveryFees: 250 });
    expect(t.average).toBe(Math.round(5046 / 4));
    expect(t.card).toEqual({ orders: 2, revenue: 3446 });
    expect(t.cash).toEqual({ orders: 2, revenue: 1600 });
    expect(t.delivery).toEqual({ orders: 2, revenue: 2548 });
    expect(t.collection).toEqual({ orders: 2, revenue: 2498 });
  });
  it("rejected, cancelled and refunded orders are reported separately and never counted as sales", () => {
    const t = buildTotals(
      [o(1), o(2, { status: "rejected" }), o(3, { status: "cancelled", paymentMethod: "card" }), o(4, { status: "refunded", total: 2000 }), o(5, { status: "completed", paymentStatus: "refunded", total: 500 }), o(6, { status: "pending_payment", paymentMethod: "card" })],
      [],
    );
    expect(t).toMatchObject({ orders: 1, revenue: 1000, rejected: 1, cancelled: 1, refunded: { orders: 2, revenue: 2500 } });
  });
  it("top items: by quantity then revenue then name, max five, only from counted orders", () => {
    const orders = [o(1), o(2), o(3, { status: "rejected" })];
    const items = [
      it_(1, "Burger", 3, 2400), it_(2, "Burger", 2, 1600), it_(1, "Wings", 5, 3000), it_(2, "Fries", 5, 1500), it_(1, "Cola", 1, 150),
      it_(2, "Wrap", 1, 700), it_(1, "Nuggets", 1, 600), it_(3, "Ghost", 99, 9999), // rejected order: ignored
    ];
    const t = buildTotals(orders, items);
    expect(t.topItems.map((i) => [i.name, i.quantity])).toEqual([["Burger", 5], ["Wings", 5], ["Fries", 5], ["Wrap", 1], ["Nuggets", 1]]);
    // equal quantity (5): ordered by revenue 4000 > 3000 > 1500
    expect(t.topItems[0].revenue).toBe(4000);
    expect(t.topItems.map((i) => i.name)).not.toContain("Ghost");
  });
  it("an empty day is all zeros with no division by zero", () => {
    const t = buildTotals([], []);
    expect(t).toMatchObject({ orders: 0, revenue: 0, average: 0, topItems: [] });
  });
});

describe("the email", () => {
  const t = buildTotals([o(1, { total: 1598, paymentMethod: "card", paymentStatus: "paid" }), o(2, { total: 800, status: "rejected" })], [it_(1, "Classic <b>Burger</b>", 2, 1598)]);
  const e = buildReportEmail("2026-11-04", t, { orders: 40, revenue: 55_000 });

  it("has a subject with the day, orders and revenue, and handles 1 vs many and zero", () => {
    expect(e.subject).toBe("Food Haus sales, Wed 4 Nov: 1 order, £15.98");
    expect(buildReportEmail("2026-11-04", buildTotals([o(1), o(2)], []), { orders: 0, revenue: 0 }).subject).toBe("Food Haus sales, Wed 4 Nov: 2 orders, £20.00");
    expect(buildReportEmail("2026-11-04", buildTotals([], []), { orders: 0, revenue: 0 }).subject).toBe("Food Haus sales, Wed 4 Nov: no orders");
  });
  it("shows the key figures, top items, notes and the 7-day line", () => {
    for (const s of ["Orders: 1", "Revenue: £15.98", "Average order: £15.98", "Paid online (card): 1 · £15.98", "Cash: 0 · £0.00", "1 order rejected", "Last 7 days: 40 orders, £550.00", "Wednesday, 4 Nov 2026"]) expect(e.text).toContain(s);
    expect(e.text).toContain("1. Classic <b>Burger</b>: 2 sold, £15.98");
  });
  it("escapes item names in the HTML", () => {
    expect(e.html).not.toContain("<b>Burger</b>");
    expect(e.html).toContain("Classic &lt;b&gt;Burger&lt;/b&gt;");
  });
  it("carries totals only: nothing resembling customer contact details can appear", () => {
    // The report functions never receive names, phones, emails or addresses, so the output cannot contain them.
    expect(buildReportEmail.length).toBeLessThanOrEqual(4);
    expect(e.text + e.html).not.toMatch(/@|\+44|07\d{9}|LU\d/);
    expect(e.text).toContain("totals only: no customer details");
  });
});
