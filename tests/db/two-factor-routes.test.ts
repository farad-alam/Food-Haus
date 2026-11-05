import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, like, or } from "drizzle-orm";
import { adminUser, authEvent } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { createAdminUser, PgAdminStore } from "@/lib/auth/pg-store";
import { passwordHasher } from "@/lib/auth/password";
import { issueSetupToken } from "@/lib/auth/enrolment";
import { totpAt } from "@/lib/auth/totp";
import { POST as login } from "@/app/api/admin/login/route";
import { POST as setupBegin } from "@/app/api/admin/2fa/setup/begin/route";
import { POST as setupConfirm } from "@/app/api/admin/2fa/setup/confirm/route";
import { POST as begin } from "@/app/api/admin/2fa/begin/route";
import { POST as confirm } from "@/app/api/admin/2fa/confirm/route";
import { POST as newCodes } from "@/app/api/admin/2fa/recovery-codes/route";

// The real route handlers against the real database. Everything it creates is removed afterwards.
const enabled = !!process.env.DATABASE_URL;
const ORIGIN = "http://localhost:3000";
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const PASSWORD = "correct horse battery staple 42";
const tag = crypto.randomUUID().slice(0, 8);
const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
const NOW = () => Date.now();

const post = (path: string, body: unknown, headers: Record<string, string> = {}, origin: string | null = ORIGIN) =>
  new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(origin ? { origin } : {}), ...headers }, body: JSON.stringify(body) });
const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";
const secretFrom = (grouped: string) => grouped.replace(/ /g, "");

