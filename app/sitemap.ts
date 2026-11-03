import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/shop";

// Area pages (/areas/[slug]) and blog articles join the sitemap only once
// their content is real (R11.6) — nothing templated-and-empty is listed.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-11-03");
  return ["", "/menu", "/offers", "/contact", "/allergens", "/privacy", "/cookies", "/terms"].map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
  }));
}
