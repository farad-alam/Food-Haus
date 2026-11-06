import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { adminUser, auditLog, settings } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { createAdminUser } from "@/lib/auth/pg-store";
import { generateToken, hashToken } from "@/lib/auth/service";
import { adminStore } from "@/lib/admin/guard";
import { loadSettingsView } from "@/lib/admin/settings";
import { loadContact } from "@/lib/contact-public";
import { DEFAULT_CONTACT } from "@/lib/contact";
import { PUT as putContact } from "@/app/api/admin/settings/contact/route";

// Real handler and database. The single settings row is shared, so the original contact JSON is put back afterwards.
const enabled = !!process.env.DATABASE_URL;
const ORIGIN = "http://localhost:3000";
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(3)));
const tag = crypto.randomUUID().slice(0, 6);
const good = { legalName: "Food Haus Ltd", phone: "07438 795428", email: "orders@foodhaus.test", street: "1 Test Road", locality: "Luton", postcode: "lu1 1aa", companyNumber: "12345678", registeredOffice: "1 Test Road, Luton LU1 1AA", vatNumber: null };

describe.skipIf(!enabled)("shop contact details (real database)", () => {
  const db = enabled ? getDb() : (null as never);
  const users: Record<string, { id: number; cookie: string }> = {};
  let original: Record<string, string | null> = {};
  let savedKey: string | undefined;

  beforeAll(async () => {
    savedKey = process.env.SECRET_BOX_KEY;
    process.env.SECRET_BOX_KEY = KEY;
    original = (await db.select({ c: settings.contact }).from(settings).where(eq(settings.id, 1)))[0]?.c ?? {};
    for (const role of ["manager", "kitchen"] as const) {
      const id = await createAdminUser(db, KEY, { email: `${role}-contact-${tag}@example.test`, passwordHash: "x", role });
      const token = generateToken();
      const now = new Date();
      await adminStore().createSession({ tokenHash: await hashToken(token), userId: id, createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + 3_600_000) });
      users[role] = { id, cookie: `fh_admin=${token}` };
    }
  });
  afterAll(async () => {
    await db.update(settings).set({ contact: original }).where(eq(settings.id, 1));
    const ids = Object.values(users).map((u) => u.id);
    await db.delete(auditLog).where(inArray(auditLog.userId, ids));
    await db.delete(adminUser).where(inArray(adminUser.id, ids));
    if (savedKey === undefined) delete process.env.SECRET_BOX_KEY;
    else process.env.SECRET_BOX_KEY = savedKey;
  });
  const put = (who: string | null, body: unknown, origin: string | null = ORIGIN) =>
    putContact(new Request(`${ORIGIN}/api/admin/settings/contact`, { method: "PUT", headers: { "content-type": "application/json", ...(origin ? { origin } : {}), ...(who ? { cookie: users[who].cookie } : {}) }, body: JSON.stringify(body) }));
  const stored = async () => (await db.select({ c: settings.contact }).from(settings).where(eq(settings.id, 1)))[0]?.c;

  it("only owners and managers may change it; nothing changes otherwise", async () => {
    const before = await stored();
    expect((await put(null, good)).status).toBe(401);
    expect((await put("kitchen", good)).status).toBe(403);
    expect((await put("manager", good, "https://evil.example")).status).toBe(403);
    expect(await stored()).toEqual(before);
  });

  it("rejects bad input with a message and changes nothing", async () => {
    const before = await stored();
    for (const patch of [{ phone: "12345" }, { email: "nope" }, { postcode: "ZZZ" }, { street: "" }, { companyNumber: "12" }, { vatNumber: "123" }, { legalName: "<script>" }, { extra: 1 }]) {
      const r = await put("manager", { ...good, ...patch });
      expect([JSON.stringify(patch), r.status]).toEqual([JSON.stringify(patch), 400]);
      expect((await r.json()).message.length).toBeGreaterThan(5);
    }
    expect(await stored()).toEqual(before);
  });

  it("saves tidy values, every reader sees them, and the change is audited with before and after", async () => {
    const r = await put("manager", good);
    expect(r.status).toBe(200);
    const { contact, confirmed } = await loadContact(db);
    expect(confirmed).toBe(true);
    expect(contact).toMatchObject({ legalName: "Food Haus Ltd", phone: "+447438795428", postcode: "LU1 1AA", companyNumber: "12345678", vatNumber: null });
    expect((await loadSettingsView(db, new Date())).contact.street).toBe("1 Test Road");
    const trail = (await db.select().from(auditLog).where(eq(auditLog.userId, users.manager.id))).filter((t) => t.action === "settings.contact");
    expect(trail.length).toBeGreaterThanOrEqual(1);
    expect((trail[trail.length - 1].after as { phone: string }).phone).toBe("+447438795428");
    expect(trail[trail.length - 1].before).toBeTruthy();
  });

  it("a stored value that no longer passes the rules falls back to the starting details, never to junk", async () => {
    await db.update(settings).set({ contact: { phone: "garbage", street: "<b>x</b>" } }).where(eq(settings.id, 1));
    expect((await loadContact(db)).contact).toEqual(DEFAULT_CONTACT);
  });
});
