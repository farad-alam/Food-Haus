import type { AdminStore, AdminUserRecord, ResetTokenRecord, SessionRecord } from "@/lib/auth/service";

// TEST-ONLY in-memory AdminStore. Deliberately lives under tests/ so it can
// never be imported by application code as an insecure fallback.
export class MemoryStore implements AdminStore {
  users = new Map<number, AdminUserRecord>();
  sessions = new Map<string, SessionRecord>();
  events = new Map<string, Date[]>();
  resets = new Map<string, ResetTokenRecord>();
  touches = 0;
  pending = new Map<number, { secret: string; createdAt: Date }>();
  recovery = new Map<number, { hash: string; usedAt: Date | null }[]>();
  setups = new Map<string, { userId: number; expiresAt: Date; usedAt: Date | null }>();

  addUser(u: AdminUserRecord) {
    this.users.set(u.id, u);
  }
  async findUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async findUserById(id: number) {
    return this.users.get(id) ?? null;
  }
  async setPasswordHash(userId: number, hash: string) {
    const u = this.users.get(userId);
    if (u) u.passwordHash = hash;
  }
  async setTotpLastStep(userId: number, step: number) {
    const u = this.users.get(userId);
    if (u) u.totpLastStep = step;
  }
  async createSession(s: SessionRecord) {
    this.sessions.set(s.tokenHash, { ...s });
  }
  async getSession(tokenHash: string) {
    const s = this.sessions.get(tokenHash);
    return s ? { ...s } : null;
  }
  async touchSession(tokenHash: string, at: Date) {
    this.touches++;
    const s = this.sessions.get(tokenHash);
    if (s) s.lastSeenAt = at;
  }
  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
  async deleteUserSessions(userId: number) {
    for (const [k, s] of this.sessions) if (s.userId === userId) this.sessions.delete(k);
  }
  async recordEvent(key: string, at: Date) {
    this.events.set(key, [...(this.events.get(key) ?? []), at]);
  }
  async countEvents(key: string, since: Date) {
    return (this.events.get(key) ?? []).filter((d) => d >= since).length;
  }
  async clearEvents(key: string) {
    this.events.delete(key);
  }
  async createResetToken(t: ResetTokenRecord) {
    this.resets.set(t.tokenHash, { ...t });
  }
  async findResetToken(tokenHash: string) {
    const t = this.resets.get(tokenHash);
    return t ? { ...t } : null;
  }
  async consumeResetToken(tokenHash: string, now: Date) {
    const t = this.resets.get(tokenHash);
    if (!t || t.usedAt || now >= t.expiresAt) return false;
    t.usedAt = now;
    return true;
  }

  // ---- two-step login enrolment ----
  async setPendingTotp(userId: number, secret: string, now: Date) {
    this.pending.set(userId, { secret, createdAt: now });
  }
  async getPendingTotp(userId: number) {
    const p = this.pending.get(userId);
    return p ? { ...p } : null;
  }
  async activateTotp(a: { userId: number; secret: string; lastStep: number; recoveryHashes: string[]; keepSessionHash?: string }) {
    const u = this.users.get(a.userId);
    if (u) {
      u.totpSecret = a.secret;
      u.totpLastStep = a.lastStep;
    }
    this.pending.delete(a.userId);
    this.recovery.set(a.userId, a.recoveryHashes.map((hash) => ({ hash, usedAt: null })));
    for (const [k, sess] of this.sessions) if (sess.userId === a.userId && k !== a.keepSessionHash) this.sessions.delete(k);
  }
  async clearTotp(userId: number) {
    const u = this.users.get(userId);
    if (u) {
      u.totpSecret = null;
      u.totpLastStep = null;
    }
    this.pending.delete(userId);
    this.recovery.delete(userId);
    await this.deleteUserSessions(userId);
  }
  async consumeRecoveryCode(userId: number, codeHash: string, now: Date) {
    const c = (this.recovery.get(userId) ?? []).find((x) => x.hash === codeHash && !x.usedAt);
    if (!c) return false;
    c.usedAt = now;
    return true;
  }
  async countRecoveryCodes(userId: number) {
    return (this.recovery.get(userId) ?? []).filter((x) => !x.usedAt).length;
  }
  async replaceRecoveryCodes(userId: number, hashes: string[]) {
    this.recovery.set(userId, hashes.map((hash) => ({ hash, usedAt: null })));
  }
  async createSetupToken(t: { tokenHash: string; userId: number; expiresAt: Date }) {
    this.setups.set(t.tokenHash, { userId: t.userId, expiresAt: t.expiresAt, usedAt: null });
  }
  async findSetupToken(tokenHash: string) {
    const t = this.setups.get(tokenHash);
    return t ? { ...t } : null;
  }
  async consumeSetupToken(tokenHash: string, now: Date) {
    const t = this.setups.get(tokenHash);
    if (!t || t.usedAt || now >= t.expiresAt) return false;
    t.usedAt = now;
    return true;
  }
}
