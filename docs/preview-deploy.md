# Preview deploy to Cloudflare (no terminal)

Branch: `preview-deploy` (not `main`). It differs from `main` in these ways: `wrangler.jsonc` has no R2 or Images bindings and photos use Cloudinary instead (runtime variables below), `package.json` has a `cf:ci-build` script, and `scripts/ci-preflight.mts` and `scripts/bootstrap-preview.mts` exist. Everything else is identical.

What the preview does NOT do: card payment, emails, reviews, analytics, the bot check, photo upload. Leave their variables unset.

## What the build does (Cloudflare runs it; nobody types commands)
`npm run cf:ci-build` =
1. **preflight**: stops with a plain message, before touching anything, if a variable is missing, `NEXT_PUBLIC_SITE_URL` is not an https address, or `wrangler.jsonc` still has placeholder cache ids.
2. **migrate**: applies the database migrations (safe to repeat).
3. **seed**: loads the 38 sample menu items only if the menu is empty (never overwrites).
4. **bootstrap**: creates the first owner if no admin exists, or prints a fresh setup link if that owner has not finished setup. Never prints the password. Prints the one-time setup link in the build log.
5. **build**: `opennextjs-cloudflare build`. Then the dashboard's deploy command uploads the cache and the Worker.

## Dashboard settings
| Setting | Value |
| --- | --- |
| Worker name | `food-haus` (must equal `name` in `wrangler.jsonc`) |
| Production branch | `preview-deploy` (turn off builds for other branches) |
| Root directory | `/` |
| Build command | `npm run cf:ci-build` |
| Deploy command | `npx opennextjs-cloudflare deploy` |

Build variables and secrets (Builds section):
| Name | Type | Value |
| --- | --- | --- |
| `DATABASE_URL` | secret | the new Neon database's connection string |
| `SECRET_BOX_KEY` | secret | the preview key supplied with this handoff |
| `NEXT_PUBLIC_SITE_URL` | text | `https://food-haus.<account-subdomain>.workers.dev` |
| `BOOTSTRAP_OWNER_EMAIL` | text | the owner's email |
| `BOOTSTRAP_OWNER_PASSWORD` | secret | a password the owner chooses (12+ characters); delete it after first sign-in |
| `NODE_VERSION` | text | `22` |

Runtime variables and secrets (on the Worker itself, Settings, Variables and Secrets, type **Secret**):
`DATABASE_URL` (same as above), `SECRET_BOX_KEY` (same as above), `CRON_SECRET` (the preview value supplied with this handoff).

No Stripe, Resend, Turnstile, GA4 or Google variables.

## Before the first build
The KV namespace and D1 database ids in `wrangler.jsonc` are placeholders. The build refuses to start until real ids are committed. The owner creates both in the dashboard (Storage & Databases: KV, Create namespace `food-haus-cache`; D1, Create database `food-haus-tag-cache`) and sends the two ids, which are not secret.

## Known unverified points (first real Cloudflare run)
- Whether the build's automatic API token may write KV and D1 (the deploy fills the cache first). A permission error at that step means the token needs those permissions.
- Dashboard labels were written from memory; check them on screen.
- The first time this app runs on Cloudflare's runtime. See `docs/owner-checklist.md`, section C.

## When the preview is no longer needed
Delete the Worker and the KV namespace and D1 database, and delete or rotate the Neon database. The preview `SECRET_BOX_KEY` and `CRON_SECRET` are throwaway: never reuse them for the real launch.

## Known problem fixed on this branch: pages hung with Cache Components on
Symptom on the first preview: Cloudflare Error 1101 and "The Workers runtime canceled this request because it detected that your Worker's code had hung" on every page that was not served straight from the build-time cache (it looked fine right after a deploy and broke once the 1-minute revalidation window passed). A warning that Next.js cannot guarantee Cache Components because of the runtime's `setTimeout` accompanied it.
- Reproduced locally in Cloudflare's runtime (`wrangler dev --local` on the built worker): every page hangs, API routes work.
- It does not depend on the KV or D1 cache, the database, or the password code.
- `next.config.ts` on this branch turns Cache Components off (and keeps `use cache` through `experimental.useCache`). Then every page renders, also after the revalidation window.
- `main` still has Cache Components on, so **`main` will hit this on Cloudflare** until the cause is fixed upstream or by an upgrade (newer Next.js and OpenNext releases exist and were not tried). Do not deploy `main` as it is.
- Cost: pages are rendered per request instead of served as prerendered shells, so they are slower than the design intends (R10.3). Acceptable for a preview.

