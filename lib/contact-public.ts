import { cacheLife, cacheTag } from "next/cache";
import { eq } from "drizzle-orm";
import { settings } from "@/db/schema";
import type { Db } from "./db/client";
import { getDb } from "./db/client";
import { contactFromStored, DEFAULT_CONTACT, isConfirmed, type Contact } from "./contact";

/** Reads the contact details from the database (not cached). Used by emails, receipts and the admin. */
export async function loadContact(db: Db): Promise<{ contact: Contact; confirmed: boolean }> {
  const [s] = await db.select({ c: settings.contact }).from(settings).where(eq(settings.id, 1)).limit(1);
  return { contact: contactFromStored(s?.c), confirmed: isConfirmed(s?.c) };
}

/** For public pages: cached with the "settings" tag, so a save shows on the next view. Never throws: the starting values are the fallback. */
export async function getContact(): Promise<Contact> {
  "use cache";
  cacheTag("settings");
  cacheLife("minutes");
  try {
    return (await loadContact(getDb())).contact;
  } catch {
    return DEFAULT_CONTACT;
  }
}
