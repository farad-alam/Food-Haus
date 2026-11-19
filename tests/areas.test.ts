import { describe, expect, it } from "vitest";
import { areaIsIndexable, areaSlug, AREA_COPY, isAreaSlug } from "@/lib/areas";

describe("area pages", () => {
  it("slugs are lower-case districts and only real-looking districts are accepted", () => {
    expect(areaSlug(" LU4 ")).toBe("lu4");
    for (const ok of ["lu4", "lu1", "ls18", "e1", "w1a"]) expect([ok, isAreaSlug(ok)]).toEqual([ok, true]);
    for (const bad of ["", "LU4", "lu", "lu4/x", "../etc", "lu4 ", "lu444", "1lu", "lu4;drop", "x".repeat(60)]) expect([bad, isAreaSlug(bad)]).toEqual([bad, false]);
  });
  it("NO area is indexable until real local copy exists for it: the shipped copy list is empty", () => {
    expect(Object.keys(AREA_COPY)).toEqual([]);
    expect(areaIsIndexable("lu4")).toBe(false);
  });
  it("an entry with real copy makes exactly that district indexable; blank copy does not", () => {
    const copy = { lu4: { intro: "Real local text." }, lu3: { intro: "   " } };
    expect(areaIsIndexable("lu4", copy)).toBe(true);
    expect(areaIsIndexable("lu3", copy)).toBe(false);
    expect(areaIsIndexable("lu1", copy)).toBe(false);
  });
});
