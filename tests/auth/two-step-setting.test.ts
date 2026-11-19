import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPasswordHasher } from "@/lib/auth/password";
import { twoStepEnabled } from "@/lib/auth/config";
import { reauthenticate } from "@/lib/auth/enrolment";
import { authenticate, login, OWNER_MANAGER_ABSOLUTE_MS, OWNER_MANAGER_IDLE_MS, type AdminUserRecord } from "@/lib/auth/service";
import { generateTotpSecret, totpAt } from "@/lib/auth/totp";
import { MemoryStore } from "./memory-store";

// ADMIN_TWO_STEP (R9.2, owner decision): off by default, so every role signs in with email + password only.
// Switched on, owners and managers are asked for the code again.
const hasher = createPasswordHasher(1000);
const T0 = new Date("2026-11-10T12:00:00Z");
const PW = "owner-secret-pass-333";
const SECRET = generateTotpSecret();
let store: MemoryStore;

async function add(id: number, email: string, role: AdminUserRecord["role"], totpSecret: string | null) {
  store.addUser({ id, email, role, passwordHash: await hasher.hash(PW), totpSecret, totpLastStep: null, disabled: false });
}
beforeEach(async () => {
  store = new MemoryStore();
  await add(1, "owner@foodhaus.test", "owner", SECRET); // already enrolled an authenticator
  await add(2, "manager@foodhaus.test", "manager", null); // never enrolled
});
afterEach(() => vi.unstubAllEnvs());

const signIn = (email: string, opts: { twoStep?: boolean; totp?: string } = {}) =>
  login(store, { email, password: PW, totp: opts.totp, ip: "203.0.113.9" }, T0, hasher, { twoStep: opts.twoStep });

describe("the ADMIN_TWO_STEP setting", () => {
  it("is off unless explicitly switched on", () => {
    expect(twoStepEnabled({})).toBe(false);
    expect(twoStepEnabled({ ADMIN_TWO_STEP: "" })).toBe(false);
    expect(twoStepEnabled({ ADMIN_TWO_STEP: "off" })).toBe(false);
    expect(twoStepEnabled({ ADMIN_TWO_STEP: "no" })).toBe(false);
    for (const on of ["on", "ON", "true", "1", "yes", " on "]) expect(twoStepEnabled({ ADMIN_TWO_STEP: on })).toBe(true);
  });

  it("is read from the environment when no option is passed", async () => {
    vi.stubEnv("ADMIN_TWO_STEP", "off");
    expect((await login(store, { email: "owner@foodhaus.test", password: PW, ip: "203.0.113.9" }, T0, hasher)).ok).toBe(true);
    vi.stubEnv("ADMIN_TWO_STEP", "on");
    expect(await login(store, { email: "owner@foodhaus.test", password: PW, ip: "203.0.113.9" }, T0, hasher)).toEqual({ ok: false, reason: "totp_required" });
  });
});

describe("sign-in with two-step OFF", () => {
  it("signs an owner who HAS an enrolled authenticator in with the password only", async () => {
    const r = await signIn("owner@foodhaus.test", { twoStep: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.user.role).toBe("owner");
  });

  it("never asks for a code, even when one is sent, and a wrong code does not matter", async () => {
    expect((await signIn("owner@foodhaus.test", { twoStep: false, totp: "000000" })).ok).toBe(true);
  });

  it("signs in an owner or manager who never enrolled (no enrolment redirect)", async () => {
    const r = await signIn("manager@foodhaus.test", { twoStep: false });
    expect(r.ok).toBe(true);
  });

  it("still refuses a wrong password with the same generic answer, and locks out after repeated failures", async () => {
    const wrong = await login(store, { email: "owner@foodhaus.test", password: "wrong-password-123", ip: "203.0.113.9" }, T0, hasher, { twoStep: false });
    const unknown = await login(store, { email: "nobody@foodhaus.test", password: "wrong-password-123", ip: "203.0.113.9" }, T0, hasher, { twoStep: false });
    expect(wrong).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(unknown).toEqual(wrong);
    for (let i = 0; i < 5; i++) await login(store, { email: "owner@foodhaus.test", password: `wrong-${i}-password`, ip: "203.0.113.9" }, T0, hasher, { twoStep: false });
    expect(await signIn("owner@foodhaus.test", { twoStep: false })).toEqual({ ok: false, reason: "locked" });
  });

  it("keeps the 30 minute inactivity sign-out and 12 hour limit for owner and manager", async () => {
    const r = await signIn("owner@foodhaus.test", { twoStep: false });
    if (!r.ok) throw new Error("sign-in failed");
    expect(r.expiresAt.getTime() - T0.getTime()).toBe(OWNER_MANAGER_ABSOLUTE_MS);
    const idle = new Date(T0.getTime() + OWNER_MANAGER_IDLE_MS + 1000);
    expect(await authenticate(store, r.token, idle)).toEqual({ ok: false, reason: "idle_timeout" });
  });

  it("re-authentication for sensitive changes needs the current password only", async () => {
    const user = (await store.findUserById(1))!;
    expect(await reauthenticate(store, user, { password: PW }, "203.0.113.9", T0, hasher, { twoStep: false })).toEqual({ ok: true, usedRecoveryCode: false });
    expect(await reauthenticate(store, user, { password: "wrong-password-123" }, "203.0.113.9", T0, hasher, { twoStep: false })).toEqual({ ok: false, reason: "invalid_credentials" });
  });
});

describe("sign-in with two-step ON", () => {
  it("asks an owner with an enrolled authenticator for the code, then signs in", async () => {
    expect(await signIn("owner@foodhaus.test", { twoStep: true })).toEqual({ ok: false, reason: "totp_required" });
    const code = (await totpAt(SECRET, T0.getTime()))!;
    expect((await signIn("owner@foodhaus.test", { twoStep: true, totp: code })).ok).toBe(true);
  });

  it("refuses a wrong code, and an owner/manager who has not enrolled", async () => {
    expect(await signIn("owner@foodhaus.test", { twoStep: true, totp: "000000" })).toEqual({ ok: false, reason: "invalid_totp" });
    expect(await signIn("manager@foodhaus.test", { twoStep: true })).toEqual({ ok: false, reason: "totp_enrolment_required" });
  });

  it("re-authentication needs the password AND a code", async () => {
    const user = (await store.findUserById(1))!;
    expect(await reauthenticate(store, user, { password: PW }, "203.0.113.9", T0, hasher, { twoStep: true })).toEqual({ ok: false, reason: "invalid_code" });
  });
});
