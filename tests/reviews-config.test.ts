import { describe, expect, it } from "vitest";
import { chooseWriteReviewUrl, reviewsSourceFromEnv, writeReviewUrlFor } from "@/lib/reviews";

const KEY = "AIzaSy" + "A".repeat(33); // the shape of a Google API key
const PLACE = "ChIJ" + "x".repeat(23);

describe("reviews configuration", () => {
  it("is 'none' until BOTH a valid key and a valid Place ID are set", () => {
    expect(reviewsSourceFromEnv({})).toEqual({ kind: "none" });
    expect(reviewsSourceFromEnv({ NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: KEY })).toEqual({ kind: "none" });
    expect(reviewsSourceFromEnv({ NEXT_PUBLIC_GOOGLE_PLACE_ID: PLACE })).toEqual({ kind: "none" });
    expect(reviewsSourceFromEnv({ NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "", NEXT_PUBLIC_GOOGLE_PLACE_ID: "" })).toEqual({ kind: "none" });
  });
  it("rejects malformed values instead of building a broken block", () => {
    for (const bad of ["not-a-key", "AIza", "BIzaSy" + "A".repeat(33), `${KEY} `.replace(/./g, "x"), "AIzaSy" + "A".repeat(33) + '"><script>']) {
      if (bad === KEY) continue;
      expect([bad, reviewsSourceFromEnv({ NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: bad, NEXT_PUBLIC_GOOGLE_PLACE_ID: PLACE }).kind]).toEqual([bad, "none"]);
    }
    for (const bad of ["short", "has space " + "x".repeat(20), 'ChIJ"><img src=x>' + "x".repeat(10), "x".repeat(201)]) {
      expect([bad, reviewsSourceFromEnv({ NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: KEY, NEXT_PUBLIC_GOOGLE_PLACE_ID: bad }).kind]).toEqual([bad, "none"]);
    }
  });
  it("accepts a valid pair, trimming whitespace, and builds the standard write-a-review link", () => {
    const s = reviewsSourceFromEnv({ NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: ` ${KEY} `, NEXT_PUBLIC_GOOGLE_PLACE_ID: ` ${PLACE}\n` });
    expect(s).toEqual({ kind: "places-ui-kit", apiKey: KEY, placeId: PLACE, writeReviewUrl: `https://search.google.com/local/writereview?placeid=${PLACE}` });
  });
  it("uses the SEO lead's review link only if it is a safe https Google link", () => {
    expect(chooseWriteReviewUrl("https://g.page/r/ABC123/review", PLACE)).toBe("https://g.page/r/ABC123/review");
    expect(chooseWriteReviewUrl("https://search.google.com/local/writereview?placeid=X", PLACE)).toContain("search.google.com");
    for (const bad of ["http://g.page/r/ABC/review", "https://evil.example/review", "javascript:alert(1)", "https://g.page.evil.example/x", "https://evil.example/?u=https://g.page", "not a url", ""]) {
      expect([bad, chooseWriteReviewUrl(bad, PLACE)]).toEqual([bad, writeReviewUrlFor(PLACE)]);
    }
    expect(chooseWriteReviewUrl(undefined, PLACE)).toBe(writeReviewUrlFor(PLACE));
  });
  it("encodes the place id in the standard link", () => {
    expect(writeReviewUrlFor("a b&c")).toBe("https://search.google.com/local/writereview?placeid=a%20b%26c");
  });
});
