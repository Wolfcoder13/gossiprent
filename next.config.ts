import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (the zero-config local database) ships WASM + data files that must be
  // loaded with Node's native require instead of being bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  outputFileTracingExcludes: {
    "/*": [
      // Never ship a local embedded database (it holds password hashes).
      ".data/**",
      // On Vercel the app always uses DATABASE_URL, so leave the ~26 MB
      // embedded database engine out of the deployed functions too.
      ...(process.env.VERCEL ? ["node_modules/@electric-sql/pglite/**"] : []),
    ],
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
