import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { count } from "drizzle-orm";
import * as schema from "../db/schema";
import { issueSetupToken } from "../lib/auth/enrolment";
import { createAdminUser, PgAdminStore } from "../lib/auth/pg-store";
import { passwordHasher, validatePasswordPolicy } from "../lib/auth/password";
import { twoStepEnabled } from "../lib/auth/config";

// First-owner bootstrap for a terminal-free preview deploy (runs inside the Cloudflare build, after the
// migrations and the sample-menu seed). Reads BOOTSTRAP_OWNER_EMAIL and BOOTSTRAP_OWNER_PASSWORD from the
// build variables. It NEVER prints the password.
//
// Admin login is email + password only (ADMIN_TWO_STEP is off by default, an owner decision on R9.2), so:
//  - no admin accounts yet: creates the owner and prints the login address
// Only when ADMIN_TWO_STEP is switched on does it also issue the one-time two-step setup link (24 hours, useless
// without the password) and, for an owner who has not finished setting up, a fresh one on a retried build.
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
const twoStep = twoStepEnabled();
const loginAddress = () => console.log(`\nOWNER LOGIN ADDRESS (sign in with that email and the bootstrap password):\n${site}/admin/login\n`);
const link = (token: string) => console.log(`\nOWNER SETUP LINK (one-time, valid 24 hours; needs the bootstrap password):\n${site}/admin/setup/${token}\n`);

const existing = await store.findUserByEmail(email);
if (existing) {
  if (twoStep && existing.role === "owner" && !existing.totpSecret && !existing.disabled) {
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
if (!twoStep) loginAddress();
else link((await issueSetupToken(store, id, new Date())).token);
