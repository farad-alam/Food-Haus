import { and, lt } from "drizzle-orm";
import { adminSession, adminSetupToken, authEvent, passwordResetToken, stripeEvent, totpEnrolment } from "@/db/schema";
import type { Db } from "@/lib/db/client";
import { expireUnpaidOrders } from "@/lib/checkout-service";

// Scheduled housekeeping, run every few minutes by a Cloudflare Cron Trigger
// (cloudflare/worker.ts -> POST /api/cron/maintenance).
//
//  - Unpaid card orders are cancelled and their promo use freed (R8.7), so they
//    never linger and a limited offer is not held by someone who never paid.
//  - Old throttling counters, expired sessions, used or expired reset links and
//    old Stripe event ids are deleted so those tables stay small and so
//    nothing sensitive is kept longer than it is useful.
//
// Each step runs on its own: one failing never stops the others, and any failure
// is reported so the cron run shows as failed in Cloudflare's logs.

const DAY = 86_400_000;
export const RETENTION = {
  authEventsMs: 2 * DAY, // longest throttle window is 1 hour
  sessionsMs: 1 * DAY, // after expiry
  resetTokensMs: 1 * DAY, // after expiry
  setupLinksMs: 1 * DAY, // 2FA setup links, after expiry; also abandoned half-finished enrolments (secret never confirmed)
  stripeEventsMs: 60 * DAY, // Stripe retries for 3 days; 60 keeps a long audit tail
};

export type MaintenanceResult = {
  ok: boolean;
  expiredOrders: number;
  prunedAuthEvents: number;
  prunedSessions: number;
  prunedResetTokens: number;
  prunedStripeEvents: number;
  errors: string[];
};

export async function runMaintenance(db: Db, now: Date): Promise<MaintenanceResult> {
  const r: MaintenanceResult = { ok: true, expiredOrders: 0, prunedAuthEvents: 0, prunedSessions: 0, prunedResetTokens: 0, prunedStripeEvents: 0, errors: [] };
  const before = (ms: number) => new Date(now.getTime() - ms);
  const step = async (name: string, fn: () => Promise<number>, set: (n: number) => void) => {
    try {
      set(await fn());
    } catch (e) {
      r.ok = false;
      r.errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  await step("expire unpaid orders", () => expireUnpaidOrders(db, now), (n) => (r.expiredOrders = n));
  await step("prune auth events", async () => (await db.delete(authEvent).where(lt(authEvent.at, before(RETENTION.authEventsMs))).returning({ id: authEvent.id })).length, (n) => (r.prunedAuthEvents = n));
  await step("prune sessions", async () => (await db.delete(adminSession).where(lt(adminSession.expiresAt, before(RETENTION.sessionsMs))).returning({ h: adminSession.tokenHash })).length, (n) => (r.prunedSessions = n));
  await step("prune reset tokens", async () => (await db.delete(passwordResetToken).where(and(lt(passwordResetToken.expiresAt, before(RETENTION.resetTokensMs)))).returning({ h: passwordResetToken.tokenHash })).length, (n) => (r.prunedResetTokens = n));
  await step("prune 2fa setup links", async () => {
    const links = await db.delete(adminSetupToken).where(lt(adminSetupToken.expiresAt, before(RETENTION.setupLinksMs))).returning({ h: adminSetupToken.tokenHash });
    const pending = await db.delete(totpEnrolment).where(lt(totpEnrolment.createdAt, before(RETENTION.setupLinksMs))).returning({ u: totpEnrolment.userId });
    return links.length + pending.length;
  }, (n) => (r.prunedResetTokens += n)); // counted with the other one-time links
  await step("prune stripe events", async () => (await db.delete(stripeEvent).where(lt(stripeEvent.processedAt, before(RETENTION.stripeEventsMs))).returning({ id: stripeEvent.id })).length, (n) => (r.prunedStripeEvents = n));
  return r;
}
