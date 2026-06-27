import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title:       "RoadWatch Ghana",
  description: "Ghana road safety intelligence. Report hazards, check routes, stay safe.",
  manifest:    "/manifest.json",
  appleWebApp: {
    capable:          true,
    statusBarStyle:   "black-translucent",
    title:            "RoadWatch",
  },
  openGraph: {
    title:       "RoadWatch Ghana",
    description: "Report road hazards. Check your route. Stay safe.",
    type:        "website",
  },
};

export const viewport: Viewport = {
  themeColor:           "#EF4444",
  width:                "device-width",
  initialScale:         1,
  maximumScale:         1,
  userScalable:         false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest"        href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable"       content="yes" />
      </head>
      <body suppressHydrationWarning>
        {children}
        <script dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
              navigator.serviceWorker.register('/sw.js').catch(() => {});
            });
          }
        `}}/>
      </body>
    </html>
  );
}
