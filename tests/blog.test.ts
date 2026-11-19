import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PortableText } from "@/components/portable-text";
import { clearLocalCache } from "@/lib/local-cache";
import { getPost, listPosts, parsePost, parseSummary, sanityConfigFromEnv } from "@/lib/sanity";

describe("Sanity configuration", () => {
  it("is off until a valid project id is set; the dataset defaults to production", () => {
    expect(sanityConfigFromEnv({})).toBeNull();
    for (const bad of ["", "ab", "UPPERCASE1", "has space1", "x".repeat(20), "a;b=1"]) expect([bad, sanityConfigFromEnv({ NEXT_PUBLIC_SANITY_PROJECT_ID: bad })]).toEqual([bad, null]);
    expect(sanityConfigFromEnv({ NEXT_PUBLIC_SANITY_PROJECT_ID: "abc12345" })).toEqual({ projectId: "abc12345", dataset: "production", host: "https://abc12345.apicdn.sanity.io" });
    expect(sanityConfigFromEnv({ NEXT_PUBLIC_SANITY_PROJECT_ID: "abc12345", NEXT_PUBLIC_SANITY_DATASET: "staging" })?.dataset).toBe("staging");
    expect(sanityConfigFromEnv({ NEXT_PUBLIC_SANITY_PROJECT_ID: "abc12345", NEXT_PUBLIC_SANITY_DATASET: "bad/dataset" })).toBeNull();
  });
  it("the host override only accepts Sanity or this machine", () => {
    const base = { NEXT_PUBLIC_SANITY_PROJECT_ID: "abc12345" };
    expect(sanityConfigFromEnv({ ...base, SANITY_API_HOST: "http://127.0.0.1:9100" })?.host).toBe("http://127.0.0.1:9100");
    for (const evil of ["https://evil.example", "http://localhost:9", "https://x.sanity.io.evil.com", "javascript:1"]) expect(sanityConfigFromEnv({ ...base, SANITY_API_HOST: evil })?.host).toBe("https://abc12345.apicdn.sanity.io");
  });
});

describe("reading posts safely", () => {
  it("keeps only well-formed posts, safe slugs and Sanity-hosted images", () => {
    expect(parseSummary({ title: "Hi", slug: "hi-there", excerpt: "x", publishedAt: "2026-11-01T10:00:00Z", image: { url: "https://cdn.sanity.io/images/p/d/a.jpg", alt: "A" } })).toMatchObject({ slug: "hi-there", image: { alt: "A" } });
    expect(parseSummary({ title: "Hi", slug: "hi", image: { url: "https://evil.example/a.jpg", alt: "A" } })?.image).toBeNull();
    for (const bad of [null, {}, { title: "x" }, { title: "", slug: "a" }, { title: "x", slug: "../etc" }, { title: "x", slug: "A B" }, { title: "x", slug: "a".repeat(120) }]) expect(parseSummary(bad)).toBeNull();
    expect(parsePost({ title: "T", slug: "t", body: [{ _type: "block" }, 5, null] })?.body).toHaveLength(1);
    expect(parsePost({ title: "T", slug: "t", publishedAt: "not a date" })?.publishedAt).toBeNull();
  });
});

describe("fetching", () => {
  const cfg = { projectId: "abc12345", dataset: "production", host: "https://abc12345.apicdn.sanity.io" };
  beforeEach(() => clearLocalCache());
  afterEach(() => vi.unstubAllGlobals());
  const stub = (body: unknown, ok = true) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => body })));

  it("asks for published posts only, and passes the slug as a JSON parameter, never inside the query text", async () => {
    stub({ result: { title: "T", slug: "t", body: [] } });
    await getPost(cfg, "t");
    const url = new URL((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(url.origin).toBe(cfg.host);
    expect(url.pathname).toBe("/v2025-01-01/data/query/production");
    expect(url.searchParams.get("perspective")).toBe("published");
    expect(url.searchParams.get("$slug")).toBe('"t"');
    expect(url.searchParams.get("query")).not.toContain('"t"');
  });
  it("a malformed slug never reaches Sanity", async () => {
    stub({ result: null });
    expect(await getPost(cfg, "../x")).toBeNull();
    expect(await getPost(cfg, 'a"]|{x')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("lists posts; an unreachable Sanity is an error for the caller to handle, and a bad answer is an empty list", async () => {
    stub({ result: [{ title: "A", slug: "a" }, { nonsense: true }] });
    expect((await listPosts(cfg)).map((p) => p.slug)).toEqual(["a"]);
    clearLocalCache();
    stub({}, false);
    await expect(listPosts(cfg)).rejects.toThrow(/503/);
    clearLocalCache();
    stub({ result: "oops" });
    expect(await listPosts(cfg)).toEqual([]);
  });
});

describe("portable text", () => {
  const html = (v: Record<string, unknown>[]) => renderToStaticMarkup(createElement(PortableText, { value: v }));
  it("renders paragraphs, headings, lists and marks, escaping all text", () => {
    const out = html([
      { _type: "block", style: "h2", children: [{ _type: "span", text: "Title <b>" }] },
      { _type: "block", children: [{ _type: "span", text: "Hello ", marks: [] }, { _type: "span", text: "bold", marks: ["strong"] }, { _type: "span", text: "<script>alert(1)</script>" }] },
      { _type: "block", listItem: "bullet", children: [{ _type: "span", text: "one" }] },
      { _type: "block", listItem: "bullet", children: [{ _type: "span", text: "two" }] },
    ]);
    expect(out).toContain("<h2");
    expect(out).toContain("Title &lt;b&gt;");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).not.toContain("<script>");
    expect((out.match(/<li>/g) ?? []).length).toBe(2);
    expect((out.match(/<ul/g) ?? []).length).toBe(1);
  });
  it("links only to https, http or mailto; images only from Sanity's own host", () => {
    const link = (href: string) => html([{ _type: "block", markDefs: [{ _key: "k", _type: "link", href }], children: [{ _type: "span", text: "go", marks: ["k"] }] }]);
    expect(link("https://example.com/x")).toContain('href="https://example.com/x"');
    expect(link("https://example.com/x")).toContain("noopener");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "vbscript:x"]) expect(link(bad)).not.toContain("href");
    expect(html([{ _type: "image", url: "https://cdn.sanity.io/images/p/d/a.jpg", alt: "pic" }])).toContain('src="https://cdn.sanity.io/images/p/d/a.jpg"');
    expect(html([{ _type: "image", url: "https://evil.example/a.jpg", alt: "pic" }])).not.toContain("<img");
  });
  it("skips unknown block types instead of failing", () => {
    expect(html([{ _type: "mystery", foo: 1 }, { _type: "block", children: [{ _type: "span", text: "ok" }] }])).toContain("ok");
  });
});
