import { describe, expect, it } from "vitest";
import { openSecret, sealSecret } from "@/lib/auth/secret-box";

const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const other = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

describe("secret box", () => {
  it("round-trips and uses a fresh IV each time", async () => {
    const a = await sealSecret("JBSWY3DPEHPK3PXP", key);
    const b = await sealSecret("JBSWY3DPEHPK3PXP", key);
    expect(a).not.toBe(b);
    expect(a).not.toContain("JBSWY3DPEHPK3PXP");
    expect(await openSecret(a, key)).toBe("JBSWY3DPEHPK3PXP");
  });
  it("rejects the wrong key, tampering and junk", async () => {
    const a = await sealSecret("secret", key);
    expect(await openSecret(a, other)).toBeNull();
    const flipped = a.slice(0, -2) + (a.endsWith("AA") ? "BB" : "AA");
    expect(await openSecret(flipped, key)).toBeNull();
    expect(await openSecret("plain", key)).toBeNull();
    expect(await openSecret("v1.", key)).toBeNull();
  });
  it("rejects a key of the wrong length", async () => {
    await expect(sealSecret("x", btoa("short"))).rejects.toThrow(/32 bytes/);
  });
});
