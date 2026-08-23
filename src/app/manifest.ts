import type { MetadataRoute } from "next";

/**
 * Makes the calendar installable. On Android that is a convenience; on iOS it
 * is the requirement — Safari only delivers web push to a site that has been
 * added to the Home Screen.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DocMaker Calendar",
    short_name: "Calendar",
    description:
      "Share the plans that matter, keep the rest private. Part of DocMaker Studio.",
    start_url: "/calendar",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f6f6f7",
    theme_color: "#dc6b15",
    categories: ["productivity", "lifestyle"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Today", url: "/calendar?view=day" },
      { name: "This week", url: "/calendar?view=week" },
    ],
  };
}
