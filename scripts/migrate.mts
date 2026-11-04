import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

// Applies db/migrations over HTTPS (works where raw port 5432 is blocked).
// Usage: DATABASE_URL=... npm run db:migrate
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
await migrate(drizzle(neon(url)), { migrationsFolder: "./db/migrations" });
console.log("Migrations applied.");
