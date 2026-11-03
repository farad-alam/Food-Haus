import { describe, expect, it } from "vitest";
import { verifyStripeSignature } from "@/lib/stripe-signature";

const SECRET = "whsec_test_secret_value";
const BODY = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
const NOW_MS = 1_800_000_000_000;
const T = Math.floor(NOW_MS / 1000);

async function sign(body: string, t: number, secret = SECRET): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${body}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const verify = (body: string, header: string | null, opts = {}) =>
  verifyStripeSignature(body, header, SECRET, { nowMs: NOW_MS, ...opts });

describe("verifyStripeSignature", () => {
  it("accepts a correctly signed payload", async () => {
    const header = `t=${T},v1=${await sign(BODY, T)}`;
    expect(await verify(BODY, header)).toEqual({ ok: true, timestamp: T });
  });

  it("rejects a tampered body", async () => {
    const header = `t=${T},v1=${await sign(BODY, T)}`;
    const r = await verify(BODY.replace("cs_1", "cs_2"), header);
    expect(r).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects a re-serialised body (must be the raw bytes)", async () => {
    const header = `t=${T},v1=${await sign(BODY, T)}`;
    const reserialised = JSON.stringify(JSON.parse(BODY), null, 2);
    expect((await verify(reserialised, header)).ok).toBe(false);
  });

  it("rejects the wrong secret", async () => {
    const header = `t=${T},v1=${await sign(BODY, T, "whsec_other")}`;
    expect((await verify(BODY, header)).ok).toBe(false);
  });

  it("rejects replays outside the 5-minute tolerance, accepts inside", async () => {
    const old = T - 301;
    expect(await verify(BODY, `t=${old},v1=${await sign(BODY, old)}`)).toEqual({ ok: false, reason: "timestamp_outside_tolerance" });
    const future = T + 301;
    expect((await verify(BODY, `t=${future},v1=${await sign(BODY, future)}`)).ok).toBe(false);
    const edge = T - 300;
    expect((await verify(BODY, `t=${edge},v1=${await sign(BODY, edge)}`)).ok).toBe(true);
  });

  it("a signature cannot be moved to a different timestamp", async () => {
    const sig = await sign(BODY, T - 10);
    expect((await verify(BODY, `t=${T},v1=${sig}`)).ok).toBe(false);
  });

  it("accepts when any one of several v1 signatures is valid (secret rolling)", async () => {
    const good = await sign(BODY, T);
    const header = `t=${T},v1=${"0".repeat(64)},v1=${good}`;
    expect((await verify(BODY, header)).ok).toBe(true);
  });

  it("rejects missing, malformed and empty inputs", async () => {
    expect(await verify(BODY, null)).toEqual({ ok: false, reason: "missing_header" });
    expect(await verify(BODY, "garbage")).toEqual({ ok: false, reason: "bad_timestamp" });
    expect(await verify(BODY, `t=${T}`)).toEqual({ ok: false, reason: "no_v1_signature" });
    expect(await verify(BODY, `t=${T},v1=nothex`)).toEqual({ ok: false, reason: "signature_mismatch" });
    expect(await verify(BODY, `t=abc,v1=${"0".repeat(64)}`)).toEqual({ ok: false, reason: "bad_timestamp" });
    expect(await verifyStripeSignature(BODY, `t=${T},v1=${"0".repeat(64)}`, "", { nowMs: NOW_MS })).toEqual({
      ok: false,
      reason: "no_secret_configured",
    });
  });
});
