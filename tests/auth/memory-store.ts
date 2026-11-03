import type { AdminStore, AdminUserRecord, ResetTokenRecord, SessionRecord } from "@/lib/auth/service";

// TEST-ONLY in-memory AdminStore. Deliberately lives under tests/ so it can
// never be imported by application code as an insecure fallback.
export class MemoryStore implements AdminStore {
  users = new Map<number, AdminUserRecord>();
  sessions = new Map<string, SessionRecord>();
  events = new Map<string, Date[]>();
  resets = new Map<string, ResetTokenRecord>();
  touches = 0;

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
}
