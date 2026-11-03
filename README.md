# Food Haus Direct

Direct-ordering website and admin panel for Food Haus (halal burger takeaway, Luton LU4). Built by MotionBite.

The full spec is in [`docs/requirements.md`](docs/requirements.md). Security status is tracked in [`docs/security-checklist.md`](docs/security-checklist.md).

## Stack
Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind CSS 4 · Drizzle ORM + PostgreSQL (via Cloudflare Hyperdrive) · Stripe Checkout · hosted on **Cloudflare Workers** through the OpenNext adapter.

> Next.js 16 differs from older versions (`middleware` is now `proxy`, `"use cache"` replaces most caching APIs). Read `node_modules/next/dist/docs/` before changing framework-level code.

## Run it
```bash
npm install
cp .env.example .env.local
npm run dev            # http://localhost:3000
npm run typecheck
npm run build
```

Run the real Cloudflare runtime locally:
```bash
npm run cf:build
npx opennextjs-cloudflare populateCache local
npx wrangler dev       # http://localhost:8787
```

## What exists so far (days 1–2 foundation)
- Black/orange design tokens, mobile-first layout shell, "Order now" on every page
- Home, `/menu`, `/offers`, `/contact`, 404/error pages, `robots.txt`, `sitemap.xml`
- Menu loaded from `data/menu-seed.json` (extracted from the print menu — sample data until the owner confirms it) behind `getMenu()`, tagged `menu` for on-demand revalidation
- Client basket in localStorage with sticky bottom bar (display-only prices)
- Restaurant JSON-LD generated from the same menu data
- Security headers, noindex outside production, 128-bit order tokens
- Full Drizzle schema for the section 12 data model (`db/schema.ts`)
- Cloudflare config: OpenNext, KV incremental cache, D1 tag cache

## Not built yet
Checkout, Stripe, admin panel, order board, delivery zones, offers engine, reviews, cookie banner/GA4, legal pages (placeholders only), blog. See the delivery plan in section 15 of the requirements.

## Content still needed from the owner
Opening hours, delivery zones, allergens for every item (shown as "ask before ordering" until supplied), drinks list, what "Make it a Meal" includes, Companies House details, logo files, and the halal wording to claim (Q4). Opening hours are deliberately **not** published anywhere until confirmed (`lib/shop.ts`).
