import { readFileSync } from "node:fs";

// Runs first in the Cloudflare build (npm run cf:ci-build). Stops the build with a plain message,
// BEFORE touching the database, if something the deploy needs is missing. Prints no secret values.
const problems: string[] = [];

for (const name of ["DATABASE_URL", "SECRET_BOX_KEY", "NEXT_PUBLIC_SITE_URL"]) {
  if (!process.env[name]) problems.push(`Build variable ${name} is not set (Settings, Builds, Variables and secrets).`);
}
const key = process.env.SECRET_BOX_KEY;
if (key && Buffer.from(key, "base64").length !== 32) problems.push("SECRET_BOX_KEY must be 32 random bytes, base64 encoded.");
const site = process.env.NEXT_PUBLIC_SITE_URL;
if (site && !/^https:\/\/[a-z0-9.-]+$/i.test(site)) problems.push("NEXT_PUBLIC_SITE_URL must look like https://food-haus.<subdomain>.workers.dev (https, no trailing slash, no path).");

// The two cache stores must be real: the deploy fills them BEFORE the Worker is uploaded.
const config = readFileSync("wrangler.jsonc", "utf8");
if (config.includes("local-placeholder-replace-before-deploy")) {
  problems.push("wrangler.jsonc still has placeholder ids for the KV namespace and/or D1 database. Create them in the Cloudflare dashboard and commit the real ids.");
}

if (problems.length) {
  console.error("\nBuild stopped before doing anything:\n" + problems.map((p) => `  - ${p}`).join("\n") + "\n");
  process.exit(1);
}
console.log("Preflight OK: variables present, cache ids are real.");
