import { afterEach, describe, expect, it, vi } from "vitest";
import { createPasswordHasher, DEFAULT_ITERATIONS, deriveJs, WEBCRYPTO_MAX_ITERATIONS_WORKERS } from "@/lib/auth/password";

// Cloudflare Workers' Web Crypto refuses PBKDF2 above 100,000 iterations ("Pbkdf2 failed: iteration counts above
// 100000 are not supported"). These tests reproduce that refusal and check that 600,000-iteration hashes keep working,
// in both directions, with the exact same stored format.
const WORKERS_ERROR = "Pbkdf2 failed: iteration counts above 100000 are not supported (requested 600000).";
const real = crypto.subtle.deriveBits.bind(crypto.subtle);
const asWorkers = () =>
  vi.spyOn(crypto.subtle, "deriveBits").mockImplementation(((alg: Pbkdf2Params, ...rest: unknown[]) => {
    if (alg.iterations > WEBCRYPTO_MAX_ITERATIONS_WORKERS) throw new DOMException(WORKERS_ERROR, "NotSupportedError");
    return (real as (...a: unknown[]) => Promise<ArrayBuffer>)(alg, ...rest);
  }) as never);

afterEach(() => vi.restoreAllMocks());

describe("PBKDF2 on Workers (above 100,000 iterations)", () => {
  const PW = "correct horse battery staple 42";
  const full = createPasswordHasher(DEFAULT_ITERATIONS);

  it("the pure-JS fallback gives byte-for-byte the same key as the native implementation", async () => {
    const low = createPasswordHasher(5_000);
    const stored = await low.hash(PW); // native
    const [, iter, salt, dk] = stored.split("$");
    const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    expect([...deriveJs(PW, b64(salt), Number(iter))]).toEqual([...b64(dk)]);
  });

  it("a 600,000-iteration hash made natively (like the build's bootstrap) verifies inside Workers", async () => {
    const stored = await full.hash(PW); // native, as in the Node build
    expect(stored).toMatch(/^pbkdf2-sha256\$600000\$/);
    asWorkers();
    expect(await full.verify(PW, stored)).toBe(true);
    expect(await full.verify("wrong password here 1", stored)).toBe(false);
  });

  it("a hash made inside Workers has the same readable format and verifies natively too", async () => {
    asWorkers();
    const stored = await full.hash(PW);
    expect(stored.split("$")).toHaveLength(4);
    expect(stored.split("$").slice(0, 2)).toEqual(["pbkdf2-sha256", "600000"]);
    vi.restoreAllMocks();
    expect(await full.verify(PW, stored)).toBe(true);
    expect(full.needsRehash(stored)).toBe(false);
  });

  it("hashes at or below 100,000 iterations still use native Web Crypto, even on Workers", async () => {
    const spy = asWorkers();
    const low = createPasswordHasher(WEBCRYPTO_MAX_ITERATIONS_WORKERS);
    const stored = await low.hash(PW);
    expect(await low.verify(PW, stored)).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it("any OTHER Web Crypto failure is an error, never silently swapped for the fallback", async () => {
    vi.spyOn(crypto.subtle, "deriveBits").mockRejectedValue(new Error("boom"));
    await expect(full.hash(PW)).rejects.toThrow("boom");
  });

  it("a deliberately absurd stored iteration count is still refused before any work", async () => {
    expect(await full.verify(PW, "pbkdf2-sha256$99999999$AAAA$AAAA")).toBe(false);
  });
});
