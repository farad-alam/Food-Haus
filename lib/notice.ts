import { cacheLife, cacheTag } from "next/cache";
import { eq } from "drizzle-orm";
import { settings } from "@/db/schema";
import { getDb } from "./db/client";
import { cleanNotice } from "./notice-text";

// The site-wide notice bar (R9.9), read for the public pages. Text rules live in notice-text.ts.

/** Cached with the "settings" tag: a save refreshes it on the next view, and the text is in the page HTML, so it never shifts the layout. */
export async function getNotice(): Promise<string | null> {
  "use cache";
  cacheTag("settings");
  cacheLife("minutes");
  const [s] = await getDb().select({ n: settings.noticeBar }).from(settings).where(eq(settings.id, 1)).limit(1);
  return cleanNotice(s?.n);
}
