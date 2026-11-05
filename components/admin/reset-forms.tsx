"use client";

import Link from "next/link";
import { useState } from "react";

const field = "w-full min-h-[48px] rounded-lg border border-line bg-surface-2 px-3 py-2 text-base text-text";

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/admin/password-reset/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const out = await res.json();
      setMsg(out.message ?? "Something went wrong. Please try again.");
    } catch {
      setMsg("We couldn’t reach the server. Please try again.");
    }
    setBusy(false);
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="email" className="font-bold">Email</label>
        <input id="email" type="email" inputMode="email" autoComplete="username" className={field} value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      {msg && <p role="status" className="rounded-lg border border-line bg-surface p-3">{msg}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={busy}>Email me a reset link</button>
      <p className="text-center text-sm"><Link href="/admin/login" className="underline">Back to sign in</Link></p>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/password-reset/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password: pw }) });
      const out = await res.json();
      if (out.ok) setDone(true);
      else setError(out.message ?? "Something went wrong. Please try again.");
    } catch {
      setError("We couldn’t reach the server. Please try again.");
    }
    setBusy(false);
  }
  if (done) {
    return (
      <p role="status">
        Your password has been changed and you have been signed out everywhere. <Link href="/admin/login" className="underline">Sign in</Link>
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="pw" className="font-bold">New password</label>
        <input id="pw" type="password" autoComplete="new-password" className={field} value={pw} onChange={(e) => setPw(e.target.value)} required minLength={12} />
        <p className="mt-1 text-sm text-muted">At least 12 characters.</p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-400 p-3 text-red-400">{error}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={busy}>Set new password</button>
    </form>
  );
}
