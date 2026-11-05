import { describe, expect, it } from "vitest";
import { makeScheduled, MAINTENANCE_PATH } from "@/lib/cron";

describe("cron handler", () => {
  const ctx = { waitUntil: () => {} };

  it("calls the maintenance route through the worker with the bearer secret", async () => {
    const seen: Request[] = [];
    const worker = async (r: Request) => (seen.push(r), Response.json({ ok: true }));
    await makeScheduled(worker)({}, { CRON_SECRET: "s".repeat(32), NEXT_PUBLIC_SITE_URL: "https://food-haus.example" }, ctx);
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("POST");
    expect(new URL(seen[0].url).pathname).toBe(MAINTENANCE_PATH);
    expect(new URL(seen[0].url).origin).toBe("https://food-haus.example");
    expect(seen[0].headers.get("authorization")).toBe(`Bearer ${"s".repeat(32)}`);
  });

  it("fails loudly (so Cloudflare marks the run failed) when the route errors or the secret is missing", async () => {
    await expect(makeScheduled(async () => new Response("nope", { status: 500 }))({}, { CRON_SECRET: "s".repeat(32) }, ctx)).rejects.toThrow(/HTTP 500/);
    await expect(makeScheduled(async () => new Response("nope", { status: 401 }))({}, { CRON_SECRET: "s".repeat(32) }, ctx)).rejects.toThrow(/HTTP 401/);
    let called = false;
    await expect(makeScheduled(async () => ((called = true), Response.json({})))({}, {}, ctx)).rejects.toThrow(/CRON_SECRET is not set/);
    expect(called).toBe(false); // never calls out without a secret
  });
});
