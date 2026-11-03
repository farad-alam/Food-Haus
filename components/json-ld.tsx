import type { Menu } from "@/lib/menu";
import { shop, SITE_URL } from "@/lib/shop";

// R11.2: Restaurant structured data built from the same shop settings and
// menu data as the pages, so nothing ever disagrees. Opening hours and geo
// are added only once the owner has confirmed them — never invented.

function escapeJson(json: string): string {
  // Prevent </script> breakout from any string in the data.
  return json.replace(/</g, "\\u003c");
}

export function RestaurantJsonLd({ menu }: { menu: Menu }) {
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
