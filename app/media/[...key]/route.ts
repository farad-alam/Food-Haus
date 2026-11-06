import { isFileKey } from "@/lib/photos/keys";
import { getPhotoStore } from "@/lib/photos";

// GET /media/menu/<hash>-<width>.webp: public menu photos, read from the photo store.
// The key is checked against a strict pattern before it goes anywhere near storage. A file never
// changes under its name (the name contains a hash of its content), so it is cached for a year.
export async function GET(_request: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const key = (await ctx.params).key.join("/");
  if (!isFileKey(key)) return new Response("Not found", { status: 404 });
  try {
    const f = await (await getPhotoStore()).get(key);
    if (!f) return new Response("Not found", { status: 404 });
    return new Response(f.body as BodyInit, {
      headers: {
        "Content-Type": "image/webp", // always what we produced, whatever the store says
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    console.error("photo read failed", e instanceof Error ? e.message : e);
    return new Response("Unavailable", { status: 503 });
  }
}
