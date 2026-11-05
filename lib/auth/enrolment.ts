import { requiresTwoStep } from "./rbac";
import { generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode } from "./recovery";
import {
  checkPassword,
  generateToken,
  hashToken,
  LOGIN_WINDOW_MS,
  loginKeys,
  MAX_FAILS_PER_ACCOUNT_AND_IP,
  MAX_FAILS_PER_ACCOUNT_ANY_IP,
  MAX_FAILS_PER_IP,
  normEmail,
  type AdminStore,
  type AdminUserRecord,
} from "./service";
import { passwordHasher, type PasswordHasher } from "./password";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp";

// Two-step login enrolment (R9.2). Storage-agnostic, like service.ts.
//
// FIRST-TIME setup needs a one-time link the OPERATOR issues AND the account
// password. A stolen password alone therefore cannot enrol an attacker's phone
// on an account that has no authenticator yet.
// CHANGING an authenticator while signed in needs the password AND a current
// code, so a hijacked session cookie alone cannot swap it.

export const SETUP_TTL_MS = 24 * 3_600_000;
export const PENDING_TTL_MS = 30 * 60_000;

export async function issueSetupToken(store: AdminStore, userId: number, now: Date): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + SETUP_TTL_MS);
  await store.createSetupToken({ tokenHash: await hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

// ---- throttling (shares the login limits and window) -----------------------------------

type Scope = "setup" | "login";
function keysFor(scope: Scope, email: string, ip: string) {
  return scope === "login"
    ? loginKeys(email, ip) // re-authentication shares the sign-in lockout
    : { both: `setup:acct+ip:${email}|${ip}`, ip: `setup:ip:${ip}`, acct: `setup:acct:${email}` };
}
export async function isLocked(store: AdminStore, scope: Scope, emailRaw: string, ip: string, now: Date): Promise<boolean> {
  const k = keysFor(scope, normEmail(emailRaw), ip);
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const [both, byIp, acct] = await Promise.all([store.countEvents(k.both, since), store.countEvents(k.ip, since), store.countEvents(k.acct, since)]);
  return both >= MAX_FAILS_PER_ACCOUNT_AND_IP || byIp >= MAX_FAILS_PER_IP || acct >= MAX_FAILS_PER_ACCOUNT_ANY_IP;
}
export async function recordFailure(store: AdminStore, scope: Scope, emailRaw: string, ip: string, now: Date): Promise<void> {
  const k = keysFor(scope, normEmail(emailRaw), ip);
  await Promise.all([store.recordEvent(k.both, now), store.recordEvent(k.ip, now), store.recordEvent(k.acct, now)]);
}

// ---- first-time setup (link + password) ---------------------------------------------------

export type SetupCheck = { ok: true; user: AdminUserRecord } | { ok: false; reason: "locked" | "invalid" };

/**
 * One generic failure for a wrong link, a wrong password, an unknown account, an
 * account that does not need 2FA, or someone else's link: nothing here reveals which.
 */
export async function checkSetupCredentials(
  store: AdminStore,
  input: { token: string; email: string; password: string },
  ip: string,
  now: Date,
  hasher: PasswordHasher = passwordHasher,
): Promise<SetupCheck> {
  if (await isLocked(store, "setup", input.email, ip, now)) return { ok: false, reason: "locked" };
  const user = await store.findUserByEmail(normEmail(input.email));
  const passwordOk = await checkPassword(hasher, user, input.password); // equal work for unknown accounts
  const rec = await store.findSetupToken(await hashToken(input.token));
  const linkOk = !!rec && !!user && rec.userId === user.id && !rec.usedAt && now < rec.expiresAt;
  if (!user || user.disabled || !requiresTwoStep(user.role) || !passwordOk || !linkOk) {
    await recordFailure(store, "setup", input.email, ip, now);
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, user };
}

// ---- begin / confirm ----------------------------------------------------------------------

/** Makes a fresh secret, keeps it server-side as PENDING, and returns what the QR code needs. */
export async function beginEnrolment(store: AdminStore, user: Pick<AdminUserRecord, "id" | "email">, now: Date): Promise<{ secret: string; uri: string }> {
  const secret = generateTotpSecret();
  await store.setPendingTotp(user.id, secret, now);
  return { secret, uri: otpauthUri(secret, user.email) };
}

export type ConfirmResult = { ok: true; recoveryCodes: string[] } | { ok: false; reason: "no_pending" | "invalid_code" | "link_used" };

/**
 * The user proves their app works by typing a code from the PENDING secret. Only then is it
 * activated, with a fresh set of recovery codes (shown once), and the account's other sessions ended.
 */
export async function confirmEnrolment(
  store: AdminStore,
  user: Pick<AdminUserRecord, "id">,
  code: string,
  now: Date,
  opts: { setupTokenHash?: string; keepSessionHash?: string } = {},
): Promise<ConfirmResult> {
  const pending = await store.getPendingTotp(user.id);
  if (!pending || now.getTime() - pending.createdAt.getTime() > PENDING_TTL_MS) return { ok: false, reason: "no_pending" };
  const t = await verifyTotp(pending.secret, code, now.getTime(), null);
  if (!t.ok) return { ok: false, reason: "invalid_code" };
  // The one-time link is spent only AFTER the code proves right, and exactly one request can spend it.
  if (opts.setupTokenHash && !(await store.consumeSetupToken(opts.setupTokenHash, now))) return { ok: false, reason: "link_used" };
  const recoveryCodes = generateRecoveryCodes();
  await store.activateTotp({
    userId: user.id,
    secret: pending.secret,
    lastStep: t.step, // this code cannot be replayed at the next sign-in
    recoveryHashes: await Promise.all(recoveryCodes.map(hashRecoveryCode)),
    keepSessionHash: opts.keepSessionHash,
  });
  return { ok: true, recoveryCodes };
}

// ---- changing things while signed in ------------------------------------------------------

export type ReauthResult = { ok: true; usedRecoveryCode: boolean } | { ok: false; reason: "locked" | "invalid_credentials" | "invalid_code" };

/** Password AND (current authenticator code OR a recovery code). Failures count towards the sign-in lockout. */
export async function reauthenticate(
  store: AdminStore,
  user: AdminUserRecord,
  input: { password: string; code: string },
  ip: string,
  now: Date,
  hasher: PasswordHasher = passwordHasher,
): Promise<ReauthResult> {
  if (await isLocked(store, "login", user.email, ip, now)) return { ok: false, reason: "locked" };
  const fail = async (reason: "invalid_credentials" | "invalid_code"): Promise<ReauthResult> => {
    await recordFailure(store, "login", user.email, ip, now);
    return { ok: false, reason };
  };
  if (!(await checkPassword(hasher, user, input.password))) return fail("invalid_credentials");
  if (!user.totpSecret) return fail("invalid_code");
  if (looksLikeRecoveryCode(input.code)) {
    if (!(await store.consumeRecoveryCode(user.id, await hashRecoveryCode(input.code), now))) return fail("invalid_code");
    return { ok: true, usedRecoveryCode: true };
  }
  const t = await verifyTotp(user.totpSecret, input.code, now.getTime(), user.totpLastStep);
  if (!t.ok) return fail("invalid_code");
  await store.setTotpLastStep(user.id, t.step);
  return { ok: true, usedRecoveryCode: false };
}

/** A new set of codes; the old ones stop working at once. Returns the plaintext (shown once). */
export async function regenerateRecoveryCodes(store: AdminStore, userId: number): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await store.replaceRecoveryCodes(userId, await Promise.all(codes.map(hashRecoveryCode)));
  return codes;
}
