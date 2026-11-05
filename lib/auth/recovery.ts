// Recovery codes for two-step login (R9.2): the way back in when the phone with
// the authenticator app is lost. Pure functions; storage lives in AdminStore.
//
// A code is 10 characters from a 32-letter alphabet (no 0, 1, I or O, which are
// easily misread), shown as XXXXX-XXXXX. That is 50 random bits: too many to guess
// within the login throttle, and each code works once. Only a hash is stored, so
// a database leak does not reveal usable codes.

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 symbols: a byte masked to 5 bits maps without bias
export const RECOVERY_COUNT = 10;
const LENGTH = 10;

export function generateRecoveryCodes(n: number = RECOVERY_COUNT): string[] {
  const out = new Set<string>();
  while (out.size < n) {
    const bytes = new Uint8Array(LENGTH);
    crypto.getRandomValues(bytes);
    const raw = Array.from(bytes, (b) => ALPHABET[b & 31]).join("");
    out.add(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return [...out];
}

/** Upper-cases and strips spaces and dashes; null unless exactly 10 valid characters. */
export function normaliseRecoveryCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, "");
  return s.length === LENGTH && [...s].every((c) => ALPHABET.includes(c)) ? s : null;
}

/** True for something typed as a recovery code (and not as a 6-digit authenticator code). */
export function looksLikeRecoveryCode(input: string): boolean {
  return normaliseRecoveryCode(input) !== null;
}

/** SHA-256 hex, domain-separated from every other hash we make. Input must already be a valid code. */
export async function hashRecoveryCode(input: string): Promise<string> {
  const code = normaliseRecoveryCode(input);
  if (!code) throw new Error("not a recovery code");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`recovery:v1:${code}`)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}
