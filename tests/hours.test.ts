import { describe, expect, it } from "vitest";
import { isOpenAt } from "@/lib/hours";

const d = (iso: string) => new Date(iso);
// Mon-Sun 12:00-23:00
const all = Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt: "12:00:00", closesAt: "23:00:00" }));

describe("isOpenAt (Europe/London)", () => {
  it("is closed when no hours are configured", () => {
    expect(isOpenAt([], [], d("2026-11-04T15:00:00Z"))).toBe(false);
  });
  it("respects open/close boundaries (close is exclusive)", () => {
    expect(isOpenAt(all, [], d("2026-11-04T11:59:00Z"))).toBe(false); // GMT in November
    expect(isOpenAt(all, [], d("2026-11-04T12:00:00Z"))).toBe(true);
    expect(isOpenAt(all, [], d("2026-11-04T22:59:00Z"))).toBe(true);
    expect(isOpenAt(all, [], d("2026-11-04T23:00:00Z"))).toBe(false);
  });
  it("uses London wall-clock time during BST", () => {
    // 11:30 UTC in July = 12:30 BST -> open; 22:30 UTC = 23:30 BST -> closed
    expect(isOpenAt(all, [], d("2026-07-15T11:30:00Z"))).toBe(true);
    expect(isOpenAt(all, [], d("2026-07-15T22:30:00Z"))).toBe(false);
    expect(isOpenAt(all, [], d("2026-07-15T10:30:00Z"))).toBe(false); // 11:30 BST
  });
  it("handles a window that runs past midnight", () => {
    const late = [{ weekday: 5, opensAt: "17:00", closesAt: "02:00" }]; // Friday 17:00 -> Saturday 02:00
    expect(isOpenAt(late, [], d("2026-11-06T23:30:00Z"))).toBe(true); // Fri 23:30
    expect(isOpenAt(late, [], d("2026-11-07T01:30:00Z"))).toBe(true); // Sat 01:30 (Friday's window)
    expect(isOpenAt(late, [], d("2026-11-07T02:00:00Z"))).toBe(false);
    expect(isOpenAt(late, [], d("2026-11-07T23:30:00Z"))).toBe(false); // Saturday has no window
  });
  it("a closure day closes windows starting that day", () => {
    expect(isOpenAt(all, [{ day: "2026-12-25" }], d("2026-12-25T15:00:00Z"))).toBe(false);
    expect(isOpenAt(all, [{ day: "2026-12-25" }], d("2026-12-26T15:00:00Z"))).toBe(true);
  });
});
