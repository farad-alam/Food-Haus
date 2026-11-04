import { quoteSchema } from "@/lib/checkout-schema";
import { getDb } from "@/lib/db/client";
import { quoteOrder } from "@/lib/quote-service";

// POST /api/quote: price preview for the checkout form. Read-only, no personal data.
const MAX_BODY_BYTES = 8_000;
const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json(415, { ok: false, code: "BAD_CONTENT_TYPE", message: "Send JSON." });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { ok: false, code: "TOO_LARGE", message: "Request too large." });
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, code: "BAD_JSON", message: "Invalid JSON." });
  }
  const parsed = quoteSchema.safeParse(data);
  if (!parsed.success) return json(400, { ok: false, code: "VALIDATION", message: "Invalid request." });

  try {
    const out = await quoteOrder(
      {
        db: getDb(),
        now: new Date(),
        clientIp: request.headers.get("cf-connecting-ip"), // only Cloudflare's header is trusted
        ipHashKey: process.env.SECRET_BOX_KEY,
      },
      parsed.data,
    );
    return json(out.status, out.body);
  } catch (e) {
    console.error("quote failed", e instanceof Error ? e.message : e);
    return json(500, { ok: false, code: "SERVER_ERROR", message: "Something went wrong." });
  }
}
