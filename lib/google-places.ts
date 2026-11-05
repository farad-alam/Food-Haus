// Browser-only helpers for Google's Places UI Kit (R7 option 2). Google's own
// element draws the rating, the reviews and Google's required attribution; we
// only load Google's script and place the element. Nothing here reads, copies
// or stores review content (R7.3).
//
// Element and event names were checked against Google's own script bundles
// (gmp-place-details, gmp-place-details-place-request, gmp-place-rating,
// gmp-place-reviews, gmp-place-attribution; gmp-load and gmp-error events), and by
// running Google's real script in a browser. The Places UI Kit is marked experimental by Google, so if
// Google renames anything this fails CLOSED: the block quietly disappears.

type MapsWindow = Window & {
  google?: { maps?: { importLibrary?: (name: string) => Promise<unknown> } };
  gm_authFailure?: () => void;
  __fhGoogleMapsReady?: () => void;
};

export const SCRIPT_TIMEOUT_MS = 10_000;
export const ELEMENT_TIMEOUT_MS = 12_000;

let loading: Promise<void> | null = null;

/**
 * Loads Google's script once per page view. A failure is remembered, so a
 * visitor whose network blocks Google is not retried (each load can be billed).
 */
export function loadPlacesLibrary(apiKey: string, timeoutMs = SCRIPT_TIMEOUT_MS): Promise<void> {
  if (loading) return loading;
  const w = window as MapsWindow;
  loading = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Google script timed out")), timeoutMs);
    const fail = (why: string) => {
      clearTimeout(timer);
      reject(new Error(why));
    };
    w.gm_authFailure = () => fail("Google rejected the API key (check the website restriction)"); // Google calls this for a bad or restricted key
    w.__fhGoogleMapsReady = async () => {
      try {
        await w.google!.maps!.importLibrary!("places");
        await customElements.whenDefined("gmp-place-details");
        clearTimeout(timer);
        resolve();
      } catch (e) {
        fail(e instanceof Error ? e.message : "Places library failed to load");
      }
    };
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&v=weekly&callback=__fhGoogleMapsReady`;
    s.async = true;
    s.onerror = () => fail("Google script could not be loaded");
    document.head.appendChild(s);
  });
  return loading;
}

export type MountOptions = { placeId: string; variant: "full" | "badge"; onLoad: () => void; onError: () => void; timeoutMs?: number };

/**
 * Puts Google's place-details element into `host`. Returns a cleanup function.
 * `full` shows rating + reviews + attribution; `badge` shows rating + attribution.
 */
export function mountPlaceDetails(host: HTMLElement, o: MountOptions): () => void {
  const make = (tag: string) => document.createElement(tag);
  const details = make("gmp-place-details");
  const request = make("gmp-place-details-place-request");
  request.setAttribute("place", o.placeId);
  // Content elements are appended directly. Google's own console warning (seen when running its real
  // script) says <gmp-place-content-config> is deprecated: "append content elements or preset elements".
  details.append(request, make("gmp-place-rating"));
  if (o.variant === "full") details.append(make("gmp-place-reviews"));
  details.append(make("gmp-place-attribution")); // Google's own required attribution (R7.2)
  details.style.colorScheme = "dark"; // the site is dark; Google's element follows color-scheme

  let done = false;
  const finish = (fn: () => void) => () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    fn();
  };
  const loaded = finish(o.onLoad);
  const failed = finish(o.onError);
  details.addEventListener("gmp-load", loaded);
  details.addEventListener("gmp-error", failed);
  // If neither event arrives, keep the block only if the element visibly drew something.
  const timer = setTimeout(() => (details.getBoundingClientRect().height > 60 ? loaded() : failed()), o.timeoutMs ?? ELEMENT_TIMEOUT_MS);

  host.append(details);
  return () => {
    done = true;
    clearTimeout(timer);
    details.removeEventListener("gmp-load", loaded);
    details.removeEventListener("gmp-error", failed);
    details.remove();
  };
}
