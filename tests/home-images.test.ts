import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HOME_DEFAULTS } from "@/components/home-photos";
import { parseHomeImages } from "@/lib/home-images";

const ID = "food-haus/menu/0123456789abcdef";

describe("home page images: what is stored is never trusted", () => {
  it("empty, junk or missing storage means no images (the page shows its drawn art)", () => {
    for (const junk of [{}, null, undefined, "x", 7, []]) expect(parseHomeImages(junk)).toEqual({ hero: null, banner: null, categories: {} });
  });
  it("keeps only a well-formed hero id, with a tidied description", () => {
    expect(parseHomeImages({ hero: ID, heroAlt: "  A  stacked   burger " })).toEqual({ hero: { key: ID, alt: "A stacked burger" }, banner: null, categories: {} });
    expect(parseHomeImages({ hero: ID })).toEqual({ hero: { key: ID, alt: "" }, banner: null, categories: {} });
    for (const bad of ["", "https://evil.example/x.jpg", "menu/0123456789abcdef", "food-haus/menu/XYZ", 7]) {
      expect(parseHomeImages({ hero: bad, heroAlt: "x" }).hero).toBeNull();
    }
    expect(parseHomeImages({ hero: ID, heroAlt: "y".repeat(500) }).hero!.alt).toHaveLength(200);
  });
  it("keeps only category entries whose slug and id are both well-formed", () => {
    const r = parseHomeImages({ categories: { burgers: ID, "loaded-fries": ID, "BAD SLUG": ID, wings: "junk", "../x": ID } });
    expect(Object.keys(r.categories).sort()).toEqual(["burgers", "loaded-fries"]);
  });
});

describe("the built-in home photos really exist", () => {
  const all = [HOME_DEFAULTS.hero, HOME_DEFAULTS.banner, ...Object.values(HOME_DEFAULTS.categories)];
  it("every width of every default, in AVIF and WebP, is a file in public/", () => {
    for (const img of all) {
      for (const w of img.widths) {
        for (const ext of ["avif", "webp"] as const) {
          const file = join("public", `${img.base}-${w}.${ext}`);
          expect([file, existsSync(file)]).toEqual([file, true]);
        }
      }
    }
  });
  it("the six seeded categories each have a built-in tile photo", () => {
    expect(Object.keys(HOME_DEFAULTS.categories).sort()).toEqual(["burgers", "loaded-fries", "sides", "tenders", "wings", "wraps"]);
  });
  it("a banner id is kept and junk is dropped", () => {
    const ID = "food-haus/menu/0123456789abcdef";
    expect(parseHomeImages({ banner: ID }).banner).toBe(ID);
    expect(parseHomeImages({ banner: "https://evil.example/x" }).banner).toBeNull();
  });
});
