import { requiresTwoStep, type Role } from "./rbac";
import { passwordHasher, validatePasswordPolicy, type PasswordHasher } from "./password";
import { verifyTotp } from "./totp";
import { hashRecoveryCode, looksLikeRecoveryCode } from "./recovery";

// Admin authentication logic (R9.1, R9.2, R13.3). Storage-agnostic: everything
// persistent goes through AdminStore, so this file has no database or framework
// imports and is fully testable. The Postgres/Drizzle implementation of
// AdminStore is a thin adapter written once the database exists.

// ---- storage contract -----------------------------------------------------

export type AdminUserRecord = {
  id: number;
  email: string; // stored lower-case
  passwordHash: string;
  role: Role;
  totpSecret: string | null; // base32; the store decrypts it (encrypted at rest)
  totpLastStep: number | null;
  disabled: boolean;
};

export type SessionRecord = {
  tokenHash: string;
  userId: number;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
};

export type ResetTokenRecord = { tokenHash: string; userId: number; expiresAt: Date; usedAt: Date | null };

export interface AdminStore {
  findUserByEmail(email: string): Promise<AdminUserRecord | null>;
  findUserById(id: number): Promise<AdminUserRecord | null>;
  setPasswordHash(userId: number, hash: string): Promise<void>;
  setTotpLastStep(userId: number, step: number): Promise<void>;

  createSession(s: SessionRecord): Promise<void>;
  getSession(tokenHash: string): Promise<SessionRecord | null>;
  touchSession(tokenHash: string, at: Date): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteUserSessions(userId: number): Promise<void>;

  /** Generic throttling counters (failed logins, reset requests). */
  recordEvent(key: string, at: Date): Promise<void>;
  countEvents(key: string, since: Date): Promise<number>;
  clearEvents(key: string): Promise<void>;

  createResetToken(t: ResetTokenRecord): Promise<void>;
  findResetToken(tokenHash: string): Promise<ResetTokenRecord | null>;
  /** Atomic: marks the token used only if it is still unused and unexpired. */
  consumeResetToken(tokenHash: string, now: Date): Promise<boolean>;

  // ---- two-step login enrolment (R9.2) ----
  /** The not-yet-confirmed secret shown as a QR code. Replaces any earlier pending one. */
  setPendingTotp(userId: number, secret: string, now: Date): Promise<void>;
  getPendingTotp(userId: number): Promise<{ secret: string; createdAt: Date } | null>;
  /**
   * ONE transaction: store the secret and its replay marker, clear the pending secret,
   * replace all recovery codes, and end the user's sessions (except `keepSessionHash`).
   */
  activateTotp(a: { userId: number; secret: string; lastStep: number; recoveryHashes: string[]; keepSessionHash?: string }): Promise<void>;
  /** Removes the authenticator, pending secret, recovery codes and sessions (operator reset). */
  clearTotp(userId: number): Promise<void>;
  /** Atomic: marks the code used only if it is still unused. */
  consumeRecoveryCode(userId: number, codeHash: string, now: Date): Promise<boolean>;
  countRecoveryCodes(userId: number): Promise<number>;
  replaceRecoveryCodes(userId: number, hashes: string[]): Promise<void>;
  /** One-time link that permits first-time setup. */
  createSetupToken(t: { tokenHash: string; userId: number; expiresAt: Date }): Promise<void>;
  findSetupToken(tokenHash: string): Promise<{ userId: number; expiresAt: Date; usedAt: Date | null } | null>;
  /** Atomic: marks the link used only if it is still unused and unexpired. */
  consumeSetupToken(tokenHash: string, now: Date): Promise<boolean>;
}

// ---- tuning ---------------------------------------------------------------

export const LOGIN_WINDOW_MS = 15 * 60_000;
export const MAX_FAILS_PER_ACCOUNT_AND_IP = 5;
export const MAX_FAILS_PER_IP = 20;
export const MAX_FAILS_PER_ACCOUNT_ANY_IP = 50; // distributed brute-force guard
export const OWNER_MANAGER_IDLE_MS = 30 * 60_000; // R9.2 auto-logout on inactivity
export const OWNER_MANAGER_ABSOLUTE_MS = 12 * 3_600_000;
export const KITCHEN_ABSOLUTE_MS = 14 * 24 * 3_600_000; // always-on tablet; no idle timeout
export const TOUCH_INTERVAL_MS = 60_000;
export const RESET_TTL_MS = 30 * 60_000;
export const RESET_REQUESTS_PER_HOUR = 3;

