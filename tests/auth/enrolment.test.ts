import { beforeEach, describe, expect, it } from "vitest";
import { createPasswordHasher } from "@/lib/auth/password";
import {
  beginEnrolment, checkSetupCredentials, confirmEnrolment, issueSetupToken, PENDING_TTL_MS, reauthenticate, regenerateRecoveryCodes, SETUP_TTL_MS,
} from "@/lib/auth/enrolment";
import { generateToken, hashToken, login, authenticate, MAX_FAILS_PER_ACCOUNT_AND_IP, type AdminUserRecord } from "@/lib/auth/service";
import { hashRecoveryCode } from "@/lib/auth/recovery";
import { totpAt } from "@/lib/auth/totp";
import { MemoryStore } from "./memory-store";

const hasher = createPasswordHasher(1000);
const T0 = new Date("2026-11-10T12:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;
const PW = { owner: "owner-secret-pass-333", other: "other-secret-pass-444", kitchen: "kitchen-tablet-pass-1" };
const IP = "203.0.113.9";
const code = async (secret: string, at: Date) => (await totpAt(secret, at.getTime()))!;

let store: MemoryStore;
async function user(id: number, email: string, role: AdminUserRecord["role"], pw: string) {
  store.addUser({ id, email, role, passwordHash: await hasher.hash(pw), totpSecret: null, totpLastStep: null, disabled: false });
}
/** Runs the whole first-time setup for a user; returns what a person would hold afterwards. */
async function enrol(userId: number, email: string, pw: string, at = T0) {
  const { token } = await issueSetupToken(store, userId, at);
  const chk = await checkSetupCredentials(store, { token, email, password: pw }, IP, at, hasher);
  if (!chk.ok) throw new Error("setup check failed");
  const { secret } = await beginEnrolment(store, chk.user, at);
  const r = await confirmEnrolment(store, chk.user, await code(secret, at), at, { setupTokenHash: await hashToken(token) });
  if (!r.ok) throw new Error("confirm failed: " + r.reason);
  return { token, secret, recoveryCodes: r.recoveryCodes };
}

beforeEach(async () => {
  store = new MemoryStore();
  await user(1, "owner@foodhaus.test", "owner", PW.owner);
  await user(2, "other@foodhaus.test", "manager", PW.other);
  await user(3, "kitchen@foodhaus.test", "kitchen", PW.kitchen);
});

describe("first-time setup link", () => {
  it("works with the link AND the password, then enrols with recovery codes", async () => {
    const { secret, recoveryCodes } = await enrol(1, "owner@foodhaus.test", PW.owner);
    expect(recoveryCodes).toHaveLength(10);
    expect((await store.findUserById(1))!.totpSecret).toBe(secret);
    expect(await store.countRecoveryCodes(1)).toBe(10);
  });
  it("gives ONE generic failure for every kind of wrong, and counts each as a failed attempt", async () => {
    const { token } = await issueSetupToken(store, 1, T0);
    const other = (await issueSetupToken(store, 2, T0)).token;
    const bad = [
      { token, email: "owner@foodhaus.test", password: "wrong-password-xx" }, // wrong password
      { token: generateToken(), email: "owner@foodhaus.test", password: PW.owner }, // wrong link
      { token: other, email: "owner@foodhaus.test", password: PW.owner }, // someone else's link
      { token, email: "nobody@foodhaus.test", password: PW.owner }, // unknown account
      { token, email: "OWNER@foodhaus.test", password: PW.other }, // right account, another person's password
    ];
    for (const b of bad) expect(await checkSetupCredentials(store, b, IP, T0, hasher)).toEqual({ ok: false, reason: "invalid" });
    expect((await checkSetupCredentials(store, { token, email: " Owner@FoodHaus.test ", password: PW.owner }, IP, T0, hasher)).ok).toBe(true); // email is case/space tolerant
  });
  it("refuses an expired link, a used link, a kitchen account (no 2FA) and a disabled account", async () => {
    const { token } = await issueSetupToken(store, 1, T0);
    expect((await checkSetupCredentials(store, { token, email: "owner@foodhaus.test", password: PW.owner }, IP, later(SETUP_TTL_MS + 1), hasher)).ok).toBe(false);
    expect((await checkSetupCredentials(store, { token, email: "owner@foodhaus.test", password: PW.owner }, IP, later(SETUP_TTL_MS - MIN), hasher)).ok).toBe(true);
    const k = (await issueSetupToken(store, 3, T0)).token;
    expect((await checkSetupCredentials(store, { token: k, email: "kitchen@foodhaus.test", password: PW.kitchen }, IP, T0, hasher)).ok).toBe(false);
    store.users.get(2)!.disabled = true;
    const m = (await issueSetupToken(store, 2, T0)).token;
    expect((await checkSetupCredentials(store, { token: m, email: "other@foodhaus.test", password: PW.other }, IP, T0, hasher)).ok).toBe(false);
  });
  it("is throttled like sign-in: after repeated failures even the right link and password are refused", async () => {
    const { token } = await issueSetupToken(store, 1, T0);
    for (let i = 0; i < MAX_FAILS_PER_ACCOUNT_AND_IP; i++) await checkSetupCredentials(store, { token, email: "owner@foodhaus.test", password: "nope-nope-nope-1" }, IP, T0, hasher);
    expect(await checkSetupCredentials(store, { token, email: "owner@foodhaus.test", password: PW.owner }, IP, T0, hasher)).toEqual({ ok: false, reason: "locked" });
    expect((await checkSetupCredentials(store, { token, email: "owner@foodhaus.test", password: PW.owner }, "198.51.100.1", T0, hasher)).ok).toBe(true); // another address is not locked out by it
  });
});

describe("begin and confirm", () => {
  it("nothing changes until a correct code from the PENDING secret is entered", async () => {
    const { token } = await issueSetupToken(store, 1, T0);
    const u = (await store.findUserById(1))!;
    const { secret } = await beginEnrolment(store, u, T0);
    expect(await confirmEnrolment(store, u, "000000", T0, { setupTokenHash: await hashToken(token) })).toEqual({ ok: false, reason: "invalid_code" });
    expect((await store.findUserById(1))!.totpSecret).toBeNull(); // still not enrolled
    expect(await store.countRecoveryCodes(1)).toBe(0);
    expect((await store.findSetupToken(await hashToken(token)))!.usedAt).toBeNull(); // a wrong code does NOT burn the link
    expect((await confirmEnrolment(store, u, await code(secret, T0), T0, { setupTokenHash: await hashToken(token) })).ok).toBe(true);
  });
  it("refuses to confirm without a begin, or after the pending secret expired", async () => {
    const u = (await store.findUserById(1))!;
    expect(await confirmEnrolment(store, u, "123456", T0)).toEqual({ ok: false, reason: "no_pending" });
    const { secret } = await beginEnrolment(store, u, T0);
    expect(await confirmEnrolment(store, u, await code(secret, later(PENDING_TTL_MS + MIN)), later(PENDING_TTL_MS + MIN))).toEqual({ ok: false, reason: "no_pending" });
  });
  it("starting again replaces the pending secret: a code from the old QR no longer works", async () => {
    const u = (await store.findUserById(1))!;
    const first = await beginEnrolment(store, u, T0);
    const second = await beginEnrolment(store, u, T0);
    expect(second.secret).not.toBe(first.secret);
    expect((await confirmEnrolment(store, u, await code(first.secret, T0), T0)).ok).toBe(false);
    expect((await confirmEnrolment(store, u, await code(second.secret, T0), T0)).ok).toBe(true);
  });
  it("the one-time link is spent exactly once; a second attempt with it is refused and changes nothing", async () => {
    const { token, secret } = await enrol(1, "owner@foodhaus.test", PW.owner);
    const u = (await store.findUserById(1))!;
    const again = await beginEnrolment(store, u, later(MIN));
    const r = await confirmEnrolment(store, u, await code(again.secret, later(MIN)), later(MIN), { setupTokenHash: await hashToken(token) });
    expect(r).toEqual({ ok: false, reason: "link_used" });
    expect((await store.findUserById(1))!.totpSecret).toBe(secret); // the original authenticator is untouched
    expect((await checkSetupCredentials(store, { token, email: "owner@foodhaus.test", password: PW.owner }, IP, later(MIN), hasher)).ok).toBe(false);
  });
  it("stores only hashes of the recovery codes, never the codes themselves", async () => {
    const { recoveryCodes } = await enrol(1, "owner@foodhaus.test", PW.owner);
    const stored = store.recovery.get(1)!.map((r) => r.hash);
    for (const c of recoveryCodes) {
      expect(stored).not.toContain(c);
      expect(stored).toContain(await hashRecoveryCode(c));
    }
  });
  it("ends the user's other sessions but keeps the one doing the change", async () => {
    const mk = async (h: string) => store.createSession({ tokenHash: h, userId: 1, createdAt: T0, lastSeenAt: T0, expiresAt: later(1e9) });
    await mk("old-1");
    await mk("keep-me");
    await mk("old-2");
    await store.createSession({ tokenHash: "someone-else", userId: 2, createdAt: T0, lastSeenAt: T0, expiresAt: later(1e9) });
    const u = (await store.findUserById(1))!;
    const { secret } = await beginEnrolment(store, u, T0);
    await confirmEnrolment(store, u, await code(secret, T0), T0, { keepSessionHash: "keep-me" });
    expect([...store.sessions.keys()].sort()).toEqual(["keep-me", "someone-else"]);
  });
  it("the code used to confirm cannot be replayed at the next sign-in", async () => {
    const { secret } = await enrol(1, "owner@foodhaus.test", PW.owner);
    const same = await code(secret, T0);
    expect(await login(store, { email: "owner@foodhaus.test", password: PW.owner, totp: same, ip: IP }, later(5_000), hasher)).toEqual({ ok: false, reason: "invalid_totp" });
    const next = await code(secret, later(30_000));
    expect((await login(store, { email: "owner@foodhaus.test", password: PW.owner, totp: next, ip: IP }, later(30_000), hasher)).ok).toBe(true);
  });
});

describe("signing in with a recovery code", () => {
  let recoveryCodes: string[];
  beforeEach(async () => {
    ({ recoveryCodes } = await enrol(1, "owner@foodhaus.test", PW.owner));
  });
  const attempt = (totp: string, at = later(MIN)) => login(store, { email: "owner@foodhaus.test", password: PW.owner, totp, ip: IP }, at, hasher);

  it("works once, in any case and spacing, and says how many are left", async () => {
    const r = await attempt(recoveryCodes[0].toLowerCase().replace("-", " "));
    expect(r).toMatchObject({ ok: true, recoveryCodeUsed: true, recoveryCodesLeft: 9 });
    expect(await attempt(recoveryCodes[0])).toEqual({ ok: false, reason: "invalid_totp" }); // single use
    expect(await attempt(recoveryCodes[1])).toMatchObject({ ok: true, recoveryCodesLeft: 8 });
  });
  it("a wrong code counts as a failed attempt and locks out like any other guess", async () => {
    for (let i = 0; i < MAX_FAILS_PER_ACCOUNT_AND_IP; i++) expect(await attempt("ZZZZZ-ZZZZZ")).toEqual({ ok: false, reason: "invalid_totp" });
    expect(await attempt(recoveryCodes[2])).toEqual({ ok: false, reason: "locked" }); // even a real code is refused while locked
  });
  it("a recovery sign-in leaves the authenticator's replay marker alone, and the normal code still works", async () => {
    await attempt(recoveryCodes[0]);
    const { secret } = { secret: (await store.findUserById(1))!.totpSecret! };
    expect((await attempt(await code(secret, later(MIN)), later(MIN + 1000))).ok).toBe(true);
  });
  it("a password alone, or a code for someone else, never signs in", async () => {
    expect(await login(store, { email: "owner@foodhaus.test", password: PW.owner, ip: IP }, later(MIN), hasher)).toEqual({ ok: false, reason: "totp_required" });
    const other = await enrol(2, "other@foodhaus.test", PW.other);
    expect(await attempt(other.recoveryCodes[0])).toEqual({ ok: false, reason: "invalid_totp" });
  });
  it("an account with no authenticator yet is still refused (and told to use its setup link)", async () => {
    expect(await login(store, { email: "kitchen@foodhaus.test", password: PW.kitchen, ip: IP }, T0, hasher)).toMatchObject({ ok: true }); // kitchen has no 2FA
    await user(4, "newmgr@foodhaus.test", "manager", "manager-secret-pass-22");
    expect(await login(store, { email: "newmgr@foodhaus.test", password: "manager-secret-pass-22", ip: IP }, T0, hasher)).toEqual({ ok: false, reason: "totp_enrolment_required" });
  });
});

describe("changing 2FA while signed in", () => {
  it("re-authentication needs the password AND a current code (or a recovery code)", async () => {
    const { secret, recoveryCodes } = await enrol(1, "owner@foodhaus.test", PW.owner);
    const u = () => store.findUserById(1) as Promise<AdminUserRecord>;
    const at = later(2 * MIN);
    expect(await reauthenticate(store, await u(), { password: "wrong-password-xx", code: await code(secret, at) }, IP, at, hasher)).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(await reauthenticate(store, await u(), { password: PW.owner, code: "000000" }, IP, at, hasher)).toEqual({ ok: false, reason: "invalid_code" });
    expect(await reauthenticate(store, await u(), { password: PW.owner, code: await code(secret, at) }, IP, at, hasher)).toEqual({ ok: true, usedRecoveryCode: false });
    expect(await reauthenticate(store, await u(), { password: PW.owner, code: await code(secret, at) }, IP, at, hasher)).toEqual({ ok: false, reason: "invalid_code" }); // replay refused
    expect(await reauthenticate(store, await u(), { password: PW.owner, code: recoveryCodes[0] }, IP, at, hasher)).toEqual({ ok: true, usedRecoveryCode: true });
    expect(await reauthenticate(store, await u(), { password: PW.owner, code: recoveryCodes[0] }, IP, at, hasher)).toEqual({ ok: false, reason: "invalid_code" }); // single use
  });
  it("shares the sign-in lockout, so guessing here is as hard as guessing at the login", async () => {
    await enrol(1, "owner@foodhaus.test", PW.owner);
    const u = (await store.findUserById(1))!;
    for (let i = 0; i < MAX_FAILS_PER_ACCOUNT_AND_IP; i++) await reauthenticate(store, u, { password: PW.owner, code: "000000" }, IP, later(MIN), hasher);
    expect(await reauthenticate(store, u, { password: PW.owner, code: "000000" }, IP, later(MIN), hasher)).toEqual({ ok: false, reason: "locked" });
    expect(await login(store, { email: "owner@foodhaus.test", password: PW.owner, totp: "000000", ip: IP }, later(MIN), hasher)).toEqual({ ok: false, reason: "locked" });
  });
  it("new recovery codes replace ALL the old ones at once", async () => {
    const { recoveryCodes: oldCodes } = await enrol(1, "owner@foodhaus.test", PW.owner);
    const fresh = await regenerateRecoveryCodes(store, 1);
    expect(fresh).toHaveLength(10);
    expect(fresh.filter((c) => oldCodes.includes(c))).toEqual([]);
    const attempt = (c: string) => login(store, { email: "owner@foodhaus.test", password: PW.owner, totp: c, ip: IP }, later(5 * MIN), hasher);
    expect(await attempt(oldCodes[0])).toEqual({ ok: false, reason: "invalid_totp" });
    expect((await attempt(fresh[0])).ok).toBe(true);
  });
  it("an operator reset removes the authenticator, codes and sessions", async () => {
    await enrol(1, "owner@foodhaus.test", PW.owner);
    await store.createSession({ tokenHash: "s", userId: 1, createdAt: T0, lastSeenAt: T0, expiresAt: later(1e9) });
    await store.clearTotp(1);
    expect((await store.findUserById(1))!.totpSecret).toBeNull();
    expect(await store.countRecoveryCodes(1)).toBe(0);
    expect(await authenticate(store, "s", later(MIN))).toEqual({ ok: false, reason: "no_session" });
    expect(await login(store, { email: "owner@foodhaus.test", password: PW.owner, ip: IP }, later(MIN), hasher)).toEqual({ ok: false, reason: "totp_enrolment_required" });
  });
});
