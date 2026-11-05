import { describe, expect, it } from "vitest";
import { formatLondonDate, londonLocalToUtc, utcToLondonLocal } from "@/lib/london-time";
import { describeConditions, describeDeal, describeShort, offerStatus, type OfferFacts } from "@/lib/offers";

const iso = (s: string) => londonLocalToUtc(s)?.toISOString() ?? null;

describe("UK local time -> UTC", () => {
  it("winter is UTC, summer is UTC+1", () => {
    expect(iso("2026-11-04T09:00")).toBe("2026-11-04T09:00:00.000Z");
    expect(iso("2026-07-15T09:00")).toBe("2026-07-15T08:00:00.000Z");
  });
  it("the hour skipped when clocks go forward (29 Mar 2026) does not exist", () => {
    expect(iso("2026-03-29T00:30")).toBe("2026-03-29T00:30:00.000Z"); // still GMT
    expect(iso("2026-03-29T01:30")).toBeNull(); // 01:00-02:00 never happens
    expect(iso("2026-03-29T02:30")).toBe("2026-03-29T01:30:00.000Z"); // BST
  });
  it("the repeated hour when clocks go back (25 Oct 2026) resolves to the earlier instant", () => {
    expect(iso("2026-10-25T00:30")).toBe("2026-10-24T23:30:00.000Z"); // BST
    expect(iso("2026-10-25T01:30")).toBe("2026-10-25T00:30:00.000Z"); // first 01:30 (BST), not the GMT one
    expect(iso("2026-10-25T02:30")).toBe("2026-10-25T02:30:00.000Z"); // GMT
  });
  it("rejects anything that is not a real date and time in the exact format", () => {
    for (const bad of ["2026-02-30T10:00", "2026-13-01T10:00", "2026-11-04T24:00", "2026-11-04T10:60", "2026-11-04 09:00", "garbage", "", "2026-11-04T9:00", "2026-11-04T09:00:00"]) {
      expect([bad, iso(bad)]).toEqual([bad, null]);
    }
  });
  it("round-trips through the form format", () => {
    for (const t of ["2026-01-15T09:00", "2026-07-15T23:59", "2026-03-29T02:30", "2026-10-25T02:30", "2026-12-31T00:00"]) {
      expect(utcToLondonLocal(londonLocalToUtc(t)!)).toBe(t);
    }
  });
  it("formats dates in UK time (a late-evening UTC instant in summer is already tomorrow)", () => {
    expect(formatLondonDate(new Date("2026-07-14T23:30:00Z"))).toBe("15 Jul");
    expect(formatLondonDate(new Date("2026-12-25T10:00:00Z"), true)).toBe("25 Dec 2026");
  });
});

const base: OfferFacts = { type: "percentage", value: 10, categoryName: null, channel: "any", code: null, minSpend: 0, startsAt: null, endsAt: null, usageLimit: null, usedCount: 0 };
const NOW = new Date("2026-11-04T12:00:00Z");

describe("offer status", () => {
  it("is active with no schedule or limit", () => expect(offerStatus(base, NOW)).toBe("active"));
  it("scheduled before the start, ended after the end, boundaries as the pricing engine reads them", () => {
    expect(offerStatus({ ...base, startsAt: new Date("2026-11-05T00:00:00Z") }, NOW)).toBe("scheduled");
    expect(offerStatus({ ...base, endsAt: new Date("2026-11-04T11:59:59Z") }, NOW)).toBe("ended");
    expect(offerStatus({ ...base, startsAt: NOW }, NOW)).toBe("active"); // starts at this very instant
    expect(offerStatus({ ...base, endsAt: NOW }, NOW)).toBe("active"); // engine: ended only when now > endsAt
  });
  it("used up at the limit; ended wins over used up", () => {
    expect(offerStatus({ ...base, usageLimit: 5, usedCount: 4 }, NOW)).toBe("active");
    expect(offerStatus({ ...base, usageLimit: 5, usedCount: 5 }, NOW)).toBe("used_up");
    expect(offerStatus({ ...base, usageLimit: 5, usedCount: 9, endsAt: new Date("2026-01-01T00:00:00Z") }, NOW)).toBe("ended");
  });
});

describe("offer wording", () => {
  it("describes each deal", () => {
    expect(describeDeal({ type: "percentage", value: 15, categoryName: null })).toBe("15% off your order");
    expect(describeDeal({ type: "fixed", value: 250, categoryName: null })).toBe("£2.50 off your order");
    expect(describeDeal({ type: "fixed", value: 300, categoryName: null })).toBe("£3 off your order");
    expect(describeDeal({ type: "free_delivery", value: null, categoryName: null })).toBe("Free delivery");
    expect(describeDeal({ type: "bogof", value: null, categoryName: "Wings" })).toBe("Buy 1 get 1 free on Wings");
  });
  it("lists the small print", () => {
    expect(describeConditions({ ...base, channel: "collection", minSpend: 1500, endsAt: new Date("2026-11-30T12:00:00Z"), usageLimit: 50 })).toEqual(["Collection orders only", "Spend £15 or more", "Ends 30 Nov", "While offers last"]);
    expect(describeConditions(base)).toEqual([]);
  });
  it("one-line banner text includes channel and code", () => {
    expect(describeShort({ ...base, type: "bogof", value: null, categoryName: "Wings", channel: "collection" })).toBe("Buy 1 get 1 free on Wings — collection only");
    expect(describeShort({ ...base, code: "WELCOME10" })).toBe("10% off your order · code WELCOME10");
  });
});