// ---- tokens ---------------------------------------------------------------

/** 256-bit random token (cookie value / reset link). Only its hash is stored. */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 hex. Fine without a salt/stretch because the input is 256 random bits. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- login ----------------------------------------------------------------

export type LoginFailure =
  | "invalid_credentials" // unknown user AND wrong password look identical
  | "locked" // too many recent failures
  | "totp_required" // password was right; send the code
  | "invalid_totp"
  | "totp_enrolment_required"; // owner/manager without 2FA set up cannot sign in

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; user: { id: number; email: string; role: Role }; recoveryCodeUsed?: boolean; recoveryCodesLeft?: number }
  | { ok: false; reason: LoginFailure };

const dummyHashes = new WeakMap<PasswordHasher, Promise<string>>();
function dummyHash(hasher: PasswordHasher): Promise<string> {
  let p = dummyHashes.get(hasher);
  if (!p) {
    p = hasher.hash(generateToken());
    dummyHashes.set(hasher, p);
  }
  return p;
}

export const normEmail = (e: string) => e.trim().toLowerCase();

/** Verifies a password, doing equal work for an unknown account so timing reveals nothing. */
export async function checkPassword(hasher: PasswordHasher, user: AdminUserRecord | null, password: string): Promise<boolean> {
  return hasher.verify(password, user ? user.passwordHash : await dummyHash(hasher));
}

export function loginKeys(email: string, ip: string) {
  return {
    both: `login:acct+ip:${email}|${ip}`,
    ip: `login:ip:${ip}`,
    acct: `login:acct:${email}`,
  };
}

export async function login(
  store: AdminStore,
  input: { email: string; password: string; totp?: string; ip: string },
  now: Date,
  hasher: PasswordHasher = passwordHasher,
): Promise<LoginResult> {
  const email = normEmail(input.email);
  const keys = loginKeys(email, input.ip);
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS);

  // Lockouts are per account+IP, per IP, and a high per-account ceiling. Keying the
  // tight limit on account+IP means a stranger hammering the shared Kitchen login
  // from elsewhere cannot lock the kitchen out during service.
  const [both, ip, acct] = await Promise.all([
    store.countEvents(keys.both, since),
    store.countEvents(keys.ip, since),
    store.countEvents(keys.acct, since),
  ]);
  if (both >= MAX_FAILS_PER_ACCOUNT_AND_IP || ip >= MAX_FAILS_PER_IP || acct >= MAX_FAILS_PER_ACCOUNT_ANY_IP) {
    return { ok: false, reason: "locked" };
  }

  const fail = async (reason: LoginFailure): Promise<LoginResult> => {
    await Promise.all([store.recordEvent(keys.both, now), store.recordEvent(keys.ip, now), store.recordEvent(keys.acct, now)]);
    return { ok: false, reason };
  };

  let usedRecovery = false;
  const user = await store.findUserByEmail(email);
  // Always run one full hash verification, so a missing account takes as long as a
  // wrong password and response time does not reveal which emails exist.
  const passwordOk = await hasher.verify(input.password, user ? user.passwordHash : await dummyHash(hasher));
  if (!user || user.disabled || !passwordOk) return fail("invalid_credentials");

  if (requiresTwoStep(user.role)) {
    if (!user.totpSecret) return { ok: false, reason: "totp_enrolment_required" };
    if (!input.totp) return { ok: false, reason: "totp_required" }; // not counted: password alone was right
    if (looksLikeRecoveryCode(input.totp)) {
      // A recovery code stands in for the authenticator code, once. A wrong one counts as a failed attempt.
      if (!(await store.consumeRecoveryCode(user.id, await hashRecoveryCode(input.totp), now))) return fail("invalid_totp");
      usedRecovery = true;
    } else {
      const t = await verifyTotp(user.totpSecret, input.totp, now.getTime(), user.totpLastStep);
      if (!t.ok) return fail("invalid_totp");
      await store.setTotpLastStep(user.id, t.step); // replay protection
    }
  }

  await Promise.all([store.clearEvents(keys.both)]);
  if (hasher.needsRehash(user.passwordHash)) await store.setPasswordHash(user.id, await hasher.hash(input.password));

  const token = generateToken();
  const lifetime = requiresTwoStep(user.role) ? OWNER_MANAGER_ABSOLUTE_MS : KITCHEN_ABSOLUTE_MS;
  const expiresAt = new Date(now.getTime() + lifetime);
  await store.createSession({ tokenHash: await hashToken(token), userId: user.id, createdAt: now, lastSeenAt: now, expiresAt });
  return {
    ok: true,
    token,
    expiresAt,
    user: { id: user.id, email: user.email, role: user.role },
    ...(usedRecovery ? { recoveryCodeUsed: true, recoveryCodesLeft: await store.countRecoveryCodes(user.id) } : {}),
  };
}

