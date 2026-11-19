// Password hashing and policy (R13.3).
//
// DEVIATION FROM THE SPEC, ON PURPOSE: R13.3 names argon2id or bcrypt. Neither
// runs reliably on Cloudflare Workers — argon2 needs WebAssembly compiled from
// bytes (which Workers forbid) and pure-JS bcrypt is slow and CPU-limited. This
// uses PBKDF2-HMAC-SHA256 at 600,000 iterations, the current OWASP minimum for
// that algorithm. It runs on the platform's native Web Crypto wherever that
// accepts the iteration count (Node, tests). Cloudflare Workers' Web Crypto
// REFUSES PBKDF2 above 100,000 iterations, so there (and only there) the same
// algorithm runs in audited pure JavaScript (@noble/hashes), giving byte-for-byte
// identical hashes: a hash made in Node verifies in a Worker and the reverse,
// and a 600,000-iteration hash never has to be weakened. The stored format
// is versioned, so moving to argon2id later (for example if hashing moves to a
// Node service) only needs a new verifier plus `needsRehash`.

import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";

const PREFIX = "pbkdf2-sha256";
export const DEFAULT_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Cloudflare Workers' Web Crypto caps PBKDF2 at this many iterations; anything higher needs the JS fallback. */
export const WEBCRYPTO_MAX_ITERATIONS_WORKERS = 100_000;

/** The same PBKDF2-HMAC-SHA256 in pure JavaScript (slower, runs anywhere). Exported so tests can compare it with the native one. */
export function deriveJs(password: string, salt: Uint8Array, iterations: number): Uint8Array {
  return pbkdf2(sha256, new TextEncoder().encode(password.normalize("NFKC")), salt, { c: iterations, dkLen: KEY_BITS / 8 });
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, KEY_BITS);
    return new Uint8Array(bits);
  } catch (e) {
    // Only the known limit is handled: "iteration counts above 100000 are not supported" on Workers. Any other
    // failure is a real error and is thrown, never silently retried.
    if (iterations > WEBCRYPTO_MAX_ITERATIONS_WORKERS && /iteration|not supported|NotSupported/i.test(e instanceof Error ? `${e.name} ${e.message}` : String(e))) {
      return deriveJs(password, salt, iterations);
    }
    throw e;
  }
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export type PasswordHasher = {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
  needsRehash(stored: string): boolean;
};

export function createPasswordHasher(iterations: number = DEFAULT_ITERATIONS): PasswordHasher {
  return {
    async hash(password) {
      const salt = new Uint8Array(new ArrayBuffer(SALT_BYTES));
      crypto.getRandomValues(salt);
      const dk = await derive(password, salt, iterations);
      return `${PREFIX}$${iterations}$${toB64(salt)}$${toB64(dk)}`;
    },
    async verify(password, stored) {
      const parts = stored.split("$");
      if (parts.length !== 4 || parts[0] !== PREFIX) return false;
      const iter = Number(parts[1]);
      const salt = fromB64(parts[2]);
      const expected = fromB64(parts[3]);
      if (!Number.isInteger(iter) || iter < 1 || iter > 10_000_000 || !salt || !expected) return false;
      return constantTimeEqual(await derive(password, salt, iter), expected);
    },
    needsRehash(stored) {
      const parts = stored.split("$");
      return parts.length !== 4 || parts[0] !== PREFIX || Number(parts[1]) < iterations;
    },
  };
}

export const passwordHasher = createPasswordHasher();

// ---- policy ---------------------------------------------------------------

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

// A deliberately small blocklist of the passwords that actually get used in
// shops. Length does most of the work; this stops the obvious ones.
const COMMON = new Set([
  "password1234", "password12345", "123456789012", "qwertyuiop12", "letmein12345",
  "foodhaus12345", "foodhaus1234", "burgerburger", "welcome12345", "admin1234567",
]);

export function validatePasswordPolicy(password: string, context: { email?: string } = {}): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return "That password is too common.";
  if (/^(.)\1+$/.test(password)) return "That password is too repetitive.";
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return "Don’t include your email name in your password.";
  return null;
}
