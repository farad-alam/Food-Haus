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
  "script-src 'self' 'unsafe-inline' https://js.stripe.com https://www.googletagmanager.com https://challenges.cloudflare.com https://maps.googleapis.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https://www.google-analytics.com https://*.googleusercontent.com https://*.ggpht.com https://maps.gstatic.com https://maps.googleapis.com https://places.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://maps.googleapis.com https://places.googleapis.com",
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
  // PREVIEW BRANCH ONLY. On main this is `cacheComponents: true` + `partialPrefetching: true`.
  // With Cache Components on, EVERY page that has to be rendered (not served from the build-time cache) hangs
  // on Cloudflare Workers ("the Workers runtime canceled this request because it detected that your Worker's
  // code had hung", Error 1101), reproduced in Cloudflare's local runtime with the built worker: all pages hang,
  // route handlers work, and it makes no difference whether the cache, database or password code is involved.
  // Off, the same build renders every page correctly, including after the cache window. `use cache` (menu,
  // schedule, notice, contact, offers) stays on through experimental.useCache; pages are rendered per request
  // instead of being prerendered shells, so they are slower than main intends. See docs/preview-deploy.md.
  cacheComponents: false,
  experimental: { useCache: true },
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
      // The admin panel and its API are never indexed or cached (R11.4).
      {
        source: "/(admin|api/admin)/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
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