## Known problem fixed on this branch: /menu and /offers showed "Something went wrong"
Symptom on the live preview (commit c8acdc5): /menu and /offers (and sometimes the home page) loaded with the full menu in the HTML and were then replaced by the error screen; browser console "Minified React error 441" (an error in the Server Components render).
- The Worker log's stack, mapped onto the built bundle, ends in Next's `use cache` wrapper at the line "joining pending cross-request invocation", called from the live-offers component (`getPublicOffers()` after `connection()`).
- On Workers a request can join another request's still-pending cached computation. That promise belongs to the first request; when that request ends or is cancelled first (page prefetches and abandoned loads do this constantly) the others wait on it or inherit its failure. Only the offers components were hit because they are called after `connection()` and many times per page.
- Fix on this branch: the five public data readers (menu, offers, opening hours, notice bar, contact details) no longer use Next's `use cache`. `lib/local-cache.ts` keeps only resolved plain values for 30 seconds per running instance; every miss does its own database read and nothing pending is shared between requests. Admin saves clear the instance that handled them at once (`lib/menu-cache.ts`); another running instance can show a value up to 30 seconds old.
- NOT reproduced locally: Cloudflare's local runtime does not cancel a request when the client hangs up, so the exact trigger could not be provoked. The location was found from the stack; the fix removes that mechanism. Verified in the local runtime against the real database: every page renders, 40 concurrent mixed requests (some hung up early) all succeed, and pages still render after the old 60-second window.
- Log noise that is NOT a bug: "Failed to revalidate stale page /checkout ... Dummy queue is not implemented". OpenNext has no queue configured, so stale prerendered static pages (checkout, terms, privacy, cookies, login) cannot be refreshed in the background; they are static text and keep being served. Harmless.

## Requirements batch (home status and hours, About, area pages, blog, photos)
Variables are BUILD variables in the dashboard (they are fixed when the site is built), then Retry build.

