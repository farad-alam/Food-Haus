import { and, count, eq, gt, gte, isNull, lt, ne, or } from "drizzle-orm";
import { adminSession, adminSetupToken, adminUser, authEvent, passwordResetToken, recoveryCode, totpEnrolment } from "@/db/schema";
import type { Db } from "@/lib/db/client";
import { openSecret, sealSecret } from "./secret-box";
import type { AdminStore, AdminUserRecord, ResetTokenRecord, SessionRecord } from "./service";
import type { Role } from "./rbac";

// Postgres implementation of AdminStore. All SQL is parameterised through
// Drizzle. TOTP seeds are encrypted with AES-GCM (secret-box.ts) before they
// reach the database and decrypted on read.

export class PgAdminStore implements AdminStore {
  constructor(
    private db: Db,
    private secretKey: string,
  ) {}

  private async toRecord(r: typeof adminUser.$inferSelect): Promise<AdminUserRecord> {
    let totpSecret: string | null = null;
    if (r.totpSecretEnc) {
      totpSecret = await openSecret(r.totpSecretEnc, this.secretKey);
      // An undecryptable seed (wrong key) must not silently downgrade the
      // account to "no 2FA": fail loudly so the key problem gets fixed.
      if (totpSecret === null) throw new Error(`Cannot decrypt TOTP secret for admin user ${r.id}; check SECRET_BOX_KEY.`);
    }
    return {
      id: r.id,
      email: r.email,
      passwordHash: r.passwordHash,
      role: r.role as Role,
      totpSecret,
      totpLastStep: r.totpLastStep,
      disabled: r.disabled,
    };
  }

  async findUserByEmail(email: string) {
    const [r] = await this.db.select().from(adminUser).where(eq(adminUser.email, email)).limit(1);
    return r ? this.toRecord(r) : null;
  }
  async findUserById(id: number) {
    const [r] = await this.db.select().from(adminUser).where(eq(adminUser.id, id)).limit(1);
    return r ? this.toRecord(r) : null;
  }
  async setPasswordHash(userId: number, hash: string) {
    await this.db.update(adminUser).set({ passwordHash: hash }).where(eq(adminUser.id, userId));
  }
  async setTotpLastStep(userId: number, step: number) {
    // Monotonic: never move the replay marker backwards.
    await this.db
      .update(adminUser)
      .set({ totpLastStep: step })
      .where(and(eq(adminUser.id, userId), or(isNull(adminUser.totpLastStep), lt(adminUser.totpLastStep, step))));
  }

  async createSession(s: SessionRecord) {
    await this.db.insert(adminSession).values(s);
  }
  async getSession(tokenHash: string) {
    const [r] = await this.db.select().from(adminSession).where(eq(adminSession.tokenHash, tokenHash)).limit(1);
    return r ?? null;
  }
  async touchSession(tokenHash: string, at: Date) {
    await this.db.update(adminSession).set({ lastSeenAt: at }).where(eq(adminSession.tokenHash, tokenHash));
  }
  async deleteSession(tokenHash: string) {
    await this.db.delete(adminSession).where(eq(adminSession.tokenHash, tokenHash));
  }
  async deleteUserSessions(userId: number) {
    await this.db.delete(adminSession).where(eq(adminSession.userId, userId));
  }

  async recordEvent(key: string, at: Date) {
    await this.db.insert(authEvent).values({ key, at });
  }
  async countEvents(key: string, since: Date) {
    const [r] = await this.db
      .select({ n: count() })
      .from(authEvent)
      .where(and(eq(authEvent.key, key), gte(authEvent.at, since)));
    return r?.n ?? 0;
  }
  async clearEvents(key: string) {
    await this.db.delete(authEvent).where(eq(authEvent.key, key));
  }

  async createResetToken(t: ResetTokenRecord) {
    await this.db.insert(passwordResetToken).values(t);
  }
  async findResetToken(tokenHash: string) {
    const [r] = await this.db.select().from(passwordResetToken).where(eq(passwordResetToken.tokenHash, tokenHash)).limit(1);
    return r ?? null;
  }
  async consumeResetToken(tokenHash: string, now: Date) {
    // Single conditional UPDATE: two concurrent requests cannot both win.
    const rows = await this.db
      .update(passwordResetToken)
      .set({ usedAt: now })
      .where(
        and(eq(passwordResetToken.tokenHash, tokenHash), isNull(passwordResetToken.usedAt), gt(passwordResetToken.expiresAt, now)),
      )
      .returning({ h: passwordResetToken.tokenHash });
    return rows.length === 1;
  }

  // ---- two-step login enrolment (R9.2) ----------------------------------------------------

