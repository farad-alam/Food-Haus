import Link from "next/link";
import { type Block, type Cell, isPh, LEGAL_APPROVED, type LegalDoc, type Ph, placeholdersIn } from "@/lib/legal";

// Renders a policy from lib/legal.ts. Anything undecided is drawn as an obvious amber box.

function PlaceholderBox({ p, inline }: { p: Ph; inline?: boolean }) {
  const Tag = inline ? "span" : "div";
  return (
    <Tag data-placeholder="" className={`border border-dashed border-amber-400 bg-amber-400/10 px-2 py-1 text-amber-300 ${inline ? "inline-block rounded" : "rounded-lg p-3"}`}>
      <strong>PLACEHOLDER, to be decided: </strong>
      {p.ph}
      {p.hint && <span className="block text-sm text-amber-200/80">{p.hint}</span>}
    </Tag>
  );
}

const Cell_ = ({ c }: { c: Cell }) => (isPh(c) ? <PlaceholderBox p={c} inline /> : <>{c}</>);

function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case "p":
      return <p>{(Array.isArray(b.text) ? b.text : [b.text]).map((c, i) => <span key={i}><Cell_ c={c} /> </span>)}</p>;
    case "ul":
      return <ul className="list-disc space-y-1 pl-6">{b.items.map((c, i) => <li key={i}><Cell_ c={c} /></li>)}</ul>;
    case "ph":
      return <PlaceholderBox p={b} />;
    case "table":
      return (
        // On a phone each row becomes a small card (the column title above each value) instead of a sideways-scrolling table.
        <table className="w-full border-collapse text-left text-sm max-sm:block">
          <thead className="max-sm:sr-only">
            <tr>{b.head.map((h) => <th key={h} scope="col" className="border-b border-line p-2 font-bold">{h}</th>)}</tr>
          </thead>
          <tbody className="max-sm:block">
            {b.rows.map((r, i) => (
              <tr key={i} className="align-top max-sm:mb-3 max-sm:block max-sm:rounded-lg max-sm:border max-sm:border-line max-sm:p-2">
                {r.map((c, j) => {
                  const cls = "border-b border-line p-2 max-sm:block max-sm:border-0 max-sm:px-1 max-sm:py-1 max-sm:before:block max-sm:before:text-xs max-sm:before:font-bold max-sm:before:text-muted max-sm:before:content-[attr(data-label)]";
                  return j === 0 ? <th key={j} scope="row" data-label={b.head[j]} className={`${cls} font-normal`}><Cell_ c={c} /></th> : <td key={j} data-label={b.head[j]} className={cls}><Cell_ c={c} /></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}

export function LegalPage({ doc, children, beforeSections, extraNotice }: { doc: LegalDoc; children?: React.ReactNode; beforeSections?: React.ReactNode; extraNotice?: React.ReactNode }) {
  const open = placeholdersIn(doc).length;
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <h1 className="font-display text-5xl">{doc.title}</h1>
      {!LEGAL_APPROVED && (
        <p role="note" data-testid="draft-notice" className="rounded-lg border border-amber-400 bg-amber-400/10 p-3 text-amber-300">
          <strong>DRAFT, not approved.</strong> The owner has not yet approved this page (R11.12), so it must not be relied on. {open} item{open === 1 ? " is" : "s are"} still to be decided; they are marked in amber boxes.
        </p>
      )}
      {extraNotice}
      <div className="space-y-3">{doc.intro.map((b, i) => <BlockView key={i} b={b} />)}</div>
      {beforeSections}
      {doc.sections.map((s) => (
        <section key={s.id} aria-labelledby={`${s.id}-h`} className="space-y-3">
          <h2 id={`${s.id}-h`} className="font-display text-3xl">{s.title}</h2>
          {s.blocks.map((b, i) => <BlockView key={i} b={b} />)}
          {s.id === "change" && children}
          {doc.slug === "privacy" && s.id === "cookies" && <p><Link href="/cookies" className="underline">Read the Cookie Policy</Link></p>}
        </section>
      ))}
      {doc.slug === "cookies" && <p><Link href="/privacy" className="underline">Read the Privacy Policy</Link></p>}
      {doc.slug === "allergens" && <p><Link href="/menu" className="underline">Back to the menu</Link></p>}
      {doc.slug === "terms" && (
        <p className="space-x-4">
          <Link href="/allergens" className="underline">Allergen information</Link>
          <Link href="/privacy" className="underline">Privacy Policy</Link>
        </p>
      )}
    </main>
  );
}
