import type { MetadataRoute } from "next";
import { LEGAL_APPROVED } from "@/lib/legal";
import { SITE_URL } from "@/lib/shop";

// Area pages (/areas/[slug]) and blog articles join the sitemap only once
// their content is real (R11.6) — nothing templated-and-empty is listed.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-11-03");
  // The unapproved privacy and cookie drafts are noindex, so they stay out of the sitemap until approved.
  const legal = LEGAL_APPROVED ? ["/privacy", "/cookies"] : [];
  return ["", "/menu", "/offers", "/contact", "/allergens", ...legal, "/terms"].map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
  }));
}
