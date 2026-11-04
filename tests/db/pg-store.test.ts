import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { adminUser } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { PgAdminStore, createAdminUser } from "@/lib/auth/pg-store";
import { generateToken, hashToken } from "@/lib/auth/service";

// Integration test against the real database. Uses unique random identifiers
// and deletes only its own rows.
const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(3)));
const suffix = crypto.randomUUID();

describe.skipIf(!process.env.DATABASE_URL)("PgAdminStore", () => {
  const db = process.env.DATABASE_URL ? getDb() : (null as never);
  const store = new PgAdminStore(db, key);
  const email = `test-${suffix}@example.test`;
  let userId = 0;

  beforeAll(async () => {
    userId = await createAdminUser(db, key, { email, passwordHash: "hash", role: "owner", totpSecret: "JBSWY3DPEHPK3PXP" });
  });
  afterAll(async () => {
    await store.clearEvents(`k-${suffix}`);
    await db.delete(adminUser).where(eq(adminUser.id, userId)); // sessions/resets cascade
  });

  it("stores the TOTP seed encrypted and returns it decrypted", async () => {
    const [raw] = await db.select().from(adminUser).where(eq(adminUser.id, userId));
    expect(raw.totpSecretEnc).toMatch(/^v1\./);
    expect(raw.totpSecretEnc).not.toContain("JBSWY3DPEHPK3PXP");
    const u = await store.findUserByEmail(email);
    expect(u).toMatchObject({ id: userId, role: "owner", totpSecret: "JBSWY3DPEHPK3PXP", disabled: false, totpLastStep: null });
  });
  it("refuses to downgrade to no-2FA when the key is wrong", async () => {
    const wrong = new PgAdminStore(db, btoa(String.fromCharCode(...new Uint8Array(32).fill(4))));
    await expect(wrong.findUserById(userId)).rejects.toThrow(/SECRET_BOX_KEY/);
  });
  it("only moves the TOTP replay marker forward", async () => {
    await store.setTotpLastStep(userId, 100);
    await store.setTotpLastStep(userId, 90);
    expect((await store.findUserById(userId))!.totpLastStep).toBe(100);
  });
  it("creates, touches and deletes sessions", async () => {
    const th = await hashToken(generateToken());
    const now = new Date();
    await store.createSession({ tokenHash: th, userId, createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + 60_000) });
    expect((await store.getSession(th))?.userId).toBe(userId);
    const later = new Date(now.getTime() + 5_000);
    await store.touchSession(th, later);
    expect((await store.getSession(th))!.lastSeenAt.getTime()).toBe(later.getTime());
    await store.deleteSession(th);
    expect(await store.getSession(th)).toBeNull();
  });
  it("deleteUserSessions removes all of a user's sessions", async () => {
    const now = new Date();
    const hashes = [await hashToken(generateToken()), await hashToken(generateToken())];
    for (const tokenHash of hashes) {
      await store.createSession({ tokenHash, userId, createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + 60_000) });
    }
    await store.deleteUserSessions(userId);
    for (const h of hashes) expect(await store.getSession(h)).toBeNull();
  });
  it("counts events inside the window only, and clears them", async () => {
    const k = `k-${suffix}`;
    const now = Date.now();
    await store.recordEvent(k, new Date(now - 3_600_000));
    await store.recordEvent(k, new Date(now - 1_000));
    await store.recordEvent(k, new Date(now));
    expect(await store.countEvents(k, new Date(now - 60_000))).toBe(2);
    await store.clearEvents(k);
    expect(await store.countEvents(k, new Date(0))).toBe(0);
  });
  it("consumes a reset token exactly once, even under concurrency, and never when expired", async () => {
    const now = new Date();
    const th = await hashToken(generateToken());
    await store.createResetToken({ tokenHash: th, userId, expiresAt: new Date(now.getTime() + 60_000), usedAt: null });
    const results = await Promise.all([1, 2, 3, 4].map(() => store.consumeResetToken(th, now)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await store.findResetToken(th))!.usedAt).not.toBeNull();

    const expired = await hashToken(generateToken());
    await store.createResetToken({ tokenHash: expired, userId, expiresAt: new Date(now.getTime() - 1), usedAt: null });
    expect(await store.consumeResetToken(expired, now)).toBe(false);
  });
});
