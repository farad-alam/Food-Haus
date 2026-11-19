// Original drawn food shapes (R5.1): the fallback for a category tile that has no photo (for example a brand
// new category), plus the small icons the home page uses. All plain inline SVG — no JavaScript, no motion, nothing copied from anywhere.

const BUN = "#e8a33d";
const BUN_DARK = "#c97f22";
const PATTY = "#6d3a1e";
const CHEESE = "#f4b83c";
const LEAF = "#7fae3f";
const RED = "#c23a22";
const CREAM = "#f7e9d6";

function Burger() {
  return (
    <g>
      <path d="M14 30 a18 13 0 0 1 36 0 z" fill={BUN} />
      <ellipse cx="24" cy="22" rx="2.6" ry="1.5" fill={CREAM} />
      <ellipse cx="34" cy="20" rx="2.6" ry="1.5" fill={CREAM} />
      <path d="M13 32 q5 6 10 0 q5 6 10 0 q5 6 10 0 q5 6 8 1 l1 4 h-40 z" fill={LEAF} />
      <rect x="13" y="38" width="38" height="8" rx="4" fill={PATTY} />
      <path d="M14 48 h36 v2 a7 7 0 0 1 -7 7 h-22 a7 7 0 0 1 -7 -7 z" fill={BUN_DARK} />
    </g>
  );
}
const Wings = () => (
  <g>
    <ellipse cx="36" cy="30" rx="16" ry="12" transform="rotate(-28 36 30)" fill={RED} />
    <ellipse cx="42" cy="25" rx="6" ry="4" transform="rotate(-28 42 25)" fill="#d95b33" />
    <rect x="12" y="38" width="16" height="6" rx="3" transform="rotate(32 20 41)" fill={CREAM} stroke={BUN_DARK} strokeWidth="1.5" />
    <circle cx="13" cy="47" r="4" fill={CREAM} stroke={BUN_DARK} strokeWidth="1.5" />
  </g>
);
const Wrap = () => (
  <g transform="rotate(-24 32 36)">
    <rect x="12" y="26" width="40" height="18" rx="9" fill={BUN} />
    <path d="M14 30 q6 4 0 9 M22 28 q6 5 0 12" stroke={BUN_DARK} strokeWidth="2" fill="none" strokeLinecap="round" />
    <path d="M40 26 h4 c3 0 6 2 6 5 l0 8 c0 3 -3 5 -6 5 h-4 z" fill={CREAM} />
    <path d="M42 27 l3 4 l3 -4 M42 43 l3 -4 l3 4" stroke={LEAF} strokeWidth="2.4" fill="none" strokeLinecap="round" />
  </g>
);
const Fries = () => (
  <g>
    <g strokeLinecap="round" strokeWidth="5">
      <path d="M24 30 V16" stroke={CHEESE} />
      <path d="M32 28 V13" stroke={BUN} />
      <path d="M40 30 V17" stroke={CHEESE} />
    </g>
    <path d="M18 28 h28 l-4 23 a4 4 0 0 1 -4 4 h-12 a4 4 0 0 1 -4 -4 z" fill={RED} />
    <path d="M22 36 h20" stroke={CREAM} strokeWidth="3" strokeLinecap="round" />
  </g>
);
const Tenders = () => (
  <g>
    <rect x="10" y="18" width="13" height="30" rx="6.5" transform="rotate(-10 16 33)" fill={BUN} />
    <rect x="26" y="15" width="13" height="34" rx="6.5" fill={BUN_DARK} />
    <rect x="42" y="18" width="13" height="30" rx="6.5" transform="rotate(10 48 33)" fill={BUN} />
  </g>
);
const Sides = () => (
  <g>
    <path d="M12 30 h40 a20 16 0 0 1 -40 0 z" fill={RED} />
    <path d="M16 30 h32" stroke={CREAM} strokeWidth="3" strokeLinecap="round" />
    <circle cx="24" cy="24" r="4" fill={CHEESE} />
    <circle cx="34" cy="21" r="4" fill={LEAF} />
    <circle cx="43" cy="25" r="4" fill={BUN} />
  </g>
);

const CATEGORY_ART: Record<string, () => React.ReactNode> = {
  burgers: Burger,
  wings: Wings,
  wraps: Wrap,
  "loaded-fries": Fries,
  tenders: Tenders,
  sides: Sides,
};

/** A drawn icon for a category tile or card, until the owner uploads a photo for it. Unknown categories get the plate. */
export function CategoryArt({ slug, className }: { slug: string; className?: string }) {
  const Art = CATEGORY_ART[slug] ?? Sides;
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <Art />
    </svg>
  );
}

/** Small line icons for the ordering steps and the hero strip. */
export function MiniIcon({ kind, className }: { kind: "menu" | "scooter" | "pay"; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {kind === "menu" && (
        <>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </>
      )}
      {kind === "scooter" && (
        <>
          <circle cx="6" cy="17" r="2.5" />
          <circle cx="18" cy="17" r="2.5" />
          <path d="M8.5 17h5l2-7h-4M13 7h3l2 10M3 11h5" />
        </>
      )}
      {kind === "pay" && (
        <>
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M3 10h18M7 15h4" />
        </>
      )}
    </svg>
  );
}
