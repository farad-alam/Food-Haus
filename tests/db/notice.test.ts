import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { adminUser, auditLog } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { createAdminUser } from "@/lib/auth/pg-store";
import { generateToken, hashToken } from "@/lib/auth/service";
import { adminStore } from "@/lib/admin/guard";
import { loadGeneral, saveNotice } from "@/lib/admin/settings";
import { PUT as putNotice } from "@/app/api/admin/settings/notice/route";

// Real handler and database. The single settings row is shared, so the original notice is put back afterwards.
const enabled = !!process.env.DATABASE_URL;
const ORIGIN = "http://localhost:3000";
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(4)));
const tag = crypto.randomUUID().slice(0, 6);

describe.skipIf(!enabled)("site-wide notice bar (real database)", () => {
  const db = enabled ? getDb() : (null as never);
  const users: Record<string, { id: number; cookie: string }> = {};
  let original: string | null = null;
  let savedKey: string | undefined;

  beforeAll(async () => {
    savedKey = process.env.SECRET_BOX_KEY;
    process.env.SECRET_BOX_KEY = KEY;
    original = (await loadGeneral(db)).noticeBar;
    for (const role of ["manager", "kitchen"] as const) {
      const id = await createAdminUser(db, KEY, { email: `${role}-notice-${tag}@example.test`, passwordHash: "x", role });
      const token = generateToken();
      const now = new Date();
      await adminStore().createSession({ tokenHash: await hashToken(token), userId: id, createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + 3_600_000) });
      users[role] = { id, cookie: `fh_admin=${token}` };
    }
  });
  afterAll(async () => {
    await saveNotice(db, { userId: users.manager.id, now: new Date() }, original);
    const ids = Object.values(users).map((u) => u.id);
    await db.delete(auditLog).where(inArray(auditLog.userId, ids));
    await db.delete(adminUser).where(inArray(adminUser.id, ids));
    if (savedKey === undefined) delete process.env.SECRET_BOX_KEY;
    else process.env.SECRET_BOX_KEY = savedKey;
  });
  const put = (who: string | null, body: unknown, origin: string | null = ORIGIN) =>
    putNotice(new Request(`${ORIGIN}/api/admin/settings/notice`, { method: "PUT", headers: { "content-type": "application/json", ...(origin ? { origin } : {}), ...(who ? { cookie: users[who].cookie } : {}) }, body: JSON.stringify(body) }));

  it("only owners and managers may change it; nothing changes otherwise", async () => {
    const before = (await loadGeneral(db)).noticeBar;
    expect((await put(null, { text: "x" })).status).toBe(401);
    expect((await put("kitchen", { text: "x" })).status).toBe(403);
    expect((await put("manager", { text: "x" }, "https://evil.example")).status).toBe(403);
    expect((await loadGeneral(db)).noticeBar).toBe(before);
  });
  it("saves a tidy line, keeps markup as plain text, caps it, clears it, and audits each change", async () => {
    expect((await put("manager", { text: "  Closed   this Sunday  " })).status).toBe(200);
    expect((await loadGeneral(db)).noticeBar).toBe("Closed this Sunday");
    expect((await put("manager", { text: "<script>alert(1)</script>" })).status).toBe(200);
    expect((await loadGeneral(db)).noticeBar).toBe("<script>alert(1)</script>"); // stored as text; the page draws it escaped
    expect((await put("manager", { text: "x".repeat(1000) })).status).toBe(400);
    expect((await put("manager", { text: 5 })).status).toBe(400);
    expect((await put("manager", { text: "ok", extra: 1 })).status).toBe(400);
    expect((await put("manager", { text: "   " })).status).toBe(200);
    expect((await loadGeneral(db)).noticeBar).toBeNull();
    expect((await put("manager", { text: null })).status).toBe(200);
    const trail = await db.select().from(auditLog).where(eq(auditLog.userId, users.manager.id));
    expect(trail.filter((t) => t.action === "settings.notice").length).toBeGreaterThanOrEqual(4);
  });
});
