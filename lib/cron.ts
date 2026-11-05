// The Cloudflare Cron Trigger handler. The generated OpenNext worker only has
// `fetch`, so cloudflare/worker.ts wraps it and adds `scheduled`. Rather than
// reaching into app code from the cron context (where bindings and process.env
// are set up differently), the cron calls the app's own maintenance route
// through the same worker, so it runs exactly like a normal request.

export type CronEnv = { CRON_SECRET?: string; NEXT_PUBLIC_SITE_URL?: string };
type WorkerFetch<Env> = (request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) => Promise<Response>;

export const MAINTENANCE_PATH = "/api/cron/maintenance";

export function makeScheduled<Env extends CronEnv>(workerFetch: WorkerFetch<Env>) {
  return async function scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    if (!env.CRON_SECRET) throw new Error("CRON_SECRET is not set; maintenance did not run.");
    const origin = env.NEXT_PUBLIC_SITE_URL || "https://localhost";
    const res = await workerFetch(new Request(new URL(MAINTENANCE_PATH, origin), { method: "POST", headers: { authorization: `Bearer ${env.CRON_SECRET}` } }), env, ctx);
    // Throwing marks this cron run as FAILED in Cloudflare's dashboard and logs.
    if (!res.ok) throw new Error(`Maintenance returned HTTP ${res.status}.`);
  };
}