describe.skipIf(!enabled)("2FA setup and recovery (real database)", () => {
  const db = enabled ? getDb() : (null as never);
  const store = () => new PgAdminStore(db, KEY);
  const ids: number[] = [];
  const email = `owner-${tag}@example.test`;
  const kitchenEmail = `kitchen-${tag}@example.test`;
  let savedKey: string | undefined;
  let userId = 0;
  let setupToken = "";
  let secret = "";
  let recovery: string[] = [];
  let cookie = "";

  beforeAll(async () => {
    savedKey = process.env.SECRET_BOX_KEY;
    process.env.SECRET_BOX_KEY = KEY;
    const hash = await passwordHasher.hash(PASSWORD);
    userId = await createAdminUser(db, KEY, { email, passwordHash: hash, role: "owner" });
    const kitchenId = await createAdminUser(db, KEY, { email: kitchenEmail, passwordHash: hash, role: "kitchen" });
    ids.push(userId, kitchenId);
    setupToken = (await issueSetupToken(store(), userId, new Date())).token;
  });
  afterAll(async () => {
    if (savedKey === undefined) delete process.env.SECRET_BOX_KEY;
    else process.env.SECRET_BOX_KEY = savedKey;
    await db.delete(authEvent).where(or(like(authEvent.key, `%${tag}%`), like(authEvent.key, `%${ip}%`)));
    if (ids.length) await db.delete(adminUser).where(inArray(adminUser.id, ids)); // pending secrets, links, codes, sessions cascade
  });

  it("before setup, sign-in is refused and points at the setup link", async () => {
    const res = await login(post("/api/admin/login", { email, password: PASSWORD }));
    expect(res.status).toBe(403);
    expect((await res.json()).message).toMatch(/setup link/i);
  });

  it("setup refuses cross-site requests, a wrong password and a wrong link with ONE generic message", async () => {
    expect((await setupBegin(post("/api/admin/2fa/setup/begin", { token: setupToken, email, password: PASSWORD }, {}, "https://evil.example"))).status).toBe(403);
    const msgs = new Set<string>();
    for (const b of [
      { token: setupToken, email, password: "not-the-password-1" },
      { token: "x".repeat(43), email, password: PASSWORD },
      { token: setupToken, email: `nobody-${tag}@example.test`, password: PASSWORD },
    ]) {
      const res = await setupBegin(post("/api/admin/2fa/setup/begin", b));
      expect(res.status).toBe(403);
      msgs.add((await res.json()).message);
    }
    expect(msgs.size).toBe(1);
  });

  it("setup with link + password returns a QR image and a manual key, and changes nothing yet", async () => {
    const res = await setupBegin(post("/api/admin/2fa/setup/begin", { token: setupToken, email, password: PASSWORD }));
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.qr).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(out.secret).toMatch(/^([A-Z2-7]{4} )+[A-Z2-7]{1,4}$/);
    secret = secretFrom(out.secret);
    expect((await store().findUserById(userId))!.totpSecret).toBeNull();
    // a wrong code neither enrols nor spends the link
    const bad = await setupConfirm(post("/api/admin/2fa/setup/confirm", { token: setupToken, email, password: PASSWORD, code: "000000" }));
    expect(bad.status).toBe(422);
    expect((await store().findUserById(userId))!.totpSecret).toBeNull();
  });

  it("a correct code turns 2FA on and shows ten recovery codes once", async () => {
    const res = await setupConfirm(post("/api/admin/2fa/setup/confirm", { token: setupToken, email, password: PASSWORD, code: (await totpAt(secret, NOW()))! }));
    expect(res.status).toBe(200);
    recovery = (await res.json()).recoveryCodes;
    expect(recovery).toHaveLength(10);
    expect((await store().findUserById(userId))!.totpSecret).toBe(secret);
    expect(await store().countRecoveryCodes(userId)).toBe(10);
  });

  it("the link is single-use", async () => {
    const res = await setupBegin(post("/api/admin/2fa/setup/begin", { token: setupToken, email, password: PASSWORD }));
    expect(res.status).toBe(403);
  });

  it("signs in with a recovery code, once, and reports how many are left", async () => {
    const a = await login(post("/api/admin/login", { email, password: PASSWORD, totp: recovery[0].toLowerCase() }));
    expect(a.status).toBe(200);
    const body = await a.json();
    expect(body).toMatchObject({ ok: true, recoveryCodeUsed: true, recoveryCodesLeft: 9 });
    cookie = cookieOf(a);
    const b = await login(post("/api/admin/login", { email, password: PASSWORD, totp: recovery[0] }));
    expect(b.status).toBe(401);
  });

  it("changing the authenticator needs the password and a current code, then replaces the secret and ends other sessions", async () => {
    const other = cookieOf(await login(post("/api/admin/login", { email, password: PASSWORD, totp: recovery[1] })));
    expect(other).toContain("fh_admin");
    const h = { cookie };
    expect((await begin(post("/api/admin/2fa/begin", { password: "wrong-password-xxx", code: recovery[2] }, h))).status).toBe(403);
    expect((await begin(post("/api/admin/2fa/begin", { password: PASSWORD, code: recovery[2] }, {}))).status).toBe(401); // no cookie
    const started = await begin(post("/api/admin/2fa/begin", { password: PASSWORD, code: recovery[2] }, h));
    expect(started.status).toBe(200);
    const next = secretFrom((await started.json()).secret);
    expect(next).not.toBe(secret);
    expect((await store().findUserById(userId))!.totpSecret).toBe(secret); // still the old one
    expect((await confirm(post("/api/admin/2fa/confirm", { code: (await totpAt(secret, NOW()))! }, h))).status).toBe(422); // old app's code is not accepted
    const done = await confirm(post("/api/admin/2fa/confirm", { code: (await totpAt(next, NOW()))! }, h));
    expect(done.status).toBe(200);
    recovery = (await done.json()).recoveryCodes;
    secret = next;
    expect((await store().findUserById(userId))!.totpSecret).toBe(next);
    // this session survives, the other one is gone
    expect((await newCodes(post("/api/admin/2fa/recovery-codes", { password: "wrong-password-xxx", code: recovery[0] }, h))).status).toBe(403); // still signed in (403 = wrong password, not 401)
    expect((await newCodes(post("/api/admin/2fa/recovery-codes", { password: PASSWORD, code: recovery[0] }, { cookie: other }))).status).toBe(401);
  });

  it("new recovery codes replace the old ones", async () => {
    const res = await newCodes(post("/api/admin/2fa/recovery-codes", { password: PASSWORD, code: recovery[0] }, { cookie }));
    expect(res.status).toBe(200);
    const fresh: string[] = (await res.json()).recoveryCodes;
    expect(fresh).toHaveLength(10);
    expect(await store().countRecoveryCodes(userId)).toBe(10);
    expect((await login(post("/api/admin/login", { email, password: PASSWORD, totp: recovery[3] }))).status).toBe(401); // old set is dead
    expect((await login(post("/api/admin/login", { email, password: PASSWORD, totp: fresh[0] }))).status).toBe(200);
  });

  it("a kitchen account is not offered 2FA by any of the routes, and a setup link for it is useless", async () => {
    const k = cookieOf(await login(post("/api/admin/login", { email: kitchenEmail, password: PASSWORD })));
    expect(k).not.toBe("");
    for (const [route, fn, body] of [["begin", begin, { password: PASSWORD, code: "123456" }], ["confirm", confirm, { code: "123456" }], ["recovery-codes", newCodes, { password: PASSWORD, code: "123456" }]] as const) {
      expect([route, (await fn(post(`/api/admin/2fa/${route}`, body, { cookie: k }))).status]).toEqual([route, 403]);
    }
    const link = (await issueSetupToken(store(), ids[1], new Date())).token;
    expect((await setupBegin(post("/api/admin/2fa/setup/begin", { token: link, email: kitchenEmail, password: PASSWORD }))).status).toBe(403);
  });

  it("junk input is rejected before anything runs", async () => {
    expect((await setupBegin(post("/api/admin/2fa/setup/begin", { token: "short", email, password: PASSWORD }))).status).toBe(400);
    expect((await setupBegin(post("/api/admin/2fa/setup/begin", { token: setupToken, email, password: PASSWORD, extra: 1 }))).status).toBe(400);
    expect((await login(post("/api/admin/login", { email, password: PASSWORD, totp: "<script>alert(1)</script>" }))).status).toBe(400);
    const res = await setupBegin(new Request(`${ORIGIN}/api/admin/2fa/setup/begin`, { method: "POST", headers: { "content-type": "text/plain", origin: ORIGIN }, body: "{}" }));
    expect(res.status).toBe(415);
  });
});
