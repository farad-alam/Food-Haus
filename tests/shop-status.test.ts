import { describe, expect, it } from "vitest";
import { closedButtonLabel, closedMessage, currentClosing, describeReopening, formatClock, nextOpening, shopState, weekTimetable, type Schedule } from "@/lib/shop-status";

const w = (weekday: number, opensAt: string, closesAt: string) => ({ weekday, opensAt, closesAt });
const at = (iso: string) => new Date(iso);
// Mon-Sun 12:00-23:00 (UK time)
const daily = [0, 1, 2, 3, 4, 5, 6].map((d) => w(d, "12:00", "23:00"));
const sched = (over: Partial<Schedule> = {}): Schedule => ({ paused: false, pausedMessage: null, hours: daily, closures: [], ...over });

describe("clock formatting", () => {
  it("reads like a person would say it", () => {
    expect(formatClock(0)).toBe("12am");
    expect(formatClock(12 * 60)).toBe("12pm");
    expect(formatClock(17 * 60 + 30)).toBe("5:30pm");
    expect(formatClock(23 * 60)).toBe("11pm");
    expect(formatClock(9 * 60 + 5)).toBe("9:05am");
  });
});

describe("shop state", () => {
  it("open inside hours, with the closing time", () => {
    const s = shopState(sched(), at("2026-11-04T15:00:00Z"));
    expect(s).toMatchObject({ open: true, reason: "open" });
    expect(s.closesAt?.toISOString()).toBe("2026-11-04T23:00:00.000Z");
  });
  it("closed before opening: reopens later today", () => {
    const now = at("2026-11-04T09:00:00Z");
    const s = shopState(sched(), now);
    expect(s).toMatchObject({ open: false, reason: "outside_hours" });
    expect(s.opensAt?.toISOString()).toBe("2026-11-04T12:00:00.000Z");
    expect(closedMessage(s, now)).toBe("We are closed right now. Ordering opens today at 12pm.");
    expect(closedButtonLabel(s, now)).toBe("Ordering opens today at 12pm");
  });
  it("closed after closing: reopens tomorrow", () => {
    const now = at("2026-11-04T23:30:00Z");
    const s = shopState(sched(), now);
    expect(closedMessage(s, now)).toBe("We are closed right now. Ordering opens tomorrow at 12pm.");
  });
  it("uses UK time through the clock change (summer: 12:00 UK is 11:00 UTC)", () => {
    const now = at("2026-07-15T09:00:00Z"); // 10:00 BST
    const s = shopState(sched(), now);
    expect(s.opensAt?.toISOString()).toBe("2026-07-15T11:00:00.000Z");
    expect(describeReopening(s.opensAt!, now)).toBe("today at 12pm");
  });
  it("a closure day: says so, with the reason, and reopens the next open day", () => {
    const now = at("2026-12-25T15:00:00Z");
    const s = shopState(sched({ closures: [{ day: "2026-12-25", reason: "Christmas Day" }] }), now);
    expect(s).toMatchObject({ open: false, reason: "closure", closureReason: "Christmas Day" });
    expect(closedMessage(s, now)).toBe("We are closed today (Christmas Day). Ordering opens tomorrow at 12pm.");
  });
  it("skips closed days and days with no hours when finding the next opening", () => {
    const hours = [w(1, "12:00", "22:00"), w(5, "17:00", "23:00")]; // Mon and Fri only
    const now = at("2026-11-04T15:00:00Z"); // Wednesday
    expect(describeReopening(nextOpening(hours, [], now)!, now)).toBe("Friday at 5pm");
    const skipFri = nextOpening(hours, [{ day: "2026-11-06" }], now)!; // Friday closed -> next Monday
    expect(describeReopening(skipFri, now)).toBe("Monday at 12pm");
    expect(nextOpening([], [], now)).toBeNull();
  });
  it("a reopening a week or more away names the date", () => {
    const now = at("2026-11-04T15:00:00Z");
    const s = shopState(sched({ hours: [w(1, "12:00", "22:00")], closures: [{ day: "2026-11-09" }] }), now);
    expect(describeReopening(s.opensAt!, now)).toBe("Monday 16 Nov at 12pm");
  });
  it("looks only two weeks ahead: beyond that it says closed without promising a time", () => {
    const now = at("2026-11-04T15:00:00Z");
    const s = shopState(sched({ hours: [w(1, "12:00", "22:00")], closures: [{ day: "2026-11-09" }, { day: "2026-11-16" }] }), now);
    expect(s.opensAt).toBeNull();
    expect(closedMessage(s, now)).toBe("We are closed right now.");
    expect(closedButtonLabel(s, now)).toBe("Closed");
  });
  it("paused wins over everything, and shows the owner's message", () => {
    const now = at("2026-11-04T15:00:00Z");
    const s = shopState(sched({ paused: true, pausedMessage: "Back at 8pm" }), now);
    expect(s).toMatchObject({ open: false, reason: "paused" });
    expect(closedMessage(s, now)).toBe("Back at 8pm");
    expect(closedMessage(shopState(sched({ paused: true }), now), now)).toBe("We are not taking orders right now.");
    expect(closedButtonLabel(s, now)).toBe("Orders are paused");
  });
  it("no hours set: closed, and does not promise a reopening time", () => {
    const now = at("2026-11-04T15:00:00Z");
    const s = shopState(sched({ hours: [] }), now);
    expect(s.reason).toBe("no_hours");
    expect(closedMessage(s, now)).toBe("We are not taking orders right now.");
    expect(closedButtonLabel(s, now)).toBe("Closed");
  });
  it("is silent when open", () => {
    const now = at("2026-11-04T15:00:00Z");
    expect(closedMessage(shopState(sched(), now), now)).toBeNull();
  });
  it("an overnight period stays open past midnight and reports its real closing time", () => {
    const hours = [w(5, "17:00", "02:00")]; // Friday 17:00 -> Saturday 02:00
    const now = at("2026-11-07T01:00:00Z"); // Saturday 01:00 UK
    expect(shopState(sched({ hours }), now)).toMatchObject({ open: true });
    expect(currentClosing(hours, [], now)?.toISOString()).toBe("2026-11-07T02:00:00.000Z");
    expect(currentClosing(hours, [], at("2026-11-07T03:00:00Z"))).toBeNull();
  });
});

describe("weekly timetable", () => {
  it("is Monday-first, joins split periods, and marks closed days", () => {
    const t = weekTimetable([w(1, "12:00", "15:00"), w(1, "17:00", "23:00"), w(0, "13:00", "22:30")]);
    expect(t.map((r) => r.day)).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    expect(t[0].times).toBe("12pm – 3pm, 5pm – 11pm");
    expect(t[1].times).toBe("Closed");
    expect(t[6].times).toBe("1pm – 10:30pm");
  });
  it("is empty when no hours exist, so nothing is published as fact", () => {
    expect(weekTimetable([])).toEqual([]);
  });
});
