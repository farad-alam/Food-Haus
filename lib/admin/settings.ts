import { asc, eq, gte } from "drizzle-orm";
import { closure, deliveryZone, openingHours, settings } from "@/db/schema";
import type { Db } from "@/lib/db/client";
import { londonParts } from "@/lib/hours";
import { shopState } from "@/lib/shop-status";
import { auditInsert, type Actor } from "./audit";
import { normaliseTime, sortWindows, validateWindows, type HoursWindow } from "./hours-validate";

// Shop settings: opening hours, closures, pause switch, prep time, cash limits,
// delivery zones (R9.9, R9.10). Public ordering reads these tables on every
// request, so a change applies to the next customer. Each change is written
// together with its audit-log entry in ONE transaction (R9.13).

export type General = {
  paused: boolean;
  pausedMessage: string | null;
  defaultPrepMinutes: number;
  cashMaxPence: number | null;
  cashDailyCapPerPhone: number;
  cashDailyCapPerIp: number;
};
export type ZoneRow = { id: number; district: string; fee: number; minOrder: number; estimatedMinutes: number; active: boolean };
export type ClosureView = { id: number; day: string; reason: string | null };
export type ShopStatus = { open: boolean; reason: "open" | "paused" | "no_hours" | "closure" | "outside_hours" };
export type SettingsView = { general: General; hours: HoursWindow[]; closures: ClosureView[]; zones: ZoneRow[]; status: ShopStatus };

const DEFAULTS: General = {
  paused: false,
  pausedMessage: null,
  defaultPrepMinutes: 20,
  cashMaxPence: null,
  cashDailyCapPerPhone: 3,
  cashDailyCapPerIp: 5,
};

export async function loadGeneral(db: Db): Promise<General> {
  const [s] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  if (!s) return DEFAULTS;
  return {
    paused: s.paused,
    pausedMessage: s.pausedMessage,
    defaultPrepMinutes: s.defaultPrepMinutes,
    cashMaxPence: s.cashMaxPence,
    cashDailyCapPerPhone: s.cashDailyCapPerPhone,
    cashDailyCapPerIp: s.cashDailyCapPerIp,
  };
}

export function shopStatus(general: General, hours: HoursWindow[], closures: { day: string }[], now: Date): ShopStatus {
  // One implementation of "is the shop open and why" (lib/shop-status.ts), so the admin screen
  // can never disagree with the public site or the order API.
  const state = shopState({ paused: general.paused, pausedMessage: general.pausedMessage, hours, closures }, now);
  return { open: state.open, reason: state.reason };
}

export async function loadSettingsView(db: Db, now: Date): Promise<SettingsView> {
  const today = londonParts(now).date;
  const [general, hoursRows, closureRows, zoneRows] = await Promise.all([
    loadGeneral(db),
    db.select().from(openingHours).orderBy(asc(openingHours.weekday), asc(openingHours.opensAt)),
    db.select().from(closure).where(gte(closure.day, today)).orderBy(asc(closure.day)),
    db.select().from(deliveryZone).orderBy(asc(deliveryZone.district)),
  ]);
  const hours = hoursRows.map((r) => ({ weekday: r.weekday, opensAt: normaliseTime(r.opensAt)!, closesAt: normaliseTime(r.closesAt)! }));
  return {
    general,
    hours,
    closures: closureRows.map((c) => ({ id: c.id, day: c.day, reason: c.reason })),
    zones: zoneRows,
    status: shopStatus(general, hours, closureRows, now),
  };
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; code: "INVALID" | "NOT_FOUND" | "DUPLICATE"; message: string };

const audit = auditInsert;

// ---- opening hours ---------------------------------------------------------

export async function saveHours(db: Db, a: Actor, windows: HoursWindow[]): Promise<Result> {
  const problem = validateWindows(windows);
  if (problem) return { ok: false, code: "INVALID", message: problem };
  const before = (await loadSettingsView(db, a.now)).hours;
  const rows = sortWindows(windows);
  const ops = [
    db.delete(openingHours),
    ...(rows.length ? [db.insert(openingHours).values(rows.map((r) => ({ weekday: r.weekday, opensAt: r.opensAt, closesAt: r.closesAt })))] : []),
    audit(db, a, "settings.hours", "opening_hours", before, rows),
  ];
  await db.batch(ops as [(typeof ops)[number], ...(typeof ops)[number][]]);
  return { ok: true };
}

