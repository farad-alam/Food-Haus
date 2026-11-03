// Time-based one-time passwords for the two-step login (R9.2), RFC 6238
// (HMAC-SHA1, 30-second steps, 6 digits) so any authenticator app works.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;
export const DIGITS = 6;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Uint8Array<ArrayBuffer> | null {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  if (clean.length === 0 || /[^A-Z2-7]/.test(clean)) return null;
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A fresh 160-bit secret, base32 (what the authenticator app stores). */
export function generateTotpSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

async function hotp(secret: Uint8Array<ArrayBuffer>, counter: number, digits = DIGITS): Promise<string> {
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export async function totpAt(secretBase32: string, timeMs: number, digits = DIGITS): Promise<string | null> {
  const secret = base32Decode(secretBase32);
  if (!secret) return null;
  return hotp(secret, Math.floor(timeMs / 1000 / STEP_SECONDS), digits);
}

export type TotpResult = { ok: true; step: number } | { ok: false };

/**
 * Accepts the current step and one either side (clock drift). `lastUsedStep`
 * gives replay protection: a code from a step at or before the last accepted
 * one is refused, so a shoulder-surfed code cannot be reused. The caller must
 * persist `step` from a successful result.
 */
export async function verifyTotp(
  secretBase32: string,
  code: string,
  nowMs: number,
  lastUsedStep: number | null = null,
): Promise<TotpResult> {
  const secret = base32Decode(secretBase32);
  const cleaned = code.replace(/\s/g, "");
  if (!secret || !/^\d{6}$/.test(cleaned)) return { ok: false };
  const current = Math.floor(nowMs / 1000 / STEP_SECONDS);
  let matched: number | null = null;
  // Check every candidate (no early exit) so timing does not reveal which step matched.
  for (const step of [current - 1, current, current + 1]) {
    const expected = await hotp(secret, step);
    let diff = 0;
    for (let i = 0; i < DIGITS; i++) diff |= expected.charCodeAt(i) ^ cleaned.charCodeAt(i);
    if (diff === 0 && matched === null) matched = step;
  }
  if (matched === null) return { ok: false };
  if (lastUsedStep !== null && matched <= lastUsedStep) return { ok: false };
  return { ok: true, step: matched };
}

export function otpauthUri(secretBase32: string, accountEmail: string, issuer = "Food Haus"): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
