import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSanityConfig, listPosts, type PostSummary } from "@/lib/sanity";
import { pageMetadata } from "@/lib/seo";

// R5.9. Reads published articles from Sanity. With no Sanity variables set the blog does not exist: 404.
export function generateMetadata(): Metadata {
  return pageMetadata({ title: "Food Haus blog", description: "News and local stories from Food Haus, the halal takeaway in Luton.", path: "/blog", noindex: !getSanityConfig() });
}

const date = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }).format(new Date(iso)) : "");

export default async function BlogPage() {
  const cfg = getSanityConfig();
  if (!cfg) notFound();
  let posts: PostSummary[] | null = null;
  try {
    posts = await listPosts(cfg);
  } catch {
    posts = null; // Sanity unreachable: say so politely, never a raw error page (R13.9)
  }
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <h1 className="font-display text-5xl">Food Haus blog</h1>
      {posts === null && <p className="text-muted" role="status">Articles are not available right now. Please try again in a few minutes.</p>}
      {posts?.length === 0 && <p className="text-muted">There are no articles yet.</p>}
      <ul className="space-y-6">
        {posts?.map((p) => (
          <li key={p.slug} className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="font-display text-3xl"><Link href={`/blog/${p.slug}`} className="underline">{p.title}</Link></h2>
            {p.publishedAt && <p className="text-sm text-muted"><time dateTime={p.publishedAt}>{date(p.publishedAt)}</time></p>}
            {p.excerpt && <p className="mt-2">{p.excerpt}</p>}
          </li>
        ))}
      </ul>
    </main>
  );
}
