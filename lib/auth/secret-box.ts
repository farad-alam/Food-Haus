// Encrypts small secrets (TOTP seeds) at rest with AES-256-GCM via WebCrypto,
// which runs on Node and Cloudflare Workers alike. The key comes from the
// SECRET_BOX_KEY environment variable: 32 random bytes, base64 encoded
// (generate with `openssl rand -base64 32`). Without the key a database dump
// alone cannot reveal anyone's 2FA seed.
//
// Format: "v1." + base64url(iv(12) || ciphertext+tag). The version prefix
// leaves room to rotate the key or algorithm later.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = b64decode(keyB64.trim());
  if (raw.length !== 32) throw new Error("SECRET_BOX_KEY must be 32 bytes, base64 encoded.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealSecret(plain: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return `v1.${b64urlEncode(out)}`;
}

/** Returns null for anything that is not a valid envelope under this key (wrong key, tampering). */
export async function openSecret(sealed: string, keyB64: string): Promise<string | null> {
  if (!sealed.startsWith("v1.")) return null;
  try {
    const key = await importKey(keyB64);
    const bytes = b64decode(sealed.slice(3));
    if (bytes.length < 13 + 16) return null;
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
    return dec.decode(pt);
  } catch {
    return null;
  }
}
