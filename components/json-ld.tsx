import type { HoursRow } from "@/lib/hours";
import type { Menu } from "@/lib/menu";
import { shop, SITE_URL } from "@/lib/shop";

// R11.2: Restaurant structured data built from the same shop settings and
// menu data as the pages, so nothing ever disagrees. Opening hours and geo
// are added only once the owner has confirmed them — never invented.

function escapeJson(json: string): string {
  // Prevent </script> breakout from any string in the data.
  return json.replace(/</g, "\\u003c");
}

const DAY_URL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hm = (t: string) => t.slice(0, 5); // "HH:MM:SS" -> "HH:MM"

/** schema.org opening hours from the hours the owner entered in Settings. Empty (so left out) until they have entered some. */
export function openingHoursSpec(hours: HoursRow[]) {
  return hours
    .filter((h) => h.weekday >= 0 && h.weekday <= 6)
    .map((h) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: `https://schema.org/${DAY_URL[h.weekday]}`, opens: hm(h.opensAt), closes: hm(h.closesAt) }));
}

export function RestaurantJsonLd({ menu, hours = [] }: { menu: Menu; hours?: HoursRow[] }) {
  const spec = openingHoursSpec(hours);
  const data = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "@id": `${SITE_URL}/#restaurant`,
    name: shop.name,
    url: SITE_URL,
    telephone: shop.phone,
    priceRange: "££",
    servesCuisine: ["Burgers", "Fried chicken", "Halal"],
    address: {
      "@type": "PostalAddress",
      streetAddress: shop.address.street,
      addressLocality: shop.address.locality,
      postalCode: shop.address.postcode,
      addressCountry: shop.address.country,
    },
    ...(spec.length ? { openingHoursSpecification: spec } : {}),
    hasMenu: {
      "@type": "Menu",
      url: `${SITE_URL}/menu`,
      hasMenuSection: menu.categories.map((c) => ({
        "@type": "MenuSection",
        name: c.name,
        hasMenuItem: c.items.map((i) => ({
          "@type": "MenuItem",
          name: i.name,
          description: i.description,
          suitableForDiet: shop.halal ? "https://schema.org/HalalDiet" : undefined,
          offers: { "@type": "Offer", price: (i.price / 100).toFixed(2), priceCurrency: shop.currency },
        })),
      })),
    },
    potentialAction: {
      "@type": "OrderAction",
      target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/menu`, actionPlatform: ["http://schema.org/DesktopWebPlatform", "http://schema.org/MobileWebPlatform"] },
      deliveryMethod: ["http://purl.org/goodrelations/v1#DeliveryModeOwnFleet", "http://purl.org/goodrelations/v1#DeliveryModePickUp"],
    },
    sameAs: [shop.tiktok],
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: escapeJson(JSON.stringify(data)) }} />;
}
