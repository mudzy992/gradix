import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  // Next izlazi kao samostalan Node proces za Docker/Coolify (nije serverless).
  output: "standalone",
  // Bez ovoga Next traži node_modules unutar apps/web i u monorepu ne nađe
  // @gradix/* pakete. Korijen praćenja je korijen v2/ workspace-a.
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  reactStrictMode: true,
  poweredByHeader: false,
  // Node SDK ostaje pravi paket: Smithy učitava Node builtine kroz CommonJS require.
  serverExternalPackages: ["pg", "argon2", "@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"],
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
