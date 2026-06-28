import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/icons/icon-192.png", destination: "/icons/icon-192.svg", permanent: false },
      { source: "/icons/icon-512.png", destination: "/icons/icon-512.svg", permanent: false },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff"       },
          { key: "X-Frame-Options",         value: "DENY"          },
          { key: "Referrer-Policy",         value: "strict-origin" },
        ],
      },
      {
        // Never let the browser or CDN cache sw.js — it must always be fetched fresh
        // so the browser can detect when a new service worker version is available.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control",         value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/"                                   },
        ],
      },
    ];
  },
};

export default nextConfig;
