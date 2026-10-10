"use client";

import { useEffect } from "react";

// Counts one visit per browser session for the app's owner: a single empty POST to the address
// WishWhip sets at deploy time. No cookie, no identifier, no page path, nothing about the visitor.
// Mounted once in app/providers.tsx. Do not edit, move or remove it; see docs/visits.md.

const SESSION_FLAG = "wishwhip.visited";

type VisitorNavigator = Navigator & { globalPrivacyControl?: boolean };
type MaybePrerendering = Document & { prerendering?: boolean };

function send(url: string): void {
  try {
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url)) return;
  } catch {
    // Fall through to fetch.
  }
  fetch(url, { method: "POST", keepalive: true, mode: "no-cors" }).catch(() => {});
}

function countVisit(url: string): void {
  if (location.protocol !== "https:") return;
  const visitor = navigator as VisitorNavigator;
  if (visitor.globalPrivacyControl === true) return;
  if (visitor.webdriver === true) return;
  // Marked before sending, so a second mount in the same session never counts twice. Storage that
  // cannot be read or written means no count rather than one per page load.
  try {
    if (sessionStorage.getItem(SESSION_FLAG)) return;
    sessionStorage.setItem(SESSION_FLAG, "1");
  } catch {
    return;
  }
  send(url);
}

export function VisitBeacon() {
  useEffect(() => {
    // Read by its full name so Next writes the value into the browser bundle at build time.
    const url = process.env.NEXT_PUBLIC_WISHWHIP_VISIT_URL;
    if (!url) return;
    // A page the browser renders ahead of time is not a visit until someone actually opens it.
    if ((document as MaybePrerendering).prerendering === true) {
      const onActivate = () => countVisit(url);
      document.addEventListener("prerenderingchange", onActivate, { once: true });
      return () => document.removeEventListener("prerenderingchange", onActivate);
    }
    countVisit(url);
  }, []);
  return null;
}
