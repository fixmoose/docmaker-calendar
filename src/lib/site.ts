/**
 * Where this app lives.
 *
 * Only NEXT_PUBLIC_* variables survive into the browser bundle, so VERCEL_ENV
 * and VERCEL_URL below are readable on the server only. Anything running in
 * the browser must go through publicUrl(), which falls back to the address the
 * page was actually served from — otherwise an unset NEXT_PUBLIC_APP_URL would
 * silently bake "localhost:3000" into the invitation links we email out.
 */

const trim = (url: string) => url.replace(/\/$/, "");

/** Server-side canonical URL — safe for metadata and server routes. */
export const SITE_URL = trim(
  process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_ENV === "production"
      ? "https://calendar.docmaker.studio"
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000"),
);

/**
 * Canonical URL that is correct in the browser too. Prefers the configured
 * domain so a link created on a preview deployment still points at the real
 * site; falls back to the current origin when nothing is configured.
 */
export function publicUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return trim(configured);
  if (typeof window !== "undefined") return trim(window.location.origin);
  return SITE_URL;
}

export const SITE_NAME = "DocMaker Calendar";
