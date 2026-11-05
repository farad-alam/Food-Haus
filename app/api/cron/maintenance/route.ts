import { getDb } from "@/lib/db/client";
import { emailSenderFromEnv } from "@/lib/email";
import { runMaintenance } from "@/lib/maintenance";
import { runDailyReports } from "@/lib/sales-report-job";

// POST /api/cron/maintenance: called by the Cloudflare Cron Trigger, never by a
// browser. Protected by a shared secret (CRON_SECRET) sent as a Bearer token and
// compared in constant time. With no secret configured the endpoint refuses
// everything, so it can never be left open by accident.

const enc = new TextEncoder();
const noStore = { "Cache-Control": "no-store" };

async function sameSecret(a: string, b: string): Promise<boolean> {
  // Hash both sides first so the comparison always sees equal-length inputs.
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const [ax, by] = [new Uint8Array(x), new Uint8Array(y)];
  let diff = 0;
  for (let i = 0; i < ax.length; i++) diff |= ax[i] ^ by[i];
  return diff === 0;
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return Response.json({ ok: false, code: "NOT_CONFIGURED" }, { status: 503, headers: noStore });

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !(await sameSecret(token, secret))) return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401, headers: noStore });

  try {
    const db = getDb();
    const now = new Date();
    const maintenance = await runMaintenance(db, now);
    // The daily sales email (R9.12) goes out from the same 5-minute cron once a trading day is over.
    const dailyReports = await runDailyReports({ db, sender: emailSenderFromEnv(), now });
    const result = { ...maintenance, ok: maintenance.ok && dailyReports.ok, errors: [...maintenance.errors, ...dailyReports.errors], dailyReports: dailyReports.reports };
    if (!result.ok) console.error("maintenance step failed", result.errors.join("; ")); // no customer data in these messages
    return Response.json(result, { status: result.ok ? 200 : 500, headers: noStore });
  } catch (e) {
    console.error("maintenance failed", e instanceof Error ? e.message : e);
    return Response.json({ ok: false, code: "SERVER_ERROR" }, { status: 500, headers: noStore });
  }
}
