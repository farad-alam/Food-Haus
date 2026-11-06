"use client";

import { useSyncExternalStore } from "react";
import { analyticsCookieNames, consentCookie, CONSENT_COOKIE, parseConsent, readCookie, type ConsentState } from "./consent";

// Browser side of the consent record: a tiny external store so the banner, the footer link, the
// cookie page and the analytics loader always agree, with no provider and no hydration mismatch.

const listeners = new Set<() => void>();
let panelOpen = false;
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function currentConsent(): ConsentState {
  try {
    return parseConsent(readCookie(document.cookie, CONSENT_COOKIE), Date.now());
  } catch {
    return "unset";
  }
}

export function setConsent(granted: boolean): void {
  try {
    document.cookie = consentCookie(granted, Date.now(), location.protocol === "https:");
  } catch {
    /* cookies blocked: the choice cannot be saved, so the banner will simply ask again next time */
  }
  if (!granted) removeAnalyticsCookies();
  panelOpen = false;
  emit();
}

export function openCookieSettings(): void {
  panelOpen = true;
  emit();
}

/** Deletes any Google Analytics cookies, on this host and its parent domain (GA sets them on the parent). */
export function removeAnalyticsCookies(): void {
  try {
    const names = analyticsCookieNames(document.cookie.split(";").map((c) => c.split("=")[0].trim()));
    const parts = location.hostname.split(".");
    const domains = ["", location.hostname, ...(parts.length > 2 ? [parts.slice(-2).join(".")] : [location.hostname])].map((d) => (d ? `; Domain=${d}` : ""));
    for (const n of names) for (const d of domains) document.cookie = `${n}=; Path=/; Max-Age=0${d}`;
  } catch {
    /* nothing to clean */
  }
}

/** "unknown" on the server and during hydration, so nothing flashes. */
export function useConsent(): ConsentState | "unknown" {
  return useSyncExternalStore(subscribe, currentConsent, () => "unknown" as const);
}
export function usePanelOpen(): boolean {
  return useSyncExternalStore(subscribe, () => panelOpen, () => false);
}
