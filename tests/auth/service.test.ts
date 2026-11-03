import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPasswordHasher } from "@/lib/auth/password";
import {
  authenticate,
  completePasswordReset,
  generateToken,
  hashToken,
  KITCHEN_ABSOLUTE_MS,
  login,
  logout,
  OWNER_MANAGER_ABSOLUTE_MS,
  OWNER_MANAGER_IDLE_MS,
  requestPasswordReset,
  TOUCH_INTERVAL_MS,
  LOGIN_WINDOW_MS,
  type AdminUserRecord,
} from "@/lib/auth/service";
import { generateTotpSecret, totpAt } from "@/lib/auth/totp";
import { MemoryStore } from "./memory-store";

const hasher = createPasswordHasher(1000); // fast for tests; production default is 600,000
const T0 = new Date("2026-11-10T12:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

const PASSWORDS = { kitchen: "kitchen-tablet-pass-1", manager: "manager-secret-pass-22", owner: "owner-secret-pass-333" };
const SECRET = generateTotpSecret();

let store: MemoryStore;

async function user(id: number, email: string, role: AdminUserRecord["role"], over: Partial<AdminUserRecord> = {}) {
  store.addUser({
    id,
    email,
    role,
    passwordHash: await hasher.hash(PASSWORDS[role]),
    totpSecret: role === "kitchen" ? null : SECRET,
    totpLastStep: null,
    disabled: false,
    ...over,
  });
}

const attempt = (email: string, password: string, extra: { totp?: string; ip?: string; at?: Date } = {}) =>
  login(store, { email, password, totp: extra.totp, ip: extra.ip ?? "203.0.113.5" }, extra.at ?? T0, hasher);

beforeEach(async () => {
  store = new MemoryStore();
  await user(1, "kitchen@foodhaus.test", "kitchen");
  await user(2, "manager@foodhaus.test", "manager");
  await user(3, "owner@foodhaus.test", "owner");
});

describe("login", () => {
  it("signs the kitchen in with a password only, and stores only the token HASH", async () => {
    const r = await attempt("kitchen@foodhaus.test", PASSWORDS.kitchen);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.user).toEqual({ id: 1, email: "kitchen@foodhaus.test", role: "kitchen" });
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 256 bits
    expect(store.sessions.has(r.token)).toBe(false);
    expect(store.sessions.has(await hashToken(r.token))).toBe(true);
    expect(r.expiresAt.getTime() - T0.getTime()).toBe(KITCHEN_ABSOLUTE_MS);
  });

  it("normalises the email (case and spaces)", async () => {
    expect((await attempt("  Kitchen@FoodHaus.test ", PASSWORDS.kitchen)).ok).toBe(true);
  });

  it("unknown account and wrong password are indistinguishable, and both cost a full hash check", async () => {
    const spy = vi.spyOn(hasher, "verify");
    const unknown = await attempt("nobody@foodhaus.test", "whatever-password-1");
    const wrong = await attempt("kitchen@foodhaus.test", "wrong-password-123");
    expect(unknown).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(wrong).toEqual(unknown);
    expect(spy).toHaveBeenCalledTimes(2); // timing: the unknown user was hashed against a dummy
    spy.mockRestore();
  });

  it("refuses disabled accounts with the same generic error", async () => {
    await user(9, "gone@foodhaus.test", "kitchen", { disabled: true });
    expect(await attempt("gone@foodhaus.test", PASSWORDS.kitchen)).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("transparently upgrades an old, weaker hash", async () => {
    const old = createPasswordHasher(300);
    await user(8, "old@foodhaus.test", "kitchen", { passwordHash: await old.hash(PASSWORDS.kitchen) });
    expect((await attempt("old@foodhaus.test", PASSWORDS.kitchen)).ok).toBe(true);
    expect(hasher.needsRehash(store.users.get(8)!.passwordHash)).toBe(false);
  });
});

describe("two-step login for owner and manager (R9.2)", () => {
  it("password alone is not enough", async () => {
    expect(await attempt("owner@foodhaus.test", PASSWORDS.owner)).toEqual({ ok: false, reason: "totp_required" });
    expect(store.sessions.size).toBe(0);
  });

  it("a wrong code fails; a right code signs in", async () => {
    expect(await attempt("owner@foodhaus.test", PASSWORDS.owner, { totp: "000000" })).toEqual({ ok: false, reason: "invalid_totp" });
    const code = (await totpAt(SECRET, T0.getTime()))!;
    const r = await attempt("owner@foodhaus.test", PASSWORDS.owner, { totp: code });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.expiresAt.getTime() - T0.getTime()).toBe(OWNER_MANAGER_ABSOLUTE_MS);
  });

  it("the same code cannot be used twice (replay)", async () => {
    const code = (await totpAt(SECRET, T0.getTime()))!;
    expect((await attempt("manager@foodhaus.test", PASSWORDS.manager, { totp: code })).ok).toBe(true);
    expect(await attempt("manager@foodhaus.test", PASSWORDS.manager, { totp: code, at: later(5_000) })).toEqual({ ok: false, reason: "invalid_totp" });
  });

  it("an owner with no 2FA set up is refused rather than let in", async () => {
    await user(7, "new-owner@foodhaus.test", "owner", { totpSecret: null });
    expect(await attempt("new-owner@foodhaus.test", PASSWORDS.owner)).toEqual({ ok: false, reason: "totp_enrolment_required" });
  });

  it("a wrong password never reveals whether 2FA is configured", async () => {
    expect(await attempt("owner@foodhaus.test", "wrong-password-123")).toEqual({ ok: false, reason: "invalid_credentials" });
  });
});

describe("lockout", () => {
  it("locks after 5 failures from the same IP, even for the correct password", async () => {
    for (let i = 0; i < 5; i++) await attempt("kitchen@foodhaus.test", "bad-password-123");
    expect(await attempt("kitchen@foodhaus.test", PASSWORDS.kitchen)).toEqual({ ok: false, reason: "locked" });
  });

  it("a stranger cannot lock the kitchen out from a different IP", async () => {
    for (let i = 0; i < 12; i++) await attempt("kitchen@foodhaus.test", "bad-password-123", { ip: "198.51.100.9" });
    expect((await attempt("kitchen@foodhaus.test", PASSWORDS.kitchen, { ip: "203.0.113.5" })).ok).toBe(true);
  });

  it("the lock expires after the window", async () => {
    for (let i = 0; i < 5; i++) await attempt("kitchen@foodhaus.test", "bad-password-123");
    expect((await attempt("kitchen@foodhaus.test", PASSWORDS.kitchen, { at: later(LOGIN_WINDOW_MS + 1000) })).ok).toBe(true);
  });

  it("one IP guessing across many accounts is locked at 20 failures", async () => {
    for (let i = 0; i < 20; i++) await attempt(`user${i}@foodhaus.test`, "bad-password-123", { ip: "198.51.100.77" });
    expect(await attempt("kitchen@foodhaus.test", PASSWORDS.kitchen, { ip: "198.51.100.77" })).toEqual({ ok: false, reason: "locked" });
  });

  it("a distributed attack on one account trips the per-account ceiling at 50", async () => {
    for (let i = 0; i < 50; i++) await attempt("kitchen@foodhaus.test", "bad-password-123", { ip: `192.0.2.${i}` });
    expect(await attempt("kitchen@foodhaus.test", PASSWORDS.kitchen, { ip: "192.0.2.200" })).toEqual({ ok: false, reason: "locked" });
  });

  it("a successful login clears that account+IP counter", async () => {
    for (let i = 0; i < 4; i++) await attempt("kitchen@foodhaus.test", "bad-password-123");
    expect((await attempt("kitchen@foodhaus.test", PASSWORDS.kitchen)).ok).toBe(true);
    for (let i = 0; i < 4; i++) await attempt("kitchen@foodhaus.test", "bad-password-123");
    expect((await attempt("kitchen@foodhaus.test", PASSWORDS.kitchen)).ok).toBe(true);
  });
});

describe("sessions", () => {
  async function signIn(email: string, password: string, totp = false) {
    const code = totp ? (await totpAt(SECRET, T0.getTime()))! : undefined;
    const r = await attempt(email, password, { totp: code });
    if (!r.ok) throw new Error(`sign-in failed: ${r.reason}`);
    return r.token;
  }

  it("accepts a valid session and rejects missing or unknown tokens", async () => {
    const token = await signIn("kitchen@foodhaus.test", PASSWORDS.kitchen);
    expect(await authenticate(store, token, later(MIN))).toMatchObject({ ok: true, user: { role: "kitchen" } });
    expect(await authenticate(store, undefined, T0)).toEqual({ ok: false, reason: "no_session" });
    expect(await authenticate(store, generateToken(), T0)).toEqual({ ok: false, reason: "no_session" });
  });

  it("manager is logged out after 30 minutes idle (R9.2) but activity keeps them in", async () => {
    const token = await signIn("manager@foodhaus.test", PASSWORDS.manager, true);
    expect((await authenticate(store, token, later(OWNER_MANAGER_IDLE_MS - MIN))).ok).toBe(true); // 29 min: refreshes lastSeen
    expect((await authenticate(store, token, later(2 * OWNER_MANAGER_IDLE_MS - 2 * MIN))).ok).toBe(true); // 58 min: 29 min gap, still fine
    // Last activity was at 58 min. 31 minutes of silence later (89 min) they are logged out.
    const idle = await authenticate(store, token, later(58 * MIN + OWNER_MANAGER_IDLE_MS + MIN));
    expect(idle).toEqual({ ok: false, reason: "idle_timeout" });
    expect(await authenticate(store, token, later(91 * MIN))).toEqual({ ok: false, reason: "no_session" }); // session deleted
  });

  it("the kitchen tablet has NO idle timeout, but still expires absolutely", async () => {
    const token = await signIn("kitchen@foodhaus.test", PASSWORDS.kitchen);
    expect((await authenticate(store, token, later(6 * 3_600_000))).ok).toBe(true);
    expect(await authenticate(store, token, later(KITCHEN_ABSOLUTE_MS + MIN))).toEqual({ ok: false, reason: "expired" });
  });

  it("owner/manager hit the 12-hour absolute limit even while continuously active", async () => {
    const token = await signIn("owner@foodhaus.test", PASSWORDS.owner, true);
    // Active every 20 minutes (inside the 30-minute idle limit) for just under 12 hours.
    for (let t = 20 * MIN; t < OWNER_MANAGER_ABSOLUTE_MS; t += 20 * MIN) {
      expect((await authenticate(store, token, later(t))).ok).toBe(true);
    }
    expect(await authenticate(store, token, later(OWNER_MANAGER_ABSOLUTE_MS + MIN))).toEqual({ ok: false, reason: "expired" });
  });

  it("throttles last-seen writes", async () => {
    const token = await signIn("kitchen@foodhaus.test", PASSWORDS.kitchen);
    await authenticate(store, token, later(10_000));
    await authenticate(store, token, later(20_000));
    expect(store.touches).toBe(0);
    await authenticate(store, token, later(TOUCH_INTERVAL_MS + 1000));
    expect(store.touches).toBe(1);
  });

  it("disabling a user kills their live session on the next request", async () => {
    const token = await signIn("kitchen@foodhaus.test", PASSWORDS.kitchen);
    store.users.get(1)!.disabled = true;
    expect(await authenticate(store, token, later(MIN))).toEqual({ ok: false, reason: "disabled" });
  });

  it("logout deletes the session", async () => {
    const token = await signIn("kitchen@foodhaus.test", PASSWORDS.kitchen);
    await logout(store, token);
    expect(await authenticate(store, token, later(MIN))).toEqual({ ok: false, reason: "no_session" });
  });
});

describe("password reset (R9.1)", () => {
  it("gives no signal about whether the account exists", async () => {
    const known = await requestPasswordReset(store, "owner@foodhaus.test", T0);
    const unknown = await requestPasswordReset(store, "nobody@foodhaus.test", T0);
    expect(known.delivery).not.toBeNull(); // the server action emails this...
    expect(unknown.delivery).toBeNull(); // ...and shows the SAME message either way
    expect(store.resets.size).toBe(1);
  });

  it("stores only the token hash, and the link expires after 30 minutes", async () => {
    const { delivery } = await requestPasswordReset(store, "kitchen@foodhaus.test", T0);
    const token = delivery!.token;
    expect(store.resets.has(token)).toBe(false);
    expect(await completePasswordReset(store, { token, newPassword: "fresh-tangerine-pass-9" }, later(31 * MIN), hasher)).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("rate-limits to 3 requests an hour per email", async () => {
    for (let i = 0; i < 3; i++) expect((await requestPasswordReset(store, "kitchen@foodhaus.test", later(i * MIN))).delivery).not.toBeNull();
    expect((await requestPasswordReset(store, "kitchen@foodhaus.test", later(4 * MIN))).delivery).toBeNull();
    // Blocked attempts are counted too (a spammer stays blocked); it clears once a full hour passes after the last one.
    expect((await requestPasswordReset(store, "kitchen@foodhaus.test", later(30 * MIN))).delivery).toBeNull();
    expect((await requestPasswordReset(store, "kitchen@foodhaus.test", later(91 * MIN))).delivery).not.toBeNull();
  });

  it("a weak password is rejected WITHOUT burning the link", async () => {
    const { token } = (await requestPasswordReset(store, "kitchen@foodhaus.test", T0)).delivery!;
    const weak = await completePasswordReset(store, { token, newPassword: "short" }, later(MIN), hasher);
    expect(weak).toMatchObject({ ok: false, reason: "weak_password" });
    expect(await completePasswordReset(store, { token, newPassword: "fresh-tangerine-pass-9" }, later(2 * MIN), hasher)).toEqual({ ok: true });
  });

  it("works once: new password set, old one dead, sessions signed out everywhere, token single-use", async () => {
    const oldToken = await (async () => {
      const r = await attempt("kitchen@foodhaus.test", PASSWORDS.kitchen);
      if (!r.ok) throw new Error("setup");
      return r.token;
    })();
    const { token } = (await requestPasswordReset(store, "kitchen@foodhaus.test", later(MIN))).delivery!;

    expect(await completePasswordReset(store, { token, newPassword: "fresh-tangerine-pass-9" }, later(2 * MIN), hasher)).toEqual({ ok: true });
    expect(await authenticate(store, oldToken, later(3 * MIN))).toEqual({ ok: false, reason: "no_session" });
    expect((await attempt("kitchen@foodhaus.test", PASSWORDS.kitchen, { at: later(4 * MIN) }))).toEqual({ ok: false, reason: "invalid_credentials" });
    expect((await attempt("kitchen@foodhaus.test", "fresh-tangerine-pass-9", { at: later(5 * MIN) })).ok).toBe(true);
    expect(await completePasswordReset(store, { token, newPassword: "another-pass-phrase-1" }, later(6 * MIN), hasher)).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("clears an account lockout so staff can recover", async () => {
    for (let i = 0; i < 5; i++) await attempt("kitchen@foodhaus.test", "bad-password-123");
    const { token } = (await requestPasswordReset(store, "kitchen@foodhaus.test", later(MIN))).delivery!;
    await completePasswordReset(store, { token, newPassword: "fresh-tangerine-pass-9" }, later(2 * MIN), hasher);
    // The account-wide counter is cleared; the account+IP one expires with the window.
    expect(store.events.has("login:acct:kitchen@foodhaus.test")).toBe(false);
  });

  it("rejects unknown, empty and tampered tokens", async () => {
    for (const token of ["", "abc", generateToken()]) {
      expect(await completePasswordReset(store, { token, newPassword: "fresh-tangerine-pass-9" }, T0, hasher)).toEqual({ ok: false, reason: "invalid_token" });
    }
  });
});
