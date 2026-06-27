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
  // Enable PWA headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options",    value: "nosniff"      },
          { key: "X-Frame-Options",            value: "DENY"         },
          { key: "Referrer-Policy",            value: "strict-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
