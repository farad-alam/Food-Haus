// The home page's built-in photos (supplied by the owner, generated in his own Gemini account): the default
// hero, the wide feast banner and one photo per category tile. They are DECORATION for the home page only —
// never attached to a menu item, because item photos must show the shop's real food. An image uploaded in
// Settings (Home page images) overrides each of them; these are what the page shows until then.
//
// Static files in public/home/, AVIF with a WebP fallback, several widths, explicit size on every <img>
// so nothing shifts (R10.5, R10.8).

export type StaticImage = { base: string; widths: number[]; width: number; height: number };

const cat = (slug: string): StaticImage => ({ base: `/home/cat-${slug}`, widths: [128, 256], width: 256, height: 256 });

export const HOME_DEFAULTS = {
  hero: { base: "/home/hero", widths: [400, 800, 1024], width: 1024, height: 1024 } as StaticImage,
  banner: { base: "/home/banner", widths: [640, 1024], width: 1024, height: 572 } as StaticImage,
  categories: {
    burgers: cat("burgers"),
    wings: cat("wings"),
    wraps: cat("wraps"),
    "loaded-fries": cat("loaded-fries"),
    tenders: cat("tenders"),
    sides: cat("sides"),
  } as Record<string, StaticImage>,
};

const srcset = (i: StaticImage, ext: "avif" | "webp") => i.widths.map((w) => `${i.base}-${w}.${ext} ${w}w`).join(", ");

/** AVIF with a WebP fallback. Decorative by default (empty alt). */
export function FoodPicture({ image, sizes, alt = "", className, imgClassName, loading = "lazy", fetchPriority }: { image: StaticImage; sizes: string; alt?: string; className?: string; imgClassName?: string; loading?: "lazy" | "eager"; fetchPriority?: "high" }) {
  const largest = image.widths[image.widths.length - 1];
  return (
    <picture className={className}>
      <source type="image/avif" srcSet={srcset(image, "avif")} sizes={sizes} />
      <img
        src={`${image.base}-${largest}.webp`}
        srcSet={srcset(image, "webp")}
        sizes={sizes}
        alt={alt}
        width={image.width}
        height={image.height}
        loading={loading}
        decoding="async"
        fetchPriority={fetchPriority}
        className={imgClassName}
      />
    </picture>
  );
}
