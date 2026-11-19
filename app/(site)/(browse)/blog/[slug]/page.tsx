import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PortableText } from "@/components/portable-text";
import { getPost, getSanityConfig, SLUG_RE, type Post } from "@/lib/sanity";
import { pageMetadata } from "@/lib/seo";

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string): Promise<Post | null> {
  const cfg = getSanityConfig();
  if (!cfg || !SLUG_RE.test(slug)) return null;
  try {
    return await getPost(cfg, slug);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await load(slug);
  if (!post) return { title: "Not found", robots: { index: false, follow: false } };
  return pageMetadata({ title: post.title, description: post.seoDescription ?? (post.excerpt || `${post.title}: an article from Food Haus.`), path: `/blog/${slug}` });
}

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }).format(new Date(iso));

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const post = await load(slug); // 404 when Sanity is not set up, the slug is malformed, the post does not exist, or Sanity is unreachable
  if (!post) notFound();
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <p><Link href="/blog" className="text-sm underline">All articles</Link></p>
      <article className="space-y-4">
        <h1 className="font-display text-5xl">{post.title}</h1>
        {post.publishedAt && <p className="text-sm text-muted"><time dateTime={post.publishedAt}>{date(post.publishedAt)}</time></p>}
        {post.image && (
          // eslint-disable-next-line @next/next/no-img-element -- Sanity's own CDN image
          <img src={post.image.url} alt={post.image.alt} width={1200} height={630} decoding="async" fetchPriority="high" className="aspect-[1200/630] w-full rounded-xl object-cover" />
        )}
        <PortableText value={post.body} />
      </article>
    </main>
  );
}
