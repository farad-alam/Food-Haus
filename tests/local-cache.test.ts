import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cached, clearLocalCache, TTL_MS } from "@/lib/local-cache";

beforeEach(() => {
  vi.useFakeTimers();
  clearLocalCache();
});
afterEach(() => vi.useRealTimers());

describe("per-instance cache for the public data", () => {
  it("serves a loaded value until it is 30 seconds old, then loads again", async () => {
    const load = vi.fn(async () => ({ n: load.mock.calls.length }));
    expect((await cached("k", load)).n).toBe(1);
    expect((await cached("k", load)).n).toBe(1);
    vi.advanceTimersByTime(TTL_MS - 1);
    expect((await cached("k", load)).n).toBe(1);
    vi.advanceTimersByTime(2);
    expect((await cached("k", load)).n).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("NEVER shares work between concurrent requests: every miss does its own load", async () => {
    const gates: (() => void)[] = [];
    const load = vi.fn(() => new Promise<string>((resolve) => gates.push(() => resolve("v"))));
    const a = cached("k", load);
    const b = cached("k", load); // a second request arriving while the first is still loading
    expect(load).toHaveBeenCalledTimes(2);
    gates[1](); // the second finishes while the first never does (its request was cancelled)
    expect(await b).toBe("v");
    gates[0]();
    expect(await a).toBe("v");
  });
  it("a request that never finishes cannot block a later one", async () => {
    let first = true;
    const load = vi.fn(() => (first ? ((first = false), new Promise<string>(() => {})) : Promise.resolve("ok")));
    void cached("k", load); // abandoned: never settles
    expect(await cached("k", load)).toBe("ok");
  });
  it("a failure is thrown to that request and not remembered", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce("fine");
    await expect(cached("k", load)).rejects.toThrow("db down");
    expect(await cached("k", load)).toBe("fine");
  });
  it("callers get their own copy: changing it does not change what the next caller reads", async () => {
    const a = await cached("k", async () => ({ items: [1, 2] }));
    a.items.push(3);
    const b = await cached("k", async () => ({ items: [9] }));
    expect(b.items).toEqual([1, 2]);
  });
  it("clearing by prefix forgets only that group", async () => {
    await cached("menu", async () => 1);
    await cached("offers:public", async () => 2);
    await cached("settings:notice", async () => 3);
    clearLocalCache("offers");
    expect(await cached("menu", async () => 10)).toBe(1);
    expect(await cached("offers:public", async () => 20)).toBe(20);
    expect(await cached("settings:notice", async () => 30)).toBe(3);
    clearLocalCache();
    expect(await cached("menu", async () => 11)).toBe(11);
  });
});
