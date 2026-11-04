import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
        ],
      },
    ];
  },
  // The pipeline reads runway geometry from this file at runtime; make sure
  // it is bundled with the API functions.
  outputFileTracingIncludes: {
    "/api/**/*": ["./data/airports.json"],
    // The Remotion bundle copied into the Vercel Sandbox for MP4 rendering.
    "/api/stories/*/render": ["./build/**/*"],
  },
  // Keep local working data and Remotion render output out of function bundles.
  outputFileTracingExcludes: {
    "*": ["./data/stories/**", "./data/ourairports/**", "./data/cache/**", "./out/**", "./public/stories/**", "./.local-store/**"],
  },
};

export default nextConfig;
