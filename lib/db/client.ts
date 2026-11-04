import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "@/db/schema";

// Database client over Neon's HTTPS driver. Chosen over a raw TCP driver
// because Cloudflare Workers cannot open arbitrary TCP sockets the way Node
// can, and because it needs no connection pool: each query is one HTTPS call.
// Multi-statement atomic work uses db.batch(), which Neon runs as a single
// transaction.
//
// DATABASE_URL is read lazily so importing this file never throws at build
// time; a missing variable fails on the first query with a clear message.

export type Db = NeonHttpDatabase<typeof schema>;

let cached: { url: string; db: Db } | null = null;

export function getDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (cached?.url !== url) cached = { url, db: drizzle(neon(url), { schema }) };
  return cached.db;
}