// ---- pause + general ---------------------------------------------------------

function upsertSettings(db: Db, patch: Partial<typeof settings.$inferInsert>) {
  return db.insert(settings).values({ id: 1, ...patch }).onConflictDoUpdate({ target: settings.id, set: patch });
}

export async function setPause(db: Db, a: Actor, p: { paused: boolean; message?: string | null }): Promise<Result> {
  const before = await loadGeneral(db);
  const message = p.paused ? p.message?.trim() || null : before.pausedMessage; // keep the last message when resuming
  await db.batch([
    upsertSettings(db, { paused: p.paused, pausedMessage: message }),
    audit(db, a, p.paused ? "settings.pause" : "settings.resume", "settings", { paused: before.paused, message: before.pausedMessage }, { paused: p.paused, message }),
  ]);
  return { ok: true };
}

export type GeneralPatch = Pick<General, "defaultPrepMinutes" | "cashMaxPence" | "cashDailyCapPerPhone" | "cashDailyCapPerIp">;
export async function saveGeneral(db: Db, a: Actor, g: GeneralPatch): Promise<Result> {
  const before = await loadGeneral(db);
  const { defaultPrepMinutes, cashMaxPence, cashDailyCapPerPhone, cashDailyCapPerIp } = g;
  await db.batch([
    upsertSettings(db, { defaultPrepMinutes, cashMaxPence, cashDailyCapPerPhone, cashDailyCapPerIp }),
    audit(db, a, "settings.general", "settings", { ...before, paused: undefined, pausedMessage: undefined }, g),
  ]);
  return { ok: true };
}

// ---- closures -----------------------------------------------------------------

export async function addClosure(db: Db, a: Actor, c: { day: string; reason?: string }): Promise<Result<{ id: number }>> {
  const existing = await db.select({ id: closure.id }).from(closure).where(eq(closure.day, c.day)).limit(1);
  if (existing.length) return { ok: false, code: "DUPLICATE", message: "That day is already marked closed." };
  const [row] = await db.insert(closure).values({ day: c.day, reason: c.reason?.trim() || null }).returning({ id: closure.id });
  await audit(db, a, "closure.add", `closure:${row.id}`, null, c);
  return { ok: true, id: row.id };
}

export async function removeClosure(db: Db, a: Actor, id: number): Promise<Result> {
  const [before] = await db.select().from(closure).where(eq(closure.id, id)).limit(1);
  if (!before) return { ok: false, code: "NOT_FOUND", message: "Closure not found." };
  await db.batch([db.delete(closure).where(eq(closure.id, id)), audit(db, a, "closure.remove", `closure:${id}`, before, null)]);
  return { ok: true };
}

// ---- delivery zones --------------------------------------------------------------

export type ZoneInput = Omit<ZoneRow, "id">;
const isUnique = (e: unknown) => /duplicate key|unique/i.test(e instanceof Error ? `${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}` : "");

export async function createZone(db: Db, a: Actor, z: ZoneInput): Promise<Result<{ id: number }>> {
  try {
    const [row] = await db.insert(deliveryZone).values(z).returning({ id: deliveryZone.id });
    await audit(db, a, "zone.create", `zone:${row.id}`, null, z);
    return { ok: true, id: row.id };
  } catch (e) {
    if (isUnique(e)) return { ok: false, code: "DUPLICATE", message: `${z.district} already exists.` };
    throw e;
  }
}

export async function updateZone(db: Db, a: Actor, id: number, z: Omit<ZoneInput, "district">): Promise<Result> {
  const [before] = await db.select().from(deliveryZone).where(eq(deliveryZone.id, id)).limit(1);
  if (!before) return { ok: false, code: "NOT_FOUND", message: "Zone not found." };
  await db.batch([db.update(deliveryZone).set(z).where(eq(deliveryZone.id, id)), audit(db, a, "zone.update", `zone:${id}`, before, { ...before, ...z })]);
  return { ok: true };
}

export async function deleteZone(db: Db, a: Actor, id: number): Promise<Result> {
  const [before] = await db.select().from(deliveryZone).where(eq(deliveryZone.id, id)).limit(1);
  if (!before) return { ok: false, code: "NOT_FOUND", message: "Zone not found." };
  await db.batch([db.delete(deliveryZone).where(eq(deliveryZone.id, id)), audit(db, a, "zone.delete", `zone:${id}`, before, null)]);
  return { ok: true };
}
