// Local area pages (/areas/[slug], R5.8, R11.6). One reusable template; a page exists ONLY for a postcode
// district that is an active delivery zone right now (so a district that stops being served disappears).
//
// The pages show facts (that district's fee, minimum order and estimated time, plus the shop's menu and hours).
// They have NO local copy of their own, and they stay out of the sitemap and `noindex` until the SEO lead adds
// genuinely local text for that district in AREA_COPY below: thin, templated pages are worse than none (R11.6).

export type AreaCopy = {
  /** Unique, local introduction (a few sentences). Written by the SEO lead; never generated here. */
  intro: string;
  /** Optional: a short list of real local landmarks or streets served. Only facts someone has checked. */
  places?: string[];
};

/** Add an entry per district slug (lower case, e.g. "lu4") when real local copy exists. Empty on purpose. */
export const AREA_COPY: Record<string, AreaCopy> = {};

const SLUG_RE = /^[a-z]{1,2}\d{1,2}[a-z]?$/;

export const areaSlug = (district: string) => district.trim().toLowerCase();
export const isAreaSlug = (s: string) => SLUG_RE.test(s);

/** Indexable (in the sitemap, no noindex) only once there is real local copy for the district. */
export const areaIsIndexable = (slug: string, copy: Record<string, AreaCopy> = AREA_COPY) => !!copy[slug]?.intro.trim();
