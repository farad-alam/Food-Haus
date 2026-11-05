// Google reviews configuration (R7.5, R7.7). Everything the pages need to know
// about WHERE reviews come from lives here, behind one function, so changing the
// source later (e.g. the Business Profile API, option 3 in the requirements)
// changes this file and one component, and no page.
//
// R7.3: no review text, name, photo or rating is ever typed, copied or stored by
// us. With the Places UI Kit (option 2) Google's own element renders them in the
// visitor's browser, so this file holds only configuration.

export type ReviewsSource =
  | { kind: "none" }
  | { kind: "places-ui-kit"; apiKey: string; placeId: string; writeReviewUrl: string };

/** The data source for the site's reviews. Pages call this and nothing else. */
export type ReviewsProvider = () => ReviewsSource;

const API_KEY_RE = /^AIza[0-9A-Za-z_-]{30,50}$/;
const PLACE_ID_RE = /^[A-Za-z0-9_-]{20,200}$/;
// Hosts a "write a review" link may point at, so a typo in the environment cannot send customers elsewhere.
const REVIEW_HOSTS = ["search.google.com", "www.google.com", "google.com", "g.page", "maps.app.goo.gl", "goo.gl", "maps.google.com", "www.google.co.uk", "google.co.uk"];

/** Google's documented write-a-review link for a place. */
export function writeReviewUrlFor(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}

/** The SEO lead's own review link if it is a safe https Google link, otherwise the standard one (R7.6). */
export function chooseWriteReviewUrl(override: string | undefined, placeId: string): string {
  if (override) {
    try {
      const u = new URL(override);
      if (u.protocol === "https:" && REVIEW_HOSTS.includes(u.hostname)) return u.toString();
    } catch {
      /* fall through to the standard link */
    }
  }
  return writeReviewUrlFor(placeId);
}

type Env = Record<string, string | undefined>;

/**
 * Reads the configuration. Anything missing or malformed means NO reviews block
 * at all (not a broken one): the site simply does not show reviews until both a
 * valid key and a valid Place ID are set. The API key is public by design (it
 * ships to the browser), so it must be restricted by website address and by API
 * in the Google Cloud console (R7.5), not hidden.
 */
export function reviewsSourceFromEnv(env: Env): ReviewsSource {
  const apiKey = env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  const placeId = env.NEXT_PUBLIC_GOOGLE_PLACE_ID?.trim();
  if (!apiKey || !placeId || !API_KEY_RE.test(apiKey) || !PLACE_ID_RE.test(placeId)) return { kind: "none" };
  return { kind: "places-ui-kit", apiKey, placeId, writeReviewUrl: chooseWriteReviewUrl(env.NEXT_PUBLIC_GOOGLE_REVIEW_URL?.trim(), placeId) };
}

// NEXT_PUBLIC_* values are inlined at build time, so each is referenced literally.
export const getReviewsSource: ReviewsProvider = () =>
  reviewsSourceFromEnv({
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
    NEXT_PUBLIC_GOOGLE_PLACE_ID: process.env.NEXT_PUBLIC_GOOGLE_PLACE_ID,
    NEXT_PUBLIC_GOOGLE_REVIEW_URL: process.env.NEXT_PUBLIC_GOOGLE_REVIEW_URL,
  });
