import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // WINDUP-1: ssh2 (SSH transport for the installer/doctor) ships CJS
  // dynamic requires that Turbopack cannot place in ESM chunks — keep it as
  // a runtime require instead of bundling it.
  serverExternalPackages: ["ssh2", "sshpk"],
  typescript: {
    // WINDUP-1: tsc is back to 0 errors, so builds now GATE on types.
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