| Feature | Variables | Behaviour when unset |
| --- | --- | --- |
| Google reviews and rating badge (R7) | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_PLACE_ID`; optional `NEXT_PUBLIC_GOOGLE_REVIEW_URL` | Nothing is drawn, no space is taken |
| Blog (R5.9) | `NEXT_PUBLIC_SANITY_PROJECT_ID` (8 to 12 lower-case letters or digits); optional `NEXT_PUBLIC_SANITY_DATASET` (default `production`) | `/blog` and `/blog/<slug>` return 404; no nav link, no sitemap entries |
| Photo upload and delivery (R9.7, R10.5) | **Worker runtime** variables (not build): `CLOUDINARY_CLOUD_NAME` (plain), `CLOUDINARY_API_KEY` (plain or secret), `CLOUDINARY_API_SECRET` (**Secret**) | The editor says photo upload is not switched on; the rest of the site is unaffected |

Google: create an API key restricted to your website address and to "Maps JavaScript API" and "Places API (New)"; the Place ID comes from Google's Place ID finder. The rating, count and review text are drawn by Google in the visitor's browser; none is stored or typed by us. Without a valid key and Place ID the block simply does not appear.

Sanity: the project must have a PUBLIC dataset with documents of type `post` having `title`, `slug`, `excerpt`, `publishedAt`, optional `seoDescription` and `mainImage` (with `alt`), and `body` (portable text). Only published documents are read; no token is used. Unreachable Sanity: the list shows a polite message and an article is a 404.

Photos: menu photos live in **Cloudinary** (the owner's decision; R2 and Cloudflare Images are not used). The Worker checks each upload itself (real type from the bytes, 8 MB cap, at least 1200x900, 50-megapixel cap) and then uploads it with a signed request, no SDK, so nothing is sent for a bad file and the browser never sees a credential. The stored original is rotated upright, capped at 1600 px and stripped of ALL metadata (EXIF/GPS) by the upload transformation `a_exif/c_limit,w_1600,h_1600/fl_force_strip`. Delivery is `res.cloudinary.com` URLs with `c_lfill,ar_4:3,g_auto,w_<N>,f_auto,q_auto` (4:3, width cap 1600, automatic format and quality), srcset 400/800/1200/1600 and explicit width and height, so nothing shifts. Replacing or removing a photo, and deleting an item, destroys the old asset (with cache invalidation). The CSP allows images from res.cloudinary.com only.

What the owner creates in Cloudinary: an account (the free plan is fine to start), then from the dashboard's **API keys / Account details** page copy the **cloud name**, **API key** and **API secret**. No upload preset, folder or webhook is needed; assets appear under `food-haus/menu/`. Where each goes in the Cloudflare dashboard: the Worker, **Settings → Variables and Secrets** → add `CLOUDINARY_CLOUD_NAME` and `CLOUDINARY_API_KEY` (type can be plain), and `CLOUDINARY_API_SECRET` as type **Secret**. They are runtime values: **no rebuild is needed**, just save and redeploy/restart if prompted. Keep the secret out of build variables, the repository and the browser.

NOT verified against the real Cloudinary (no account existed when this was written): the code follows Cloudinary's documented signed-upload and destroy endpoints and is tested against a faithful fake that checks our signatures. After the owner adds the three values: upload a phone photo and confirm it appears, comes out upright with no GPS/EXIF (download the original from the Cloudinary console), replace and remove really delete the asset in the console, and check the image URLs return AVIF/WebP. Known limit: if the exact same photo file is uploaded to two items, they share one asset (content-hashed), and removing it from one breaks the other's image until re-uploaded.

Area pages `/areas/<district>`: exist only for districts that are active delivery zones; noindex and not in the sitemap until real local text for the district is added to `AREA_COPY` in `lib/areas.ts`.

## Home page redesign (owner's request) and home page images
The home page is now colour bands with torn edges: ink hero (a full-bleed background photo — burger right, dark smoke left — with the headline, status, buttons and delivery strip over the dark side behind a left-to-right ink gradient; on phones the text comes first on plain ink and the picture sits below it, fading in from the ink; the background layer is right-anchored and capped at 1100 px so the 1024 px source is never stretched soft), cream category tiles (round, linking to each menu section), orange offers band, ink popular photo cards, cream "how it works" with drawn icons, the reviews slot, and a deep-red find-us-and-hours band. All decoration is static inline SVG and CSS (no JavaScript, no carousels, no autoplay; hover lifts respect reduced motion). Measured on the production build: CLS 0.0000, home JS ~121 KB uncompressed (budget 150 KB), Order now visible without scrolling at 360x640, no sideways scroll at 360 px.

Images for it: **Settings → Home page images** in the admin — a hero photo (with a description field), the wide banner above the popular items, and one round photo per category, stored through the same checked, signed Cloudinary upload as item photos (so uploads need the three Cloudinary values). Until something is uploaded, each slot shows its **built-in photo**: images the owner supplied (generated in his own Gemini account), shipped as static files in `public/home/` as AVIF with a WebP fallback and several widths (the hero background, 1024x572, is 22 KB AVIF, well inside the 100 KB budget, R10.5). An admin-uploaded hero replaces the background (delivered as a wide 16:9 Cloudinary crop, so pick a photo with the food on the RIGHT and a dark left side). They are decoration for the home page only and are never attached to a menu item — item photos must show the shop's real food, so item cards keep drawn placeholder art until real item photos are uploaded. A category with no built-in photo (for example a newly created one) falls back to drawn art. An admin-uploaded hero photo's delivered size depends on the photo (Cloudinary f_auto/q_auto at 800 px is typically 40–90 KB): re-check the 100 KB budget then.
