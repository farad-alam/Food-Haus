// R13.15: customer order pages are addressed by a long random token, never by
// the sequential order number, so /order/<token> cannot be enumerated.

/** 128 bits of randomness, base64url (22 chars). Server-side only. */
export function newOrderToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
