import { describe, expect, it } from "vitest";
import { offerSchema } from "@/lib/admin/offer-schema";

const ok = { name: "Welcome", type: "percentage", value: 10, appliesToCategoryId: null, channel: "any", code: null, minSpend: 0, startsAt: null, endsAt: null, usageLimit: null, showOnSite: true };
const parse = (over: Record<string, unknown>) => offerSchema.safeParse({ ...ok, ...over });
const msg = (over: Record<string, unknown>) => { const r = parse(over); return r.success ? null : r.error.issues[0].message; };

describe("offer schema", () => {
  it("accepts a valid offer of each type", () => {
    expect(parse({}).success).toBe(true);
    expect(parse({ type: "fixed", value: 250 }).success).toBe(true);
    expect(parse({ type: "free_delivery", value: null, channel: "delivery" }).success).toBe(true);
    expect(parse({ type: "bogof", value: null, appliesToCategoryId: 3, channel: "collection" }).success).toBe(true);
  });
  it("percentage and fixed amounts must be in range", () => {
    for (const value of [0, 101, null, 1.5, -5]) expect(parse({ value }).success).toBe(false);
    for (const value of [0, 50_001, null, 2.5]) expect(parse({ type: "fixed", value }).success).toBe(false);
    expect(parse({ value: 100 }).success).toBe(true);
    expect(parse({ type: "fixed", value: 50_000 }).success).toBe(true);
  });
  it("rejects combinations the pricing engine would silently ignore", () => {
    expect(msg({ type: "free_delivery", value: null, channel: "collection" })).toMatch(/cannot be limited to collection/);
    expect(msg({ type: "free_delivery", value: 100 })).toMatch(/no amount/);
    expect(msg({ type: "bogof", value: null, appliesToCategoryId: null })).toMatch(/Choose which category/);
    expect(msg({ type: "bogof", value: 5, appliesToCategoryId: 1 })).toMatch(/no amount/);
    expect(msg({ type: "percentage", appliesToCategoryId: 2 })).toMatch(/Only buy-one-get-one-free/);
  });
  it("promo codes: 3-20 letters/numbers, blank means automatic", () => {
    expect(parse({ code: "WELCOME10" }).success).toBe(true);
    expect(parse({ code: "  save10  " }).success && (parse({ code: "  save10  " }) as { data: { code: string } }).data.code).toBe("save10");
    expect(parse({ code: "" }).success && (parse({ code: "" }) as { data: { code: null } }).data.code).toBeNull();
    for (const code of ["ab", "has space", "x".repeat(21), "bad-dash", "£££", "a_b"]) expect([code, parse({ code }).success]).toEqual([code, false]);
  });
  it("dates: real UK times only, end after start", () => {
    expect(parse({ startsAt: "2026-12-01T09:00", endsAt: "2026-12-31T23:59" }).success).toBe(true);
    expect(msg({ startsAt: "2026-12-31T09:00", endsAt: "2026-12-01T09:00" })).toMatch(/after the start/);
    expect(msg({ startsAt: "2026-12-01T09:00", endsAt: "2026-12-01T09:00" })).toMatch(/after the start/);
    expect(parse({ startsAt: "2026-03-29T01:30" }).success).toBe(false); // skipped hour
    expect(parse({ endsAt: "not a date" }).success).toBe(false);
    expect(parse({ startsAt: "2026-12-01" }).success).toBe(false);
  });
  it("other limits and strictness", () => {
    expect(parse({ name: "" }).success).toBe(false);
    expect(parse({ name: "x".repeat(81) }).success).toBe(false);
    expect(parse({ minSpend: -1 }).success).toBe(false);
    expect(parse({ minSpend: 100_001 }).success).toBe(false);
    expect(parse({ usageLimit: 0 }).success).toBe(false);
    expect(parse({ usageLimit: 1 }).success).toBe(true);
    expect(parse({ usedCount: 0 }).success).toBe(false); // cannot be set by the client
    expect(parse({ channel: "everywhere" }).success).toBe(false);
  });
});
