import type { MetadataRoute } from "next";
import { readinessFromMenu } from "@/lib/allergen-readiness";
import { LEGAL_APPROVED } from "@/lib/legal";
import { getMenu } from "@/lib/menu";
import { SITE_URL } from "@/lib/shop";

// Area pages (/areas/[slug]) and blog articles join the sitemap only once
// their content is real (R11.6) — nothing templated-and-empty is listed.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date("2026-11-03");
  // The unapproved privacy, cookie and terms drafts are noindex, so they stay out of the sitemap until approved.
  // The allergen page is listed only when the wording is approved AND every item and option has its allergen data.
  let ready = false;
  try {
    ready = readinessFromMenu(await getMenu()).ready;
  } catch {
    /* cannot tell: not listed */
  }
  const allergens = LEGAL_APPROVED && ready ? ["/allergens"] : [];
  const legal = LEGAL_APPROVED ? ["/privacy", "/cookies", "/terms"] : [];
  return ["", "/menu", "/offers", "/contact", ...allergens, ...legal].map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
  }));
}
