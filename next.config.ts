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
          // PREVIEW-FRAME-1: X-Frame-Options: DENY blocked the Z.ai preview
          // iframe ("refused to connect"). CSP frame-ancestors is the modern
          // selective-allow replacement: still blocks third-party framing,
          // but lets the platform's own preview/chat surfaces embed the app.
          // Modern browsers ignore X-Frame-Options when frame-ancestors is
          // present, so do NOT reintroduce the blanket DENY.
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://*.space-z.ai https://*.z.ai",
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
