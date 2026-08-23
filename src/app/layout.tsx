import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SITE_URL } from "@/lib/site";
import { themeScript } from "@/lib/theme-script";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "DocMaker Calendar",
    template: "%s · DocMaker Calendar",
  },
  description:
    "A shared calendar for the people you plan life with — personal, group and per-event sharing.",
  applicationName: "DocMaker Calendar",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Calendar",
    statusBarStyle: "default",
  },
  openGraph: {
    type: "website",
    siteName: "DocMaker Calendar",
    url: SITE_URL,
    title: "DocMaker Calendar",
    description:
      "Share the plans that matter, keep the rest private. Part of DocMaker Studio.",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d10" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}
