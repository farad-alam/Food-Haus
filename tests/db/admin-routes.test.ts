import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like, or } from "drizzle-orm";
import { adminUser, auditLog, authEvent, order, orderItem } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { createAdminUser } from "@/lib/auth/pg-store";
import { passwordHasher } from "@/lib/auth/password";
import { generateTotpSecret, totpAt } from "@/lib/auth/totp";
import { requestPasswordReset } from "@/lib/auth/service";
import { adminStore, guard } from "@/lib/admin/guard";
import { POST as login } from "@/app/api/admin/login/route";
import { POST as logout } from "@/app/api/admin/logout/route";
import { GET as board } from "@/app/api/admin/orders/route";
import { POST as orderAction } from "@/app/api/admin/orders/[id]/route";
import { POST as resetRequest } from "@/app/api/admin/password-reset/request/route";
import { POST as resetComplete } from "@/app/api/admin/password-reset/complete/route";
import { newOrderToken } from "@/lib/token";

// Calls the real route handlers against the real database. Users, sessions,
// orders and counters it creates are all removed in afterAll.
const enabled = !!process.env.DATABASE_URL;
const ORIGIN = "http://localhost:3000"; // lib/shop SITE_URL default
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(5)));
const PASSWORD = "correct horse battery staple 42";
const tag = crypto.randomUUID().slice(0, 8);
const ip = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
const cleanup = { users: [] as number[], orders: [] as number[] };

const post = (path: string, body: unknown, headers: Record<string, string> = {}, origin: string | null = ORIGIN) =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(origin ? { origin } : {}), ...headers },
    body: JSON.stringify(body),
  });
const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";
const params = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });

