import { after } from "next/server";

/**
 * Run background work after the response. Uses Next's after() (waitUntil on
 * Workers) so a slow email provider never delays the customer; if called
 * outside a request scope it still runs, detached. It never throws.
 */
export function runAfter(work: () => Promise<unknown>): void {
  const safe = () => work().catch((e) => console.error("background task failed", e instanceof Error ? e.message : e));
  try {
    after(safe);
  } catch {
    void safe();
  }
}
