"use client";

// Small shared pieces for the admin screens.

export const field = "min-h-[48px] rounded-lg border border-line bg-surface-2 px-3 py-2 text-base text-text";

export type Out = { ok: boolean; status: number; data: { ok?: boolean; message?: string; [k: string]: unknown } };
export async function api(method: string, url: string, body?: unknown): Promise<Out> {
  try {
    const res = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok !== false, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { message: "No connection. That change was not saved." } };
  }
}
export const failMessage = (o: Out) => (o.status === 401 ? "You have been signed out. Sign in again." : (o.data.message as string) || "That did not work. Please try again.");

export function Msg({ text, good }: { text: string; good?: boolean }) {
  return text ? <p role={good ? "status" : "alert"} className={`mt-2 text-sm ${good ? "text-green-400" : "text-red-400"}`}>{text}</p> : null;
}


export function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="font-display text-3xl">{title}</h2>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