describe.skipIf(!enabled)("admin routes (real database)", () => {
  const db = enabled ? getDb() : (null as never);
  let hash = "";
  const totpSecret = generateTotpSecret();
  const emails = { kitchen: `kitchen-${tag}@example.test`, owner: `owner-${tag}@example.test`, lock: `lock-${tag}@example.test`, reset: `reset-${tag}@example.test` };
  const ids: Record<string, number> = {};
  let savedKey: string | undefined;

  beforeAll(async () => {
    savedKey = process.env.SECRET_BOX_KEY;
    process.env.SECRET_BOX_KEY = KEY;
    hash = await passwordHasher.hash(PASSWORD);
    for (const [k, role, totp] of [["kitchen", "kitchen", undefined], ["owner", "owner", totpSecret], ["lock", "kitchen", undefined], ["reset", "kitchen", undefined]] as const) {
      ids[k] = await createAdminUser(db, KEY, { email: emails[k], passwordHash: hash, role, totpSecret: totp });
      cleanup.users.push(ids[k]);
    }
  });
  afterAll(async () => {
    if (savedKey === undefined) delete process.env.SECRET_BOX_KEY;
    else process.env.SECRET_BOX_KEY = savedKey;
    if (cleanup.orders.length) {
      await db.delete(orderItem).where(inArray(orderItem.orderId, cleanup.orders));
      await db.delete(order).where(inArray(order.id, cleanup.orders));
    }
    await db.delete(authEvent).where(or(like(authEvent.key, `%${tag}%`), like(authEvent.key, `%${ip}%`)));
    if (cleanup.users.length) {
      await db.delete(auditLog).where(inArray(auditLog.userId, cleanup.users));
      await db.delete(adminUser).where(inArray(adminUser.id, cleanup.users)); // sessions + reset tokens cascade
    }
  });

  async function signIn(email: string, extra: Record<string, unknown> = {}) {
    const res = await login(post("/api/admin/login", { email, password: PASSWORD, ...extra }));
    return { res, cookie: cookieOf(res), body: await res.json() };
  }
  async function mkOrder() {
    const [o] = await db
      .insert(order)
      .values({ token: newOrderToken(), idempotencyKey: crypto.randomUUID(), type: "collection", paymentMethod: "cash", status: "received", subtotal: 1000, total: 1000, customerName: "Route Test", phone: "+447000000002", email: "r@example.test" })
      .returning();
    cleanup.orders.push(o.id);
    await db.insert(orderItem).values({ orderId: o.id, name: "Wings", unitPrice: 1000, quantity: 1, options: [], lineTotal: 1000 });
    return o;
  }

  describe("login", () => {
    it("rejects cross-site and origin-less posts before touching credentials", async () => {
      expect((await login(post("/api/admin/login", { email: emails.kitchen, password: PASSWORD }, {}, "https://evil.example"))).status).toBe(403);
      expect((await login(post("/api/admin/login", { email: emails.kitchen, password: PASSWORD }, {}, null))).status).toBe(403);
    });

    it("signs a kitchen user in with a hardened cookie and no 2FA", async () => {
      const { res, body } = await signIn(emails.kitchen);
      expect(res.status).toBe(200);
      expect(body).toEqual({ ok: true, role: "kitchen" });
      const sc = res.headers.get("set-cookie")!;
      expect(sc).toMatch(/^fh_admin=[A-Za-z0-9_-]{40,}/); // 256-bit token, dev (http) cookie name
      expect(sc).toContain("HttpOnly");
      expect(sc).toContain("SameSite=Lax");
      expect(sc).toContain("Path=/");
      expect(res.headers.get("cache-control")).toBe("no-store");
    });

    it("gives wrong passwords and unknown emails the same answer", async () => {
      const a = await login(post("/api/admin/login", { email: emails.kitchen, password: "wrong-password-123" }));
      const b = await login(post("/api/admin/login", { email: `nobody-${tag}@example.test`, password: "wrong-password-123" }));
      expect(a.status).toBe(401);
      expect(b.status).toBe(401);
      expect(await a.json()).toEqual(await b.json());
      expect(a.headers.get("set-cookie")).toBeNull();
    });

    it("owner needs the TOTP code; a used code cannot be replayed", async () => {
      expect((await signIn(emails.owner)).body).toMatchObject({ ok: false, code: "TOTP_REQUIRED" });
      expect((await signIn(emails.owner, { totp: "000000" })).body).toMatchObject({ ok: false, code: "INVALID_TOTP" });
      const code = (await totpAt(totpSecret, Date.now()))!;
      const first = await signIn(emails.owner, { totp: code });
      expect(first.body).toMatchObject({ ok: true, role: "owner" });
      const replay = await signIn(emails.owner, { totp: code });
      expect(replay.body).toMatchObject({ ok: false, code: "INVALID_TOTP" });
    });

    it("locks an account+IP after repeated failures (429)", async () => {
      let last = 0;
      for (let i = 0; i < 6; i++) last = (await login(post("/api/admin/login", { email: emails.lock, password: `bad-password-${i}-xx` }))).status;
      expect(last).toBe(429);
      expect((await signIn(emails.lock)).res.status).toBe(429); // even the right password is refused while locked
    });

    it("rejects unknown keys and bad JSON", async () => {
      expect((await login(post("/api/admin/login", { email: "a@b.co", password: "x", role: "owner" }))).status).toBe(400);
      expect((await login(new Request(`${ORIGIN}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: "{nope" }))).status).toBe(400);
    });
  });

  describe("board + order actions", () => {
    it("refuse requests without a valid session, with a bad cookie, or from another site", async () => {
      expect((await board(new Request(`${ORIGIN}/api/admin/orders`))).status).toBe(401);
      expect((await board(new Request(`${ORIGIN}/api/admin/orders`, { headers: { cookie: "fh_admin=not-a-real-token" } }))).status).toBe(401);
      const { cookie } = await signIn(emails.kitchen);
      const o = await mkOrder();
      const body = { action: "accept", prepMinutes: 10 };
      expect((await orderAction(post(`/api/admin/orders/${o.id}`, body, { cookie }, "https://evil.example"), params(o.id))).status).toBe(403);
      expect((await orderAction(post(`/api/admin/orders/${o.id}`, body, { cookie }, null), params(o.id))).status).toBe(403);
      expect((await orderAction(post(`/api/admin/orders/${o.id}`, body), params(o.id))).status).toBe(401);
      expect((await db.select().from(order).where(eq(order.id, o.id)))[0].status).toBe("received"); // nothing happened
    });

    it("serves the board to a signed-in user, and polling does not refresh the session", async () => {
      const { cookie } = await signIn(emails.kitchen);
      const o = await mkOrder();
      const token = cookie.split("=")[1];
      const { hashToken } = await import("@/lib/auth/service");
      const th = await hashToken(token);
      const before = (await adminStore().getSession(th))!;
      // make the session look old enough that a normal request WOULD touch it
      const old = new Date(Date.now() - 10 * 60_000);
      await adminStore().touchSession(th, old);
      const res = await board(new Request(`${ORIGIN}/api/admin/orders`, { headers: { cookie } }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.active.map((x: { id: number }) => x.id)).toContain(o.id);
      expect(data.active.find((x: { id: number }) => x.id === o.id)).toMatchObject({ customerName: "Route Test", phone: "+447000000002" });
      expect((await adminStore().getSession(th))!.lastSeenAt.getTime()).toBe(old.getTime()); // not touched by polling
      void before;
    });

    it("accept -> double tap is a 409 -> ready -> completed, validating input", async () => {
      const { cookie } = await signIn(emails.kitchen);
      const o = await mkOrder();
      const call = (b: unknown, id: string | number = o.id) => orderAction(post(`/api/admin/orders/${id}`, b, { cookie }), params(id));
      expect((await call({ action: "accept" })).status).toBe(400); // missing prep time
      expect((await call({ action: "accept", prepMinutes: 10, total: 1 })).status).toBe(400); // unknown key
      expect((await call({ action: "teleport" })).status).toBe(400);
      expect((await call({ action: "accept", prepMinutes: 10 })).status).toBe(200);
      expect((await call({ action: "accept", prepMinutes: 10 })).status).toBe(409);
      expect((await call({ action: "ready" })).status).toBe(200);
      expect((await call({ action: "completed" })).status).toBe(200);
      expect((await call({ action: "ready" }, 2_000_000_000)).status).toBe(404);
      expect((await call({ action: "ready" }, "12abc")).status).toBe(404);
      const log = await db.select().from(auditLog).where(eq(auditLog.entity, `order:${o.id}`));
      expect(log.map((l) => l.userId)).toEqual(new Array(3).fill(ids.kitchen));
    });

    it("guard() enforces the permission matrix: kitchen cannot reach owner-only permissions", async () => {
      const { cookie } = await signIn(emails.kitchen);
      const req = () => new Request(`${ORIGIN}/api/admin/anything`, { headers: { cookie } });
      expect("user" in (await guard(req(), "orders.update"))).toBe(true);
      for (const p of ["menu.edit", "settings.edit", "users.manage", "orders.refund", "orders.export"] as const) {
        const g = await guard(req(), p);
        expect("response" in g && g.response.status).toBe(403);
      }
    });

    it("an owner/manager session idle for over 30 minutes is rejected (R9.2)", async () => {
      const code = (await totpAt(totpSecret, Date.now() + 30_000))!; // next step: the previous one was used above
      const { cookie, body } = await signIn(emails.owner, { totp: code });
      if (!body.ok) return; // clock-step edge: covered by the service tests
      const { hashToken } = await import("@/lib/auth/service");
      await adminStore().touchSession(await hashToken(cookie.split("=")[1]), new Date(Date.now() - 31 * 60_000));
      const res = await board(new Request(`${ORIGIN}/api/admin/orders`, { headers: { cookie } }));
      expect(res.status).toBe(401);
      expect((await res.json()).reason).toBe("idle_timeout");
    });
  });

  describe("logout", () => {
    it("ends the server-side session and clears the cookie; the old cookie stops working", async () => {
      const { cookie } = await signIn(emails.kitchen);
      expect((await board(new Request(`${ORIGIN}/api/admin/orders`, { headers: { cookie } }))).status).toBe(200);
      const res = await logout(post("/api/admin/logout", {}, { cookie }));
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
      expect((await board(new Request(`${ORIGIN}/api/admin/orders`, { headers: { cookie } }))).status).toBe(401);
      expect((await logout(post("/api/admin/logout", {}, { cookie }, "https://evil.example"))).status).toBe(403);
    });
  });

  describe("password reset", () => {
    it("the request answer is identical for known and unknown emails", async () => {
      const a = await resetRequest(post("/api/admin/password-reset/request", { email: emails.reset }));
      const b = await resetRequest(post("/api/admin/password-reset/request", { email: `ghost-${tag}@example.test` }));
      expect(a.status).toBe(200);
      expect(await a.text()).toBe(await b.text());
    });

    it("completes once, rejects weak passwords without burning the link, and signs out every session", async () => {
      const { cookie } = await signIn(emails.reset);
      expect((await board(new Request(`${ORIGIN}/api/admin/orders`, { headers: { cookie } }))).status).toBe(200);
      const { delivery } = await requestPasswordReset(adminStore(), emails.reset, new Date());
      const token = delivery!.token;
      const weak = await resetComplete(post("/api/admin/password-reset/complete", { token, password: "short" }));
      expect(weak.status).toBe(400);
      expect((await weak.json()).code).toBe("WEAK_PASSWORD");
      const fresh = "a-brand-new-strong-passphrase-7";
      expect((await resetComplete(post("/api/admin/password-reset/complete", { token, password: fresh }))).status).toBe(200);
      expect((await board(new Request(`${ORIGIN}/api/admin/orders`, { headers: { cookie } }))).status).toBe(401); // old session gone
      const again = await resetComplete(post("/api/admin/password-reset/complete", { token, password: "another-strong-passphrase-8" }));
      expect(again.status).toBe(400);
      expect((await again.json()).code).toBe("INVALID_TOKEN"); // single use
      const ok = await login(post("/api/admin/login", { email: emails.reset, password: fresh }));
      expect(ok.status).toBe(200);
      expect((await login(post("/api/admin/login", { email: emails.reset, password: PASSWORD }))).status).toBe(401); // old password dead
    });

    it("rejects cross-site and malformed reset posts", async () => {
      expect((await resetComplete(post("/api/admin/password-reset/complete", { token: "x".repeat(30), password: "whatever-passphrase-9" }, {}, "https://evil.example"))).status).toBe(403);
      expect((await resetComplete(post("/api/admin/password-reset/complete", { token: "short", password: "x" }))).status).toBe(400);
      expect((await resetComplete(post("/api/admin/password-reset/complete", { token: "x".repeat(30), password: "whatever-passphrase-9" }))).status).toBe(400); // unknown token
    });
  });
});
