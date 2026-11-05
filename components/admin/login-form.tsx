"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { Turnstile } from "@/components/turnstile";

const field = "w-full min-h-[48px] rounded-lg border border-line bg-surface-2 px-3 py-2 text-base text-text";
const turnstileKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export function LoginForm() {
  const reason = useSearchParams().get("reason");
  const [step, setStep] = useState<"password" | "totp">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [tsReset, setTsReset] = useState(0);
  const onToken = useCallback((t: string | null) => setToken(t), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || (turnstileKey && !token)) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, totp: step === "totp" ? totp : undefined, turnstileToken: token ?? undefined }),
      });
      const out = await res.json();
      if (out.ok) {
        // Deliberate hard navigation: picks up/drops the session cookie and discards any cached authenticated pages.
        window.location.href = out.recoveryCodeUsed ? `/admin/account?recovery=${Number(out.recoveryCodesLeft) || 0}` : "/admin";
        return;
      }
      if (out.code === "TOTP_REQUIRED") setStep("totp");
      else setError(out.message ?? "Something went wrong. Please try again.");
    } catch {
      setError("We couldn’t reach the server. Check your connection and try again.");
    }
    setToken(null);
    setTsReset((n) => n + 1); // Turnstile tokens are single-use
    setBusy(false);
  }

  const notice =
    reason === "idle_timeout" ? "You were signed out after a period of inactivity." : reason === "expired" || reason === "disabled" ? "Your session ended. Please sign in again." : "";

  return (
    <form onSubmit={submit} className="space-y-4">
      {notice && <p role="status" className="rounded-lg border border-line bg-surface p-3">{notice}</p>}
      {step === "password" ? (
        <>
          <div>
            <label htmlFor="email" className="font-bold">Email</label>
            <input id="email" name="email" type="email" inputMode="email" autoComplete="username" className={field} value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="password" className="font-bold">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" className={field} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
        </>
      ) : (
        <div>
          <label htmlFor="totp" className="font-bold">Code from your authenticator app</label>
          <p id="totp-hint" className="text-sm text-muted">The 6 digits, or one of your recovery codes if you lost your phone.</p>
          <input id="totp" name="totp" inputMode="text" aria-describedby="totp-hint" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={14} autoComplete="one-time-code" autoFocus className={`${field} tracking-widest`} value={totp} onChange={(e) => setTotp(e.target.value.replace(/[^A-Za-z0-9 -]/g, ""))} required />
        </div>
      )}
      {turnstileKey && <Turnstile siteKey={turnstileKey} onToken={onToken} resetKey={tsReset} />}
      {error && <p role="alert" className="rounded-lg border border-red-400 p-3 text-red-400">{error}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={busy || (!!turnstileKey && !token)}>
        {busy ? "Signing in…" : step === "totp" ? "Verify and sign in" : "Sign in"}
      </button>
      {step === "password" && <p className="text-center text-sm"><Link href="/admin/forgot" className="underline">Forgot your password?</Link></p>}
    </form>
  );
}
