import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
