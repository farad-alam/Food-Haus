import type { NextConfig } from "next";

// Only production is indexable (requirements R11.13). Everything else —
// local, preview — sends noindex.
const isProduction = process.env.APP_ENV === "production";

// R13.5: allow only our own files and the exact third-party hosts in use.
// NOTE: Next.js injects inline bootstrap scripts, so script-src still needs
// 'unsafe-inline' until nonce/hash-based CSP is wired up (tracked in
// docs/security-checklist.md). Everything else is locked down.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com https://www.googletagmanager.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://www.google-analytics.com https://*.googleusercontent.com",
  "font-src 'self'",
  "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com",
  "frame-src https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // R13.1: HSTS (Cloudflare also enforces HTTPS at the edge).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    const headers = [...securityHeaders];
    if (!isProduction) {
      headers.push({ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" });
    }
    return [
      { source: "/:path*", headers },
      // Customer order pages and checkout are never indexed (R11.4, R13.15).
      {
        source: "/(order|checkout)/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
