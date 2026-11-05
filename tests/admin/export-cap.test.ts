import { beforeEach, describe, expect, it, vi } from "vitest";

// The export must never silently cut a big result short (a partial file looks
// complete). Reaching the cap needs 5,001 orders, so the data layer is mocked.
const state = vi.hoisted(() => ({ count: 0, exported: 0, audited: 0 }));
vi.mock("@/lib/admin/guard", () => ({
  guard: async () => ({ user: { id: 1, email: "owner@example.test", role: "owner" } }),
  jsonResponse: (status: number, body: unknown) => Response.json(body, { status }),
}));
vi.mock("@/lib/admin/history", () => ({
  countHistory: async () => state.count,
  exportHistory: async () => ((state.exported += 1), []),
}));
vi.mock("@/lib/admin/audit", () => ({ auditInsert: async () => (state.audited += 1) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

import { GET } from "@/app/api/admin/history/export/route";
const call = () => GET(new Request("http://localhost:3000/api/admin/history/export?from=2025-01-01"));

describe("export size limit", () => {
  beforeEach(() => Object.assign(state, { count: 0, exported: 0, audited: 0 }));

  it("refuses more than 5,000 orders with a clear message, exporting and auditing nothing", async () => {
    state.count = 5001;
    const r = await call();
    expect(r.status).toBe(422);
    const body = await r.json();
    expect(body).toMatchObject({ ok: false, code: "TOO_MANY" });
    expect(body.message).toMatch(/5,001 orders.*Narrow the dates.*5,000/);
    expect(state.exported).toBe(0);
    expect(state.audited).toBe(0);
  });
  it("allows exactly 5,000", async () => {
    state.count = 5000;
    expect((await call()).status).toBe(200);
    expect(state.exported).toBe(1);
    expect(state.audited).toBe(1);
  });
});
