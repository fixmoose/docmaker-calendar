"use client";

import { useSyncExternalStore } from "react";

/**
 * Matches a media query as external state, so layout follows the viewport
 * without an effect writing state on every render.
 */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const MOBILE = "(max-width: 820px)";

/** Phones and small tablets held upright. */
export const useIsMobile = () => useMediaQuery(MOBILE);

/** The same question asked once, for a starting value — never on the server. */
export const isMobileNow = () =>
  typeof window !== "undefined" && window.matchMedia(MOBILE).matches;
