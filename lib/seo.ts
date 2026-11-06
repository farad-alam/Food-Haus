import type { Metadata } from "next";
import { shop } from "./shop";

// Per-page title, description, canonical URL, Open Graph and Twitter tags (R11.1). Every public page
// goes through this, so none can ship with the home page's tags or without a share image.
// public/share.png is a simple branded card; replace it with a photo-led image when the owner has one.

export const SHARE_IMAGE = { url: "/share.png", width: 1200, height: 630, alt: "Food Haus: halal burgers, wings and loaded fries in Luton" } as const;

export function pageMetadata(p: { title: string; description: string; path: string; absoluteTitle?: boolean; noindex?: boolean }): Metadata {
  const full = p.absoluteTitle ? p.title : `${p.title} | ${shop.name}`;
  return {
    title: p.absoluteTitle ? { absolute: p.title } : p.title,
    description: p.description,
    alternates: { canonical: p.path },
    openGraph: { type: "website", locale: "en_GB", siteName: shop.name, title: full, description: p.description, url: p.path, images: [SHARE_IMAGE] },
    twitter: { card: "summary_large_image", title: full, description: p.description, images: [SHARE_IMAGE.url] },
    ...(p.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}
