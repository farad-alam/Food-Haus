// Worker entry for Cloudflare (wrangler.jsonc "main"). Wraps the worker that
// `opennextjs-cloudflare build` generates and adds the Cron Trigger handler.
// All logic lives in lib/cron.ts; this file is only wiring, and is excluded from
// the TypeScript check (tsconfig "exclude") because the generated file does not exist until a build.
import { default as openNextWorker } from "../.open-next/worker.js";
import { makeScheduled } from "../lib/cron";

const worker = {
  fetch: openNextWorker.fetch,
  scheduled: makeScheduled(openNextWorker.fetch),
};
export default worker;

// Durable Object classes the generated worker exports (only used if configured).
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "../.open-next/worker.js";
