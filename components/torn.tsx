// Torn-paper dividers between the home page's colour bands (R5.1 design). Pure static SVG: no JavaScript,
// no motion, stretches to any width (preserveAspectRatio="none") so it works from 360 px up.
//
// The wrapper carries the PREVIOUS band's colour and the jagged path the NEXT band's colour, so the boundary
// between them is the torn line. Two different rips (and a flip) keep the edges from looking repeated.

const RIPS = [
  "M0 30 L0 16 L36 22 L74 8 L118 19 L166 6 L214 17 L258 9 L306 20 L352 7 L398 15 L448 10 L496 21 L542 8 L590 18 L638 11 L686 22 L732 9 L778 16 L826 6 L874 18 L920 10 L968 20 L1014 8 L1060 17 L1108 11 L1154 21 L1200 9 L1248 16 L1294 7 L1342 18 L1392 12 L1440 16 L1440 30 Z",
  "M0 30 L0 12 L42 20 L88 9 L132 22 L178 11 L228 18 L272 6 L320 15 L368 10 L412 21 L460 8 L508 19 L556 12 L602 23 L648 7 L696 16 L744 10 L792 20 L840 8 L886 17 L934 12 L982 22 L1028 9 L1076 18 L1124 7 L1170 19 L1218 11 L1266 21 L1312 8 L1360 15 L1404 10 L1440 18 L1440 30 Z",
] as const;

export function Torn({ from, to, rip = 0, flip = false }: { from: string; to: string; rip?: 0 | 1; flip?: boolean }) {
  return (
    <div aria-hidden="true" className={from}>
      <svg viewBox="0 0 1440 30" preserveAspectRatio="none" className={`block h-5 w-full sm:h-7 ${to} ${flip ? "-scale-x-100" : ""}`}>
        <path fill="currentColor" d={RIPS[rip]} />
      </svg>
    </div>
  );
}
