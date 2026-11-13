import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { count } from "drizzle-orm";
import * as schema from "../db/schema";
import { issueSetupToken } from "../lib/auth/enrolment";
import { createAdminUser, PgAdminStore } from "../lib/auth/pg-store";
import { passwordHasher, validatePasswordPolicy } from "../lib/auth/password";

// First-owner bootstrap for a terminal-free preview deploy (runs inside the Cloudflare build, after the
// migrations and the sample-menu seed). Reads BOOTSTRAP_OWNER_EMAIL and BOOTSTRAP_OWNER_PASSWORD from the
// build variables. It NEVER prints the password; it prints a one-time setup link (24 hours) that is
// useless without that password.
//
//  - no admin accounts yet: creates the owner (no authenticator yet) and prints the setup link
//  - that owner exists but has not finished setting up two-step login: prints a fresh setup link
//    (so a retried build replaces an expired link)
//  - anything else: does nothing, so a rebuild can never create or change accounts
const email = process.env.BOOTSTRAP_OWNER_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_OWNER_PASSWORD;
const url = process.env.DATABASE_URL;
const key = process.env.SECRET_BOX_KEY;
if (!url || !key) throw new Error("DATABASE_URL and SECRET_BOX_KEY must be set.");
if (!email || !password) {
  console.log("Bootstrap skipped: BOOTSTRAP_OWNER_EMAIL / BOOTSTRAP_OWNER_PASSWORD are not set.");
  process.exit(0);
}

const db = drizzle(neon(url), { schema });
const store = new PgAdminStore(db, key);
const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const link = (token: string) => console.log(`\nOWNER SETUP LINK (one-time, valid 24 hours; needs the bootstrap password):\n${site}/admin/setup/${token}\n`);

const existing = await store.findUserByEmail(email);
if (existing) {
  if (existing.role === "owner" && !existing.totpSecret && !existing.disabled) {
    link((await issueSetupToken(store, existing.id, new Date())).token);
  } else {
    console.log("Bootstrap skipped: that account already exists and has finished setup.");
  }
  process.exit(0);
}

const [{ n }] = await db.select({ n: count() }).from(schema.adminUser);
if (n > 0) {
  console.log("Bootstrap skipped: admin accounts already exist.");
  process.exit(0);
}

const problem = validatePasswordPolicy(password, { email });
if (problem) throw new Error(`BOOTSTRAP_OWNER_PASSWORD is not acceptable: ${problem}`);
const id = await createAdminUser(db, key, { email, passwordHash: await passwordHasher.hash(password), role: "owner" });
console.log(`Created owner ${email}.`);
link((await issueSetupToken(store, id, new Date())).token);
