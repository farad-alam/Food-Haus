import { and, count, eq, gte } from "drizzle-orm";
import { authEvent } from "@/db/schema";
import type { Db } from "@/lib/db/client";

// R6.14: rate-limit promo-code guessing. Failed attempts are counted per
// (keyed-hash of) client IP in the same generic counter table the login
// throttle uses. Cloudflare WAF rules are the first line; this is the
// application-level backstop. Rows are tiny; a cron job should prune old ones.

export const PROMO_FAIL_LIMIT = 10;
export const PROMO_WINDOW_MS = 15 * 60_000;
const key = (ipHash: string) => `promo:${ipHash}`;

export async function promoBlocked(db: Db, ipHash: string, now: Date): Promise<boolean> {
  const [r] = await db
    .select({ n: count() })
    .from(authEvent)
    .where(and(eq(authEvent.key, key(ipHash)), gte(authEvent.at, new Date(now.getTime() - PROMO_WINDOW_MS))));
  return (r?.n ?? 0) >= PROMO_FAIL_LIMIT;
}

export async function recordPromoFailure(db: Db, ipHash: string, now: Date): Promise<void> {
  await db.insert(authEvent).values({ key: key(ipHash), at: now });
}

export const isPromoError = (code: string) => code.startsWith("PROMO_");
