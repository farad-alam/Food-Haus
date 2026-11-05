import { describe, expect, it } from "vitest";
import { retentionCutoff } from "@/lib/retention";

describe("retentionCutoff", () => {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  it("is the same day, 12 months earlier", () => {
    expect(iso(retentionCutoff(new Date("2026-11-05T10:00:00Z")))).toBe("2025-11-05");
    expect(iso(retentionCutoff(new Date("2027-01-31T00:00:00Z")))).toBe("2026-01-31");
  });
  it("clamps to the end of a shorter month instead of rolling over", () => {
    expect(iso(retentionCutoff(new Date("2028-02-29T12:00:00Z")))).toBe("2027-02-28");
    expect(iso(retentionCutoff(new Date("2026-03-31T12:00:00Z"), 1))).toBe("2026-02-28");
    expect(iso(retentionCutoff(new Date("2026-01-31T12:00:00Z"), 2))).toBe("2025-11-30");
  });
  it("keeps the time of day", () => {
    expect(retentionCutoff(new Date("2026-11-05T10:20:30Z")).toISOString()).toBe("2025-11-05T10:20:30.000Z");
  });
});
