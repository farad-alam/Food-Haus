import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The About page may only say what the requirements and the shop's own data support.
describe("About page copy", () => {
  const src = readFileSync("app/(site)/(browse)/about/page.tsx", "utf8");
  const text = src.slice(src.indexOf("return ("));
  it("makes no claim about history, people, awards, sourcing, recipes or opening years", () => {
    for (const word of ["since", "founded", "family", "award", "best in", "locally sourced", "fresh daily", "secret", "chef", "years", "established", "grew up", "passion"]) {
      expect([word, new RegExp(`\\b${word}\\b`, "i").test(text)]).toEqual([word, false]);
    }
  });
  it("links the TikTok account from the shop's data and keeps to two body paragraphs", () => {
    expect(text).toContain("shop.tiktok");
    expect((text.match(/<p className="text-lg">/g) ?? []).length).toBe(2);
  });
  it("adds no photo (none supplied)", () => {
    expect(text).not.toMatch(/<img|next\/image/);
  });
});
