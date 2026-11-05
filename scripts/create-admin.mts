import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";
import { createAdminUser } from "../lib/auth/pg-store";
import { PgAdminStore } from "../lib/auth/pg-store";
import { issueSetupToken } from "../lib/auth/enrolment";
import { passwordHasher, validatePasswordPolicy } from "../lib/auth/password";

// Creates an admin user. The password is read from ADMIN_PASSWORD (never from
// argv, which shows up in process listings and shell history).
//   ADMIN_PASSWORD=... SECRET_BOX_KEY=... npm run admin:create -- owner@example.com owner
const [email, role] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD;
const key = process.env.SECRET_BOX_KEY;
const url = process.env.DATABASE_URL;
if (!email || !["owner", "manager", "kitchen"].includes(role ?? "")) throw new Error("Usage: npm run admin:create -- <email> <owner|manager|kitchen>");
if (!password || !key || !url) throw new Error("ADMIN_PASSWORD, SECRET_BOX_KEY and DATABASE_URL must be set.");
const problem = validatePasswordPolicy(password, { email });
if (problem) throw new Error(problem);

const db = drizzle(neon(url), { schema });
// Owners and managers have no authenticator yet: they enrol themselves through a one-time
// link (24 hours) plus their password, so no 2FA secret is ever printed or typed into a terminal.
const userId = await createAdminUser(db, key, {
  email,
  passwordHash: await passwordHasher.hash(password),
  role: role as "owner" | "manager" | "kitchen",
});
console.log(`Created ${role} ${email}.`);
if (role !== "kitchen") {
  const { token } = await issueSetupToken(new PgAdminStore(db, key), userId, new Date());
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  console.log(`Send them this one-time link (valid 24 hours; they also need their password):\n${site}/admin/setup/${token}`);
}
