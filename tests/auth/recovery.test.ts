import { describe, expect, it } from "vitest";
import { generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode, normaliseRecoveryCode, RECOVERY_COUNT } from "@/lib/auth/recovery";

describe("recovery codes", () => {
  it("makes 10 distinct codes shaped XXXXX-XXXXX with no lookalike characters", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_COUNT);
    for (let i = 0; i < 400; i++) for (const c of generateRecoveryCodes(5)) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/); // never 0, 1, I or O
  });
  it("uses all 32 symbols roughly evenly (no modulo bias)", () => {
    const counts = new Map<string, number>();
    const total = 4000 * 10;
    for (let i = 0; i < 4000; i++) for (const c of generateRecoveryCodes(1)[0].replace("-", "")) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(32);
    for (const n of counts.values()) expect(Math.abs(n - total / 32) / (total / 32)).toBeLessThan(0.15); // within 15% of the expected count
  });
  it("accepts any case and stray spaces or dashes, and rejects everything else", () => {
    expect(normaliseRecoveryCode("abcde-fghjk")).toBe("ABCDEFGHJK");
    expect(normaliseRecoveryCode(" ABCDE FGHJK ")).toBe("ABCDEFGHJK");
    expect(normaliseRecoveryCode("A-B-C-D-E-F-G-H-J-K")).toBe("ABCDEFGHJK");
    for (const bad of ["", "ABCDE", "ABCDE-FGHJ", "ABCDE-FGHJKL", "ABCDE-FGHJ0", "ABCDE-FGHJI", "ABCDE-FGHJO", "ABCDE-FGHJ!", "123456"]) expect([bad, normaliseRecoveryCode(bad)]).toEqual([bad, null]);
  });
  it("a 6-digit authenticator code is never mistaken for a recovery code", () => {
    expect(looksLikeRecoveryCode("123456")).toBe(false);
    expect(looksLikeRecoveryCode("ABCDE-FGHJK")).toBe(true);
  });
  it("hashes consistently, ignores formatting, never equals the code, and refuses non-codes", async () => {
    const h = await hashRecoveryCode("ABCDE-FGHJK");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashRecoveryCode("abcde fghjk")).toBe(h);
    expect(h).not.toContain("ABCDE");
    expect(await hashRecoveryCode("ABCDE-FGHJM")).not.toBe(h);
    await expect(hashRecoveryCode("nope")).rejects.toThrow();
  });
});
