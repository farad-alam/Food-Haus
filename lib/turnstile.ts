// Cloudflare Turnstile server-side verification (R13.13).
export async function verifyTurnstile(
  token: string | undefined,
  secret: string,
  ip: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!token) return false;
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set("remoteip", ip);
  try {
    const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const body = (await res.json()) as { success?: boolean };
    return body.success === true;
  } catch {
    return false; // fail closed
  }
}
