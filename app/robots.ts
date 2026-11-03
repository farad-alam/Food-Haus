import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/shop";

// R11.4 / R11.13. robots.txt only steers crawlers — it is NOT access control;
// the real protection is the admin login (R9.1) and order tokens (R13.15).
export default function robots(): MetadataRoute.Robots {
  if (process.env.APP_ENV !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/checkout", "/order/"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
