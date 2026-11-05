import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";
import { issueSetupToken } from "../lib/auth/enrolment";
import { PgAdminStore } from "../lib/auth/pg-store";
import { requiresTwoStep } from "../lib/auth/rbac";

// Prints a fresh one-time 2FA setup link (valid 24 hours) for an owner or manager.
//   SECRET_BOX_KEY=... DATABASE_URL=... npm run admin:setup-link -- someone@example.com
// For someone who lost BOTH their phone and their recovery codes, add --reset: it removes
// their authenticator and recovery codes and signs them out everywhere, then prints the link.
//   ... npm run admin:setup-link -- someone@example.com --reset
// The person still needs their password to use the link.
const args = process.argv.slice(2);
const reset = args.includes("--reset");
const email = args.find((a) => !a.startsWith("--"));
const key = process.env.SECRET_BOX_KEY;
const url = process.env.DATABASE_URL;
if (!email) throw new Error("Usage: npm run admin:setup-link -- <email> [--reset]");
if (!key || !url) throw new Error("SECRET_BOX_KEY and DATABASE_URL must be set.");

const store = new PgAdminStore(drizzle(neon(url), { schema }), key);
const user = await store.findUserByEmail(email.trim().toLowerCase());
if (!user || user.disabled) throw new Error("No active account with that email.");
if (!requiresTwoStep(user.role)) throw new Error(`${user.role} accounts do not use two-step login.`);
if (user.totpSecret && !reset) throw new Error("That account already has two-step login. Use --reset if they have lost their phone and recovery codes.");
if (reset) {
  await store.clearTotp(user.id);
  console.log(`Removed ${user.email}'s authenticator and recovery codes and signed them out.`);
}
const { token } = await issueSetupToken(store, user.id, new Date());
const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
console.log(`One-time link (valid 24 hours; they also need their password):\n${site}/admin/setup/${token}`);
