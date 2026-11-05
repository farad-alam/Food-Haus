"use client";

import Link from "next/link";
import { useState } from "react";
import { api, failMessage, field, Msg } from "./ui";

// Shared by the first-time setup page and the signed-in account page.

export function RecoveryCodes({ codes }: { codes: string[] }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="space-y-3" data-testid="recovery-codes">
      <p className="rounded-lg border border-line bg-surface p-3">
        <strong>Save these recovery codes now.</strong> Each one works once if you lose your phone. They are shown only this one time and we cannot show them again.
      </p>
      <ul className="grid grid-cols-2 gap-2 font-mono text-lg tracking-wider" aria-label="Recovery codes">
        {codes.map((c) => <li key={c} className="rounded border border-line bg-surface-2 px-2 py-1 text-center">{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2 print:hidden">
        <button type="button" className="btn btn-ghost" onClick={copy}>{copied ? "Copied" : "Copy codes"}</button>
        <button type="button" className="btn btn-ghost" onClick={() => window.print()}>Print</button>
      </div>
      <label className="flex min-h-[44px] items-center gap-2 print:hidden">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="h-5 w-5" />
        I have saved these codes somewhere safe
      </label>
      {saved ? <p className="print:hidden"><Link href="/admin" className="btn btn-primary">Continue</Link></p> : null}
    </div>
  );
}

function QrStep({ qr, secret, onCode, busy, error }: { qr: string; secret: string; onCode: (code: string) => void; busy: boolean; error: string }) {
  const [code, setCode] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onCode(code); }} className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5">
        <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).</li>
        <li>Scan this QR code, or type the key below into the app.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URI, not an optimisable image */}
      <img src={qr} alt="QR code for your authenticator app" width={220} height={220} className="rounded-lg bg-white p-2" />
      <p className="text-sm text-muted">Can’t scan? Type this key: <code className="select-all break-words font-mono text-text" data-testid="manual-key">{secret}</code></p>
      <div>
        <label htmlFor="code" className="font-bold">6-digit code</label>
        <input id="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" className={`${field} w-full tracking-widest`} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required />
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-400 p-3 text-red-400">{error}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={busy || code.length !== 6}>Turn on two-step login</button>
    </form>
  );
}

/** /admin/setup/[token]: first-time setup with the one-time link AND the account password. */
export function SetupFlow({ token }: { token: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [qr, setQr] = useState<{ qr: string; secret: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function begin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const o = await api("POST", "/api/admin/2fa/setup/begin", { token, email, password });
    if (o.ok) setQr({ qr: o.data.qr as string, secret: o.data.secret as string });
    else setError(failMessage(o));
    setBusy(false);
  }
  async function confirm(code: string) {
    setBusy(true);
    setError("");
    const o = await api("POST", "/api/admin/2fa/setup/confirm", { token, email, password, code });
    if (o.ok) setCodes(o.data.recoveryCodes as string[]);
    else {
      setError(failMessage(o));
      if (o.data.code === "NO_PENDING" || o.data.code === "LINK_USED" || o.data.code === "INVALID" || o.data.code === "LOCKED") setQr(null);
    }
    setBusy(false);
  }

  if (codes) {
    return (
      <div className="space-y-3">
        <p role="status" className="font-bold text-green-400">Two-step login is on.</p>
        <RecoveryCodes codes={codes} />
        <p className="text-sm text-muted print:hidden">You will now be asked for a code each time you sign in.</p>
      </div>
    );
  }
  if (qr) return <QrStep qr={qr.qr} secret={qr.secret} onCode={confirm} busy={busy} error={error} />;
  return (
    <form onSubmit={begin} className="space-y-4">
      <p>To keep the shop safe, owners and managers sign in with a code from a phone app as well as a password. Confirm who you are to set it up.</p>
      <div>
        <label htmlFor="email" className="font-bold">Email</label>
        <input id="email" type="email" inputMode="email" autoComplete="username" className={`${field} w-full`} value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div>
        <label htmlFor="password" className="font-bold">Password</label>
        <input id="password" type="password" autoComplete="current-password" className={`${field} w-full`} value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-400 p-3 text-red-400">{error}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={busy}>Continue</button>
    </form>
  );
}

/** /admin/account: change authenticator or get new recovery codes (password + current code). */
export function AccountSecurity({ enrolled, recoveryLeft, applicable, usedRecovery }: { enrolled: boolean; recoveryLeft: number; applicable: boolean; usedRecovery: number | null }) {
  const [mode, setMode] = useState<null | "change" | "codes">(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [qr, setQr] = useState<{ qr: string; secret: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!applicable) return <p>Kitchen accounts sign in with a password only, so there is nothing to set up here.</p>;
  if (codes) return <RecoveryCodes codes={codes} />;
  if (qr) {
    return (
      <QrStep
        qr={qr.qr}
        secret={qr.secret}
        busy={busy}
        error={error}
        onCode={async (c) => {
          setBusy(true);
          setError("");
          const o = await api("POST", "/api/admin/2fa/confirm", { code: c });
          if (o.ok) setCodes(o.data.recoveryCodes as string[]);
          else {
            setError(failMessage(o));
            if (o.data.code === "NO_PENDING") setQr(null);
          }
          setBusy(false);
        }}
      />
    );
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const o = await api("POST", mode === "change" ? "/api/admin/2fa/begin" : "/api/admin/2fa/recovery-codes", { password, code });
    if (o.ok) {
      if (mode === "change") setQr({ qr: o.data.qr as string, secret: o.data.secret as string });
      else setCodes(o.data.recoveryCodes as string[]);
      setPassword("");
      setCode("");
    } else setError(failMessage(o));
    setBusy(false);
  }
  return (
    <div className="space-y-4">
      {usedRecovery !== null && (
        <p role="status" className="rounded-lg border border-line bg-surface p-3">
          You signed in with a recovery code. You have <strong>{usedRecovery}</strong> left. {usedRecovery <= 3 ? "Make a new set below soon." : ""}
        </p>
      )}
      <p>Two-step login: <strong data-testid="twofa-state">{enrolled ? "on" : "not set up"}</strong>. Recovery codes left: <strong>{recoveryLeft}</strong>.</p>
      {!mode ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => setMode("change")}>Change my authenticator app</button>
          <button type="button" className="btn btn-ghost" onClick={() => setMode("codes")}>Make new recovery codes</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-muted">
            {mode === "change" ? "Changing your authenticator signs you out of your other devices." : "New codes replace all your old ones straight away."} Confirm it is you first.
          </p>
          <div>
            <label htmlFor="pw" className="font-bold">Password</label>
            <input id="pw" type="password" autoComplete="current-password" className={`${field} w-full`} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="cur" className="font-bold">Current code (or a recovery code)</label>
            <input id="cur" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} maxLength={14} className={`${field} w-full tracking-widest`} value={code} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9 -]/g, ""))} required />
          </div>
          <Msg text={error} />
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary" disabled={busy}>Continue</button>
            <button type="button" className="btn btn-ghost" onClick={() => { setMode(null); setError(""); }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