// ---- session check --------------------------------------------------------

export type AuthResult =
  | { ok: true; user: { id: number; email: string; role: Role } }
  | { ok: false; reason: "no_session" | "expired" | "idle_timeout" | "disabled" };

/**
 * `touch: false` is for background polling (the order board): it must not
 * count as user activity, or an open board would defeat the owner/manager
 * idle timeout (R9.2). The idle check itself still applies.
 */
export async function authenticate(
  store: AdminStore,
  token: string | undefined,
  now: Date,
  options: { touch?: boolean } = {},
): Promise<AuthResult> {
  if (!token) return { ok: false, reason: "no_session" };
  const tokenHash = await hashToken(token);
  const session = await store.getSession(tokenHash);
  if (!session) return { ok: false, reason: "no_session" };

  if (now >= session.expiresAt) {
    await store.deleteSession(tokenHash);
    return { ok: false, reason: "expired" };
  }
  const user = await store.findUserById(session.userId);
  if (!user || user.disabled) {
    await store.deleteSession(tokenHash);
    return { ok: false, reason: "disabled" };
  }
  if (requiresTwoStep(user.role) && now.getTime() - session.lastSeenAt.getTime() > OWNER_MANAGER_IDLE_MS) {
    await store.deleteSession(tokenHash);
    return { ok: false, reason: "idle_timeout" };
  }
  if (options.touch !== false && now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await store.touchSession(tokenHash, now);
  }
  return { ok: true, user: { id: user.id, email: user.email, role: user.role } };
}

export async function logout(store: AdminStore, token: string | undefined): Promise<void> {
  if (token) await store.deleteSession(await hashToken(token));
}

// ---- password reset (R9.1) -------------------------------------------------

/**
 * The HTTP response to a reset request must be IDENTICAL whether or not the email
 * exists (no account enumeration). So this returns the email to send, or null, and
 * the caller shows the same "if that account exists, we've emailed it" message either way.
 */
export async function requestPasswordReset(
  store: AdminStore,
  emailRaw: string,
  now: Date,
): Promise<{ delivery: { email: string; token: string; expiresAt: Date } | null }> {
  const email = normEmail(emailRaw);
  const key = `reset:${email}`;
  const recent = await store.countEvents(key, new Date(now.getTime() - 3_600_000));
  await store.recordEvent(key, now);
  if (recent >= RESET_REQUESTS_PER_HOUR) return { delivery: null };

  const user = await store.findUserByEmail(email);
  if (!user || user.disabled) return { delivery: null };

  const token = generateToken();
  const expiresAt = new Date(now.getTime() + RESET_TTL_MS);
  await store.createResetToken({ tokenHash: await hashToken(token), userId: user.id, expiresAt, usedAt: null });
  return { delivery: { email: user.email, token, expiresAt } };
}

export type ResetResult =
  | { ok: true }
  | { ok: false; reason: "invalid_token" }
  | { ok: false; reason: "weak_password"; message: string };

export async function completePasswordReset(
  store: AdminStore,
  input: { token: string; newPassword: string },
  now: Date,
  hasher: PasswordHasher = passwordHasher,
): Promise<ResetResult> {
  const tokenHash = await hashToken(input.token);
  const rec = await store.findResetToken(tokenHash);
  if (!rec || rec.usedAt || now >= rec.expiresAt) return { ok: false, reason: "invalid_token" };
  const user = await store.findUserById(rec.userId);
  if (!user || user.disabled) return { ok: false, reason: "invalid_token" };

  // Policy is checked BEFORE consuming, so a rejected weak password doesn't burn the link.
  const problem = validatePasswordPolicy(input.newPassword, { email: user.email });
  if (problem) return { ok: false, reason: "weak_password", message: problem };

  if (!(await store.consumeResetToken(tokenHash, now))) return { ok: false, reason: "invalid_token" };
  await store.setPasswordHash(user.id, await hasher.hash(input.newPassword));
  await store.deleteUserSessions(user.id); // sign out everywhere
  await store.clearEvents(`login:acct:${user.email}`);
  return { ok: true };
}
