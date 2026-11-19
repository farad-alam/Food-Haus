import type { ReactNode } from "react";
import type { PortableBlock } from "@/lib/sanity";

// Renders Sanity "portable text" as plain, safe HTML. Everything is drawn through React (so text is escaped),
// links are limited to https, http and mailto, and images only from Sanity's own host. Unknown block types are skipped.

type Span = { _type?: string; text?: string; marks?: string[] };
type MarkDef = { _key?: string; _type?: string; href?: string };

const safeHref = (h: unknown) => (typeof h === "string" && /^(https?:\/\/|mailto:)/i.test(h) ? h : null);

function spans(block: PortableBlock): ReactNode[] {
  const defs = (block.markDefs as MarkDef[] | undefined) ?? [];
  return ((block.children as Span[] | undefined) ?? []).map((s, i) => {
    let node: ReactNode = s.text ?? "";
    for (const m of s.marks ?? []) {
      if (m === "strong") node = <strong>{node}</strong>;
      else if (m === "em") node = <em>{node}</em>;
      else if (m === "code") node = <code className="rounded bg-surface-2 px-1">{node}</code>;
      else {
        const d = defs.find((x) => x._key === m && x._type === "link");
        const href = safeHref(d?.href);
        if (href) node = <a href={href} rel="noopener noreferrer" className="underline">{node}</a>;
      }
    }
    return <span key={i}>{node}</span>;
  });
}

export function PortableText({ value }: { value: PortableBlock[] }) {
  const out: ReactNode[] = [];
  let list: { kind: "bullet" | "number"; items: ReactNode[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.kind === "number" ? "ol" : "ul";
    out.push(<Tag key={`l${out.length}`} className={`${list.kind === "number" ? "list-decimal" : "list-disc"} space-y-1 pl-6`}>{list.items}</Tag>);
    list = null;
  };
  value.forEach((b, i) => {
    if (b._type === "block") {
      const kind = b.listItem === "number" ? "number" : b.listItem === "bullet" ? "bullet" : null;
      if (kind) {
        if (list && list.kind !== kind) flush();
        list ??= { kind, items: [] };
        list.items.push(<li key={i}>{spans(b)}</li>);
        return;
      }
      flush();
      const style = typeof b.style === "string" ? b.style : "normal";
      if (style === "h2") out.push(<h2 key={i} className="mt-6 font-display text-3xl">{spans(b)}</h2>);
      else if (style === "h3") out.push(<h3 key={i} className="mt-4 font-display text-2xl">{spans(b)}</h3>);
      else if (style === "h4") out.push(<h4 key={i} className="mt-3 text-lg font-bold">{spans(b)}</h4>);
      else if (style === "blockquote") out.push(<blockquote key={i} className="border-l-4 border-brand pl-4 text-muted">{spans(b)}</blockquote>);
      else out.push(<p key={i}>{spans(b)}</p>);
    } else if (b._type === "image" && typeof b.url === "string" && b.url.startsWith("https://cdn.sanity.io/")) {
      flush();
      // eslint-disable-next-line @next/next/no-img-element -- Sanity's own CDN image inside an article
      out.push(<img key={i} src={b.url} alt={typeof b.alt === "string" ? b.alt : ""} loading="lazy" decoding="async" className="h-auto w-full rounded-xl" />);
    }
  });
  flush();
  return <div className="space-y-4 text-lg">{out}</div>;
}
