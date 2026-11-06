"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { gaScriptSrc } from "@/lib/consent";
import { openCookieSettings, removeAnalyticsCookies, setConsent, useConsent, usePanelOpen } from "@/lib/consent-store";

// R11.9: banner with EQUAL Accept and Reject, and Google Analytics that loads only after Accept.
// With no analytics ID configured there is nothing to ask about, so nothing is shown.

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    [key: `ga-disable-${string}`]: boolean | undefined;
  }
}

export function CookieBanner({ analyticsId }: { analyticsId: string | null }) {
  const consent = useConsent();
  const reopened = usePanelOpen();
  const region = useRef<HTMLElement>(null);
  const show = !!analyticsId && consent !== "unknown" && (consent === "unset" || reopened);

  // Reopened from the footer: move focus into the banner so keyboard users find it. (Never on first load.)
  useEffect(() => {
    if (reopened) region.current?.querySelector<HTMLElement>("button")?.focus();
  }, [reopened]);

  if (!show) return null;
  const btn = "btn btn-primary !min-h-[44px] flex-1 !px-4 !py-2 text-sm sm:flex-none"; // one shared style: Accept and Reject look identical
  return (
    <section ref={region} aria-label="Cookie choices" className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface p-4 shadow-lg print:hidden" data-testid="cookie-banner">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          We would like to use analytics cookies to see how the site is used. Cookies needed to run the site (your basket, payment, staff sign-in) are always on. Your choice is saved for 6 months and you can change it at any time. <Link href="/cookies" className="underline">Cookie policy</Link>
        </p>
        <div className="flex gap-3">
          <button type="button" className={btn} onClick={() => setConsent(true)}>Accept analytics</button>
          <button type="button" className={btn} onClick={() => setConsent(false)}>Reject analytics</button>
        </div>
      </div>
    </section>
  );
}

function loadGa(id: string) {
  if (document.querySelector("script[data-fh-ga]")) return;
  window[`ga-disable-${id}`] = false;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // gtag.js needs the real `arguments` object, not an array
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", id);
  const s = document.createElement("script");
  s.async = true;
  s.src = gaScriptSrc(id);
  s.dataset.fhGa = "1";
  document.head.appendChild(s);
}

/** Loads GA4 only while consent is granted, and only once the page has loaded and the browser is idle (R10.7). */
export function Analytics({ id }: { id: string | null }) {
  const consent = useConsent();
  useEffect(() => {
    if (!id) return;
    if (consent === "denied" || consent === "unset") {
      window[`ga-disable-${id}`] = true; // if it was already loaded this session, stop it sending
      if (consent === "denied") removeAnalyticsCookies();
      return;
    }
    if (consent !== "granted") return;
    let cancelled = false;
    const start = () => {
      const run = () => !cancelled && loadGa(id);
      if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 4000 });
      else setTimeout(run, 1500);
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", start);
    };
  }, [consent, id]);
  return null;
}

/** Footer link that reopens the choices. Only exists when there is something to choose. */
export function CookieSettingsButton({ analyticsId }: { analyticsId: string | null }) {
  if (!analyticsId) return null;
  return (
    <button type="button" onClick={openCookieSettings} className="min-h-[24px] text-left underline">
      Cookie settings
    </button>
  );
}

/** Shown on the cookie policy page: the current choice and the two buttons. */
export function CookiePreferences({ analyticsId }: { analyticsId: string | null }) {
  const consent = useConsent();
  if (!analyticsId) return <p data-testid="analytics-off">Analytics is not switched on for this site, so there is nothing to accept or reject. We only use the cookies and storage needed to run the site.</p>;
  const label = consent === "granted" ? "accepted" : consent === "denied" ? "rejected" : consent === "unknown" ? "…" : "not chosen yet";
  const btn = "btn btn-primary !min-h-[44px] !px-4 !py-2 text-sm";
  return (
    <div className="rounded-lg border border-line bg-surface p-4" data-testid="cookie-preferences">
      <p>Analytics cookies: <strong data-testid="consent-state">{label}</strong></p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" className={btn} onClick={() => setConsent(true)}>Accept analytics</button>
        <button type="button" className={btn} onClick={() => setConsent(false)}>Reject analytics</button>
      </div>
    </div>
  );
}
