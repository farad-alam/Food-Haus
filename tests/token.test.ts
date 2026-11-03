import { describe, expect, it } from "vitest";
import { newOrderToken } from "@/lib/token";

describe("newOrderToken (R13.15)", () => {
  it("is 22 base64url characters (128 bits)", () => {
    for (let i = 0; i < 50; i++) expect(newOrderToken()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
  it("never repeats across many calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(newOrderToken());
    expect(seen.size).toBe(5000);
  });
});
