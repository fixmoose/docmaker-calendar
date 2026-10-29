"use client";

import { useSyncExternalStore } from "react";

/**
 * The whole screen for the calendar, and back into the browser window.
 *
 * Read through useSyncExternalStore rather than mirrored into state: the
 * browser owns this — Esc, or the browser's own control, leaves it too — and
 * the button has to follow whichever way it was left.
 */

const onChange = (notify: () => void) => {
  document.addEventListener("fullscreenchange", notify);
  return () => document.removeEventListener("fullscreenchange", notify);
};
const never = () => () => {};

export function useFullscreen() {
  const active = useSyncExternalStore(
    onChange,
    () => Boolean(document.fullscreenElement),
    () => false,
  );
  // An iPhone has no fullscreen for a page at all; there the button is left
  // out rather than shown doing nothing.
  const supported = useSyncExternalStore(
    never,
    () => Boolean(document.fullscreenEnabled),
    () => false,
  );
  return { active, supported };
}

export function toggleFullscreen() {
  if (!document.fullscreenEnabled) return;
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => {});
}
