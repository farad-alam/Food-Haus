import { describe, expect, it } from "vitest";
import { createPasswordHasher, DEFAULT_ITERATIONS, validatePasswordPolicy } from "@/lib/auth/password";
import { base32Decode, base32Encode, generateTotpSecret, otpauthUri, totpAt, verifyTotp } from "@/lib/auth/totp";

const fast = createPasswordHasher(1000);

describe("password hashing", () => {
  it("round-trips, salts every hash and never stores the password", async () => {
    const a = await fast.hash("correct horse battery");
    const b = await fast.hash("correct horse battery");
    expect(a).not.toBe(b);
    expect(a).not.toContain("correct");
    expect(a.startsWith("pbkdf2-sha256$1000$")).toBe(true);
    expect(await fast.verify("correct horse battery", a)).toBe(true);
    expect(await fast.verify("correct horse batterY", a)).toBe(false);
    expect(await fast.verify("", a)).toBe(false);
  });

  it("rejects malformed or hostile stored values without throwing", async () => {
    for (const bad of ["", "x", "pbkdf2-sha256$1$a$b", "bcrypt$10$a$b", "pbkdf2-sha256$0$AAAA$AAAA", "pbkdf2-sha256$99999999999$AAAA$AAAA", "pbkdf2-sha256$1000$!!$!!"]) {
      expect(await fast.verify("pw", bad)).toBe(false);
    }
  });

  it("flags weaker or foreign hashes for rehash", async () => {
    const weak = await createPasswordHasher(500).hash("a long enough password");
    expect(fast.needsRehash(weak)).toBe(true);
    expect(fast.needsRehash(await fast.hash("a long enough password"))).toBe(false);
    expect(fast.needsRehash("bcrypt$10$salt$hash")).toBe(true);
  });

  it("the production default is the OWASP minimum of 600,000 iterations", () => {
    expect(DEFAULT_ITERATIONS).toBe(600_000);
  });
});

describe("password policy", () => {
  it("enforces length, blocklist, repetition and email-name reuse", () => {
    expect(validatePasswordPolicy("short")).toMatch(/at least 12/);
    expect(validatePasswordPolicy("x".repeat(129))).toMatch(/at most 128/);
    expect(validatePasswordPolicy("Password12345")).toMatch(/too common/);
    expect(validatePasswordPolicy("aaaaaaaaaaaaaa")).toMatch(/repetitive/);
    expect(validatePasswordPolicy("my-owner-secret-1", { email: "owner@foodhaus.co.uk" })).toMatch(/email/);
    expect(validatePasswordPolicy("tangerine-lantern-42")).toBeNull();
  });
});

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 128, 7]);
    expect([...base32Decode(base32Encode(bytes))!]).toEqual([...bytes]);
  });
  it("encodes the RFC 4648 test vector and rejects bad input", () => {
    expect(base32Encode(new TextEncoder().encode("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("MZXW6YTBOI")).toEqual(new TextEncoder().encode("foobar"));
    expect(base32Decode("not base32!")).toBeNull();
    expect(base32Decode("")).toBeNull();
  });
});

describe("TOTP (RFC 6238 test vectors, SHA-1, secret '12345678901234567890')", () => {
  const secret = base32Encode(new TextEncoder().encode("12345678901234567890"));
  // The RFC lists 8-digit codes; the 6-digit code is their last six digits.
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ])("t=%i → %s", async (seconds, code) => {
    expect(await totpAt(secret, seconds * 1000)).toBe(code);
  });

  it("accepts the current step and one either side, not two", async () => {
    const now = 1_700_000_000_000;
    const code = (await totpAt(secret, now))!;
    expect((await verifyTotp(secret, code, now)).ok).toBe(true);
    expect((await verifyTotp(secret, code, now + 30_000)).ok).toBe(true); // 1 step late
    expect((await verifyTotp(secret, code, now - 30_000)).ok).toBe(true); // 1 step early
    expect((await verifyTotp(secret, code, now + 90_000)).ok).toBe(false); // 3 steps away
  });

  it("refuses a code from a step already used (replay protection)", async () => {
    const now = 1_700_000_000_000;
    const code = (await totpAt(secret, now))!;
    const first = await verifyTotp(secret, code, now);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect((await verifyTotp(secret, code, now, first.step)).ok).toBe(false);
    expect((await verifyTotp(secret, code, now + 5_000, first.step)).ok).toBe(false);
  });

  it("tolerates spaces and rejects non-codes", async () => {
    const now = 1_700_000_000_000;
    const code = (await totpAt(secret, now))!;
    expect((await verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now)).ok).toBe(true);
    for (const bad of ["", "12345", "1234567", "abcdef", "000000 0"]) expect((await verifyTotp(secret, bad, now)).ok).toBe(false);
    expect((await verifyTotp("not base32!", code, now)).ok).toBe(false);
  });

  it("generates 160-bit secrets and a valid otpauth URI", () => {
    const s = generateTotpSecret();
    expect(base32Decode(s)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(s);
    const uri = otpauthUri(s, "owner@foodhaus.co.uk");
    expect(uri).toContain(`secret=${s}`);
    expect(uri.startsWith("otpauth://totp/Food%20Haus%3Aowner%40foodhaus.co.uk?")).toBe(true);
  });
});
