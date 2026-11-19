import { cached } from "./local-cache";

// Blog content from Sanity (R5.9), read over Sanity's public query API. No Sanity library, no tokens: only
// PUBLISHED documents are read. Nothing here is written by us; when the variables are not set the blog does
// not exist (its pages return 404 and it is left out of the nav and sitemap).
//
// The owner's Sanity project needs documents of type `post` with: title (string), slug (slug), excerpt (text),
// publishedAt (datetime), seoDescription (string, optional), mainImage (image with alt, optional), body (portable text).

export type SanityConfig = { projectId: string; dataset: string; host: string };

const PROJECT_RE = /^[a-z0-9]{8,12}$/;
const DATASET_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const API_VERSION = "v2025-01-01";
const IMAGE_HOST = "https://cdn.sanity.io/";

type Env = Record<string, string | undefined>;

/** NEXT_PUBLIC_SANITY_PROJECT_ID (required) and NEXT_PUBLIC_SANITY_DATASET (default "production"). Anything malformed means "not configured". */
export function sanityConfigFromEnv(env: Env): SanityConfig | null {
  const projectId = env.NEXT_PUBLIC_SANITY_PROJECT_ID?.trim();
  const dataset = env.NEXT_PUBLIC_SANITY_DATASET?.trim() || "production";
  if (!projectId || !PROJECT_RE.test(projectId) || !DATASET_RE.test(dataset)) return null;
  // SANITY_API_HOST exists only so tests can point at a local stand-in; it must be a Sanity host or the local machine.
  const override = env.SANITY_API_HOST?.trim();
  const host = override && /^(https:\/\/[a-z0-9.-]+\.sanity\.io|http:\/\/127\.0\.0\.1:\d+)$/.test(override) ? override : `https://${projectId}.apicdn.sanity.io`;
  return { projectId, dataset, host };
}

// NEXT_PUBLIC_* values are inlined at build time, so each is referenced literally.
export const getSanityConfig = (): SanityConfig | null =>
  sanityConfigFromEnv({
    NEXT_PUBLIC_SANITY_PROJECT_ID: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
    NEXT_PUBLIC_SANITY_DATASET: process.env.NEXT_PUBLIC_SANITY_DATASET,
    SANITY_API_HOST: process.env.SANITY_API_HOST,
  });

export type PostSummary = { title: string; slug: string; excerpt: string; publishedAt: string | null; image: { url: string; alt: string } | null };
export type PortableBlock = Record<string, unknown>;
export type Post = PostSummary & { seoDescription: string | null; body: PortableBlock[] };

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const str = (v: unknown, max = 600): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const imageOf = (v: unknown): PostSummary["image"] => {
  const o = v as { url?: unknown; alt?: unknown } | null;
  const url = typeof o?.url === "string" && o.url.startsWith(IMAGE_HOST) ? o.url : null; // only Sanity's own image host
  return url ? { url, alt: str(o?.alt, 200) ?? "" } : null;
};
const dateOf = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

export function parseSummary(raw: unknown): PostSummary | null {
  const o = raw as Record<string, unknown> | null;
  const slug = typeof o?.slug === "string" && SLUG_RE.test(o.slug) && o.slug.length <= 100 ? o.slug : null;
  const title = str(o?.title, 200);
  if (!slug || !title) return null;
  return { title, slug, excerpt: str(o?.excerpt) ?? "", publishedAt: dateOf(o?.publishedAt), image: imageOf(o?.image) };
}

export function parsePost(raw: unknown): Post | null {
  const s = parseSummary(raw);
  if (!s) return null;
  const o = raw as Record<string, unknown>;
  return { ...s, seoDescription: str(o.seoDescription, 300), body: Array.isArray(o.body) ? (o.body.filter((b) => typeof b === "object" && b !== null) as PortableBlock[]) : [] };
}

const SUMMARY = `title, "slug": slug.current, excerpt, publishedAt, "image": mainImage{alt, "url": asset->url}`;
const LIST_QUERY = `*[_type == "post" && defined(slug.current)] | order(publishedAt desc)[0...50]{${SUMMARY}}`;
const POST_QUERY = `*[_type == "post" && slug.current == $slug][0]{${SUMMARY}, seoDescription, "body": body[]{..., _type == "image" => {"_type": "image", "url": asset->url, alt}}}`;

async function query(cfg: SanityConfig, groq: string, params: Record<string, string> = {}): Promise<unknown> {
  const qs = new URLSearchParams({ query: groq, perspective: "published" });
  for (const [k, v] of Object.entries(params)) qs.set(`$${k}`, JSON.stringify(v));
  const res = await fetch(`${cfg.host}/${API_VERSION}/data/query/${cfg.dataset}?${qs}`, { signal: AbortSignal.timeout(5_000), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Sanity answered ${res.status}`);
  return ((await res.json()) as { result?: unknown }).result;
}

/** Published posts, newest first (cached 5 minutes per instance). Throws if Sanity cannot be reached. */
export async function listPosts(cfg: SanityConfig): Promise<PostSummary[]> {
  return cached(`blog:list:${cfg.projectId}:${cfg.dataset}`, async () => {
    const r = await query(cfg, LIST_QUERY);
    return Array.isArray(r) ? r.map(parseSummary).filter((p): p is PostSummary => p !== null) : [];
  }, 300_000);
}

/** One published post, or null when there is no such post. Throws if Sanity cannot be reached. */
export async function getPost(cfg: SanityConfig, slug: string): Promise<Post | null> {
  if (!SLUG_RE.test(slug) || slug.length > 100) return null;
  return cached(`blog:post:${cfg.projectId}:${cfg.dataset}:${slug}`, async () => parsePost(await query(cfg, POST_QUERY, { slug })), 300_000);
}
