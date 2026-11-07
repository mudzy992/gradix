import type { NextConfig } from "next";

const config: NextConfig = {
  // Next izlazi u samostalan Node proces za Docker/Coolify (nije serverless).
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // Paketi se ne bundluju na serveru: `pg` i argon2 imaju native/Node dijelove.
  serverExternalPackages: ["pg", "argon2"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(self), microphone=()" },
        ],
      },
    ];
  },
};

export default config;
