import { describe, expect, it } from "vitest";
import { normaliseTime, sortWindows, validateWindows } from "@/lib/admin/hours-validate";
import { isOpenAt } from "@/lib/hours";
import { parsePounds, penceToInput } from "@/lib/money";

const w = (weekday: number, opensAt: string, closesAt: string) => ({ weekday, opensAt, closesAt });

describe("validateWindows", () => {
  it("accepts a normal week, split shifts and overnight windows", () => {
    const week = [0, 1, 2, 3, 4, 5, 6].map((d) => w(d, "12:00", "23:00"));
    expect(validateWindows(week)).toBeNull();
    expect(validateWindows([w(1, "12:00", "15:00"), w(1, "17:00", "23:00")])).toBeNull();
    expect(validateWindows([w(5, "17:00", "02:00"), w(6, "17:00", "02:00")])).toBeNull(); // Fri night ends 02:00, Sat starts 17:00
    expect(validateWindows([])).toBeNull(); // no hours = closed; allowed, the UI warns
  });
  it("rejects bad times and zero-length windows", () => {
    expect(validateWindows([w(1, "24:00", "23:00")])).toMatch(/enter times/);
    expect(validateWindows([w(1, "9:00", "23:00")])).toMatch(/enter times/);
    expect(validateWindows([w(1, "12:00", "12:00")])).toMatch(/cannot be the same/);
    expect(validateWindows([w(9, "12:00", "13:00")])).toMatch(/Unknown day/);
  });
  it("rejects overlaps on the same day", () => {
    expect(validateWindows([w(1, "12:00", "18:00"), w(1, "17:00", "22:00")])).toBe("Monday: opening periods overlap.");
    expect(validateWindows([w(1, "12:00", "18:00"), w(1, "18:00", "22:00")])).toBeNull(); // touching is fine
  });
  it("rejects a window that runs past midnight into the next day's window, including Sunday into Monday", () => {
    expect(validateWindows([w(5, "17:00", "03:00"), w(6, "02:00", "10:00")])).toMatch(/Friday and Saturday overlap/);
    expect(validateWindows([w(6, "20:00", "02:00"), w(0, "01:00", "05:00")])).toMatch(/overlap/);
    expect(validateWindows([w(0, "22:00", "01:00"), w(1, "00:30", "05:00")])).toMatch(/Sunday and Monday overlap/);
    expect(validateWindows([w(6, "22:00", "01:00"), w(0, "00:30", "05:00")])).toMatch(/overlap/); // Sat -> Sun wraps the week
    expect(validateWindows([w(6, "22:00", "01:00"), w(0, "01:00", "05:00")])).toBeNull();
  });
  it("limits periods per day", () => {
    expect(validateWindows([w(1, "06:00", "07:00"), w(1, "08:00", "09:00"), w(1, "10:00", "11:00"), w(1, "12:00", "13:00")])).toMatch(/at most 3/);
  });
  it("what validates is what the runtime opening check enforces (overnight)", () => {
    const rows = [w(5, "17:00", "02:00")];
    expect(validateWindows(rows)).toBeNull();
    expect(isOpenAt(rows, [], new Date("2026-11-07T01:30:00Z"))).toBe(true); // Sat 01:30 London = Friday's window
    expect(isOpenAt(rows, [], new Date("2026-11-07T02:00:00Z"))).toBe(false);
  });
  it("normaliseTime and sortWindows", () => {
    expect(normaliseTime("09:05:00")).toBe("09:05");
    expect(normaliseTime("9:05")).toBeNull();
    expect(normaliseTime("25:00")).toBeNull();
    expect(sortWindows([w(2, "12:00", "13:00"), w(1, "17:00", "18:00"), w(1, "09:00", "10:00")]).map((x) => `${x.weekday}${x.opensAt}`)).toEqual(["109:00", "117:00", "212:00"]);
  });
});

describe("parsePounds", () => {
  it("parses typed amounts into whole pence", () => {
    expect(parsePounds("2.5")).toBe(250);
    expect(parsePounds("£2.50")).toBe(250);
    expect(parsePounds("10")).toBe(1000);
    expect(parsePounds(" 0.99 ")).toBe(99);
    expect(parsePounds("0")).toBe(0);
    expect(penceToInput(250)).toBe("2.50");
    expect(penceToInput(1000)).toBe("10.00");
  });
  it("rejects anything ambiguous instead of guessing", () => {
    for (const bad of ["", "abc", "-1", "2.555", "1,50", "1e3", "2.", ".5", "£", "1 000"]) expect(parsePounds(bad)).toBeNull();
  });
});