  async setPendingTotp(userId: number, secret: string, now: Date) {
    const secretEnc = await sealSecret(secret, this.secretKey);
    await this.db.insert(totpEnrolment).values({ userId, secretEnc, createdAt: now }).onConflictDoUpdate({ target: totpEnrolment.userId, set: { secretEnc, createdAt: now } });
  }
  async getPendingTotp(userId: number) {
    const [r] = await this.db.select().from(totpEnrolment).where(eq(totpEnrolment.userId, userId)).limit(1);
    if (!r) return null;
    const secret = await openSecret(r.secretEnc, this.secretKey);
    return secret === null ? null : { secret, createdAt: r.createdAt };
  }
  async activateTotp(a: { userId: number; secret: string; lastStep: number; recoveryHashes: string[]; keepSessionHash?: string }) {
    const secretEnc = await sealSecret(a.secret, this.secretKey);
    const sessions = a.keepSessionHash ? and(eq(adminSession.userId, a.userId), ne(adminSession.tokenHash, a.keepSessionHash)) : eq(adminSession.userId, a.userId);
    await this.db.batch([
      this.db.update(adminUser).set({ totpSecretEnc: secretEnc, totpLastStep: a.lastStep }).where(eq(adminUser.id, a.userId)),
      this.db.delete(totpEnrolment).where(eq(totpEnrolment.userId, a.userId)),
      this.db.delete(recoveryCode).where(eq(recoveryCode.userId, a.userId)),
      this.db.insert(recoveryCode).values(a.recoveryHashes.map((codeHash) => ({ userId: a.userId, codeHash }))),
      this.db.delete(adminSession).where(sessions),
    ]);
  }
  async clearTotp(userId: number) {
    await this.db.batch([
      this.db.update(adminUser).set({ totpSecretEnc: null, totpLastStep: null }).where(eq(adminUser.id, userId)),
      this.db.delete(totpEnrolment).where(eq(totpEnrolment.userId, userId)),
      this.db.delete(recoveryCode).where(eq(recoveryCode.userId, userId)),
      this.db.delete(adminSession).where(eq(adminSession.userId, userId)),
    ]);
  }
  async consumeRecoveryCode(userId: number, codeHash: string, now: Date) {
    // Single conditional UPDATE: two simultaneous logins cannot both spend the same code.
    const rows = await this.db
      .update(recoveryCode)
      .set({ usedAt: now })
      .where(and(eq(recoveryCode.userId, userId), eq(recoveryCode.codeHash, codeHash), isNull(recoveryCode.usedAt)))
      .returning({ id: recoveryCode.id });
    return rows.length === 1;
  }
  async countRecoveryCodes(userId: number) {
    const [r] = await this.db.select({ n: count() }).from(recoveryCode).where(and(eq(recoveryCode.userId, userId), isNull(recoveryCode.usedAt)));
    return r?.n ?? 0;
  }
  async replaceRecoveryCodes(userId: number, hashes: string[]) {
    await this.db.batch([
      this.db.delete(recoveryCode).where(eq(recoveryCode.userId, userId)),
      this.db.insert(recoveryCode).values(hashes.map((codeHash) => ({ userId, codeHash }))),
    ]);
  }
  async createSetupToken(t: { tokenHash: string; userId: number; expiresAt: Date }) {
    await this.db.insert(adminSetupToken).values(t);
  }
  async findSetupToken(tokenHash: string) {
    const [r] = await this.db.select().from(adminSetupToken).where(eq(adminSetupToken.tokenHash, tokenHash)).limit(1);
    return r ? { userId: r.userId, expiresAt: r.expiresAt, usedAt: r.usedAt } : null;
  }
  async consumeSetupToken(tokenHash: string, now: Date) {
    const rows = await this.db
      .update(adminSetupToken)
      .set({ usedAt: now })
      .where(and(eq(adminSetupToken.tokenHash, tokenHash), isNull(adminSetupToken.usedAt), gt(adminSetupToken.expiresAt, now)))
      .returning({ h: adminSetupToken.tokenHash });
    return rows.length === 1;
  }
}

/** For the bootstrap script: create an admin user with an encrypted TOTP seed. */
export async function createAdminUser(
  db: Db,
  secretKey: string,
  u: { email: string; passwordHash: string; role: Role; totpSecret?: string },
) {
  const [r] = await db
    .insert(adminUser)
    .values({
      email: u.email.toLowerCase(),
      passwordHash: u.passwordHash,
      role: u.role,
      totpSecretEnc: u.totpSecret ? await sealSecret(u.totpSecret, secretKey) : null,
    })
    .returning({ id: adminUser.id });
  return r.id;
}
