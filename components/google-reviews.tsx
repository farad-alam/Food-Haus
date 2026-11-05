"use client";

import { useEffect, useRef, useState } from "react";
import { loadPlacesLibrary, mountPlaceDetails } from "@/lib/google-places";

// Google rating and reviews (R7.1, R7.2, R7.4, R7.6).
//
// R7.4: nothing from Google loads before first paint, the space is reserved so
// the page cannot jump, and the whole block disappears quietly if loading fails.
//  - The page is rendered with a fixed-size empty box. Google's script is only
//    requested AFTER the page has painted AND the box is within 400px of the
//    screen. A visitor who never scrolls to the reviews costs us no Google load.
//  - Inside the fixed box Google's element scrolls by itself, so however many
//    reviews it draws, nothing around it moves.
//  - Any failure (blocked script, bad key, timeout, no network) removes the
//    block entirely.

type Props = { apiKey: string; placeId: string; writeReviewUrl: string; variant: "full" | "badge" };
type Phase = "waiting" | "loading" | "ready" | "failed";

/** Run after the browser has painted and is idle, never during first render. */
function afterFirstPaint(run: () => void): () => void {
  let cancelled = false;
  const go = () => {
    if (!cancelled) run();
  };
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  const start = () => (ric ? ric(go, { timeout: 2000 }) : setTimeout(go, 200));
  // two animation frames = after the first paint of this content
  const raf = requestAnimationFrame(() => requestAnimationFrame(start));
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}

export function GoogleReviews({ apiKey, placeId, writeReviewUrl, variant }: Props) {
  const [phase, setPhase] = useState<Phase>("waiting");
  const section = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const full = variant === "full";

  // 1. wait until the block is near the screen, then until the page is idle
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    let stopPaint = () => {};
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        stopPaint = afterFirstPaint(() => setPhase("loading"));
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      stopPaint();
    };
  }, []);

  // 2. load Google's script and mount its element. This effect must depend on "have we started",
  //    NOT on the phase: otherwise the loading -> ready change would re-run it and its cleanup
  //    would remove Google's element the moment it reports it has loaded.
  const started = phase === "loading" || phase === "ready";
  useEffect(() => {
    if (!started || !host.current) return;
    let cancelled = false;
    let cleanup = () => {};
    loadPlacesLibrary(apiKey)
      .then(() => {
        if (cancelled || !host.current) return;
        cleanup = mountPlaceDetails(host.current, {
          placeId,
          variant,
          onLoad: () => !cancelled && setPhase("ready"),
          onError: () => !cancelled && setPhase("failed"),
        });
      })
      .catch(() => !cancelled && setPhase("failed"));
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [started, apiKey, placeId, variant]);

  if (phase === "failed") return null; // hide quietly (R7.4)

  const box = full ? "h-[28rem]" : "h-14"; // fixed heights: reserved space, no layout shift
  return (
    <section ref={section} aria-label="Google reviews" data-reviews={variant} data-phase={phase} className={full ? "mt-2" : ""}>
      {full && <h2 className="font-display text-3xl">What customers say</h2>}
      <div className={`relative ${full ? "mt-3" : ""} ${box} overflow-hidden rounded-2xl border border-line bg-surface`} style={{ colorScheme: "dark" }}>
        <div ref={host} className="h-full w-full overflow-y-auto" />
        {phase !== "ready" && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex animate-pulse flex-col justify-center gap-3 p-4">
            <div className="h-4 w-1/3 rounded bg-surface-2" />
            {full && <div className="h-3 w-full rounded bg-surface-2" />}
            {full && <div className="h-3 w-5/6 rounded bg-surface-2" />}
          </div>
        )}
      </div>
      {full && (
        <>
          {/* R7.2: how the reviews are chosen and ordered. Google's own attribution is drawn inside its element. */}
          <p className="mt-2 text-xs text-muted">
            Ratings and reviews come from Google Maps. Google chooses which reviews to show and in what order (most relevant first); we do not edit, pick or hide them.
          </p>
          <p className="mt-3">
            <a href={writeReviewUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">Leave us a review on Google</a>
          </p>
        </>
      )}
    </section>
  );
}
