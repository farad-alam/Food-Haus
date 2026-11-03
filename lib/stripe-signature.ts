// Stripe webhook signature verification (R8.4), on Web Crypto so it runs on
// Cloudflare Workers unchanged. Scheme per Stripe's docs: the `Stripe-Signature`
// header carries `t=<unix seconds>` and one or more `v1=<hex>` values, where
// v1 = HMAC-SHA256(endpoint secret, `${t}.${rawBody}`).
//
// Rules enforced here:
//  - the signature is checked against the RAW request body, exactly as received
//    (never a re-serialised JSON.parse result);
//  - the timestamp must be within the tolerance (default 5 minutes) to block replays;
//  - comparison is constant-time (crypto.subtle.verify), and any one valid v1 passes
//    (Stripe sends several while a secret is being rolled).

const HEX64 = /^[0-9a-f]{64}$/;

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export type SignatureResult = { ok: true; timestamp: number } | { ok: false; reason: string };

export async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  options: { nowMs?: number; toleranceSeconds?: number } = {},
): Promise<SignatureResult> {
  if (!secret) return { ok: false, reason: "no_secret_configured" };
  if (!header) return { ok: false, reason: "missing_header" };

  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t" && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    else if (key === "v1") signatures.push(value.toLowerCase());
  }
  if (timestamp === null) return { ok: false, reason: "bad_timestamp" };
  if (signatures.length === 0) return { ok: false, reason: "no_v1_signature" };

  const tolerance = options.toleranceSeconds ?? 300;
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestamp) > tolerance) return { ok: false, reason: "timestamp_outside_tolerance" };

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const data = enc.encode(`${timestamp}.${rawBody}`);

  for (const sig of signatures) {
    if (!HEX64.test(sig)) continue;
    if (await crypto.subtle.verify("HMAC", key, hexToBytes(sig), data)) return { ok: true, timestamp };
  }
  return { ok: false, reason: "signature_mismatch" };
}
