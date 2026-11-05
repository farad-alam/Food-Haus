# Security checklist (requirements section 13)

Tick every box before launch. Done = exists in the repo today; the rest is still to build.

## Done in the foundation
- [x] HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` on every response (R13.1, R13.5) — `next.config.ts`
- [x] CSP with exact third-party hosts only (Stripe, GA) — `next.config.ts`
- [x] Non-production deployments send `X-Robots-Tag: noindex` and `robots.txt` disallows all (R11.13)
- [x] `/checkout` and `/order/*` are `noindex` + `Cache-Control: private, no-store` (R11.4, R13.15)
- [x] Secrets never in the repo; `.env*` ignored, `.env.example` lists every variable (R13.6)
- [x] JSON-LD output escapes `<` so data cannot break out of the script tag
- [x] Order tokens: 128-bit random, base64url — `lib/token.ts` (R13.15)
- [x] Schema has idempotency key, unique Stripe session id and a Stripe event table (R13.7, R8.5)
- [x] Schema has the audit log and cash-abuse caps (R9.13, R6.15)

## Done: admin authentication core (`lib/auth/`, tested without a database)
- [x] Password hashing, per-hash random salt, constant-time verify, rehash-on-login upgrade (R13.3) — **PBKDF2-SHA256, 600,000 iterations, not argon2id/bcrypt**: neither runs reliably on Cloudflare Workers (see the note at the top of `lib/auth/password.ts`). R13.3 in `docs/requirements.md` is amended to match. The hash format is versioned so it can be upgraded later.
- [x] Password policy: 12–128 characters, common-password blocklist, no email-name reuse
- [x] Two-step login (RFC 6238 TOTP) required for Owner and Manager, with replay protection (R9.2)
- [x] Generic "invalid credentials" for unknown user, wrong password and disabled account, with a dummy hash so timing does not reveal which emails exist
- [x] Lockout keyed per account+IP (5), per IP (20) and per account (50), so a stranger cannot lock the shared Kitchen login out during service
- [x] Sessions: 256-bit random tokens, only the SHA-256 hash stored; Owner/Manager 30-minute idle and 12-hour absolute limits; Kitchen has no idle timeout but expires after 14 days (R9.2)
- [x] Password reset: single-use, 30-minute links, token hash stored, 3 requests/hour/email, identical response whether or not the account exists, weak passwords don't burn the link, success signs out every session (R9.1)
- [x] Role/permission matrix and path rules; unlisted `/admin/*` paths are owner-only (fail closed); dot-segment, encoded and `//` paths are owner-only (R9.1)
- [x] Same-origin (Origin/Referer) check for state-changing requests (R13.4)

## Still to wire up for auth
- [x] Drizzle implementation of `AdminStore` (`lib/auth/pg-store.ts`), TOTP seeds AES-256-GCM encrypted at rest (`SECRET_BOX_KEY`); integration-tested against Postgres
- [x] Login (two-step for owner/manager), logout and password-reset pages + API routes (`/admin/login`, `/admin/forgot`, `/admin/reset/[token]`); session cookie `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix in production (verified in a real browser)
- [x] Authorisation on the server: every admin API route calls `guard(request, permission)` (origin check, session, role), and every admin page calls `requireAdminPage(permission)` itself, not only in a layout. Unlisted admin pages 404. Polling never counts as activity, so an open board cannot defeat the owner/manager idle timeout
- [ ] 2FA enrolment screen (QR from `otpauth://` URI) and one-time recovery codes
- [x] Reset emails sent after the response; the request endpoint returns an identical body for known and unknown emails (needs the email provider configured, see below)
- [x] Turnstile on login and reset requests when `TURNSTILE_SECRET_KEY` is set (login form renders the widget when the site key is set; untested against real Turnstile, same as checkout)
- [ ] Confirm PBKDF2 cost inside the Workers runtime. Measured ~290 ms per hash/verify in Node 22 (staff-only logins, so acceptable); re-measure in `wrangler dev` against the Worker CPU limit

## Known gaps to close
- [ ] **CSP `script-src` still allows `'unsafe-inline'`** because Next.js injects inline bootstrap scripts into statically prerendered pages. Tighten with hash-based CSP before launch.
- [ ] `npm audit` reports `glob`/`minimatch` highs inside `@opennextjs/aws` build tooling. Build-time only (not bundled into the Worker). Re-check on each OpenNext release; do not run `npm audit fix --force` (it downgrades OpenNext to 0.3.0).
- [ ] KV and D1 cache bindings in `wrangler.jsonc` use local placeholder ids — create the real ones and update the file.

## To build (with the requirement that covers it)
- [ ] Zod validation on every endpoint; CSRF protection on admin actions (R13.4)
- [ ] Server-side price/promo recalculation; browser prices never trusted (R6.14)
- [ ] Stripe webhook: verify `Stripe-Signature` against the raw body, 5-min tolerance, dedupe on event id (R8.4, R8.5)
- [ ] Rate limiting: Cloudflare WAF rules on checkout, promo codes, login; Turnstile on the same (R6.14, R13.13)
- [ ] Cash-order caps per phone and per IP enforced from `settings` (R6.15)
- [ ] Order emails and daily report contain no customer contact details (R9.12, R13.10)
- [ ] CSV export restricted to Owner/Manager (R9.11)
- [ ] Encrypted daily backups; one restore tested and recorded (R13.8)
- [ ] A Kitchen login cannot open any page above its role (acceptance, section 13)

## Checkout API (`POST /api/checkout`)
- [x] Strict schema: unknown keys (e.g. a client-sent `total`) rejected; body capped at 16 KB; JSON content type required
- [x] Prices, fees, discounts and totals computed server-side from the database; browser prices never read (R6.14)
- [x] Idempotent by client key, including concurrent double-taps (R13.7); order + lines inserted in one transaction
- [x] Shop paused / closed refused before any write; no opening hours configured = closed (R6.8)
- [x] Promo usage limit reserved atomically; released on failure and when unpaid card orders expire
- [x] Cash caps per phone and per IP (R6.15); IP stored only as an HMAC, taken only from `CF-Connecting-IP`
- [x] Card orders stay `pending_payment`; Stripe session amount equals the stored total; 31-minute expiry (R8.2)
- [x] Turnstile verified server-side when `TURNSTILE_SECRET_KEY` is set; fails closed
- [x] Stripe webhook `POST /api/stripe/webhook` (R8.3-R8.5): signature checked on the raw body (5-minute tolerance) before parsing; paid only from `checkout.session.completed` (when `payment_status` is `paid`) or `async_payment_succeeded`; event ids stored in the same transaction as the change; session id, amount and currency must match the stored order; failure/expiry cancel and release the promo use; a payment for an already-cancelled order is recorded and logged (`PAID ORDER NOT PENDING`) for manual refund
- [ ] In Stripe, add the endpoint `https://<site>/api/stripe/webhook` with those four events plus `checkout.session.expired`, set `STRIPE_WEBHOOK_SECRET`, and test Pay by Bank in test mode (Stripe's docs do not say which event it fires)
- [ ] Alert on the `PAID ORDER NOT PENDING` / `amount mismatch` log lines
- [x] `expireUnpaidOrders` runs every 5 minutes on a Cloudflare Cron Trigger (see "Scheduled maintenance" below) (R8.7)
- [ ] Cloudflare WAF rate-limit rule on `/api/checkout` (R6.14); app-level limits only cover cash orders
- [x] Order page `/order/[token]` (R5.5, R6.12): 128-bit token only (malformed tokens never reach the database), `noindex`, `no-store`, refreshes every 15 s while the order is active; shows no phone, email, address or note
- [x] Order emails (R6.11, R11.10, R13.10): customer confirmation with allergen reminder and private link; shop alert with items and payment but no customer contact details; all customer text HTML-escaped; each email claimed atomically so it sends at most once; failures never affect the order
- [ ] Email provider: `lib/email.ts` uses Resend. Set `EMAIL_API_KEY`, `EMAIL_FROM` (an address on the shop's domain with SPF/DKIM, Q10) and optionally `ORDER_NOTIFY_EMAIL`. Until then emails are skipped with a log line
- [ ] Unknown order tokens return the not-found page with HTTP 200 (streaming); harmless, but revisit if a strict 404 is wanted

## Checkout form (`/checkout`) and quote API (`POST /api/quote`)
- [x] The form shows server-computed prices only (from `/api/quote`, same `priceOrder` as checkout); the browser sends ids, quantities and details, never prices
- [x] Quote requests carry no personal data; strict schema, 8 KB cap
- [x] Promo-code guessing throttled per client (10 failures / 15 min) in both `/api/quote` and `/api/checkout` (R6.14); needs `SECRET_BOX_KEY` set and Cloudflare's `CF-Connecting-IP`
- [x] One idempotency key per distinct order (changes when the basket or details change), so retries and double taps never duplicate an order
- [x] Ordering is disabled with a message while the shop is closed or paused
- [x] Turnstile widget loads only when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set (CSP allows `challenges.cloudflare.com`). Set the site key and `TURNSTILE_SECRET_KEY` together, and test it against real Turnstile: it is untested here
- [ ] "Make it a Meal" (item options) cannot yet be chosen on the menu or in the basket; the API supports options
- [x] Old `auth_event` rows (login and promo counters) are pruned by the scheduled maintenance job

## Admin login and order board (`/admin`)
- [x] Order board feed `GET /api/admin/orders` and actions `POST /api/admin/orders/[id]` (accept with prep time, reject with a customer-visible reason, ready, out for delivery, completed) are authorised, origin-checked and schema-validated on every call
- [x] Status changes are conditional updates, so two tablets cannot both win a tap; a lost race gets a clear 409 and the board refreshes
- [x] `pending_payment` (unpaid card) orders never appear on the board or accept actions (R8.7)
- [x] Rejecting returns the order's promo use in the same transaction; rejecting a paid card order tells staff to refund it in the Stripe Dashboard (refunds are manual for the first release, R8.10)
- [x] Every order action is written to `audit_log` with the user id (R9.13); with the shared kitchen login this is the only record of who did what
- [x] Board polls every 3 s, rings every 4 s while any order awaits acceptance, flashes the card, shows a red "No connection, orders may be missed" bar after 15 s without a successful poll (and a sign-in bar if the session ends), keeps the screen awake after "Start taking orders" (R9.3, R9.6, R13.10)
- [ ] 2FA enrolment screen and recovery codes: today the seed is created with `npm run admin:create` (prints the `otpauth://` URI). Until a screen exists, only the person running that script sees the seed
- [ ] The login throttle keys on `CF-Connecting-IP`; without Cloudflare in front, all requests share one "unknown" bucket (20 failures would lock everyone out). Deploy behind Cloudflare only
- [ ] Unauthenticated page loads of `/admin` return HTTP 200 with a redirect instruction (streaming limitation) rather than a 307. No data is in that response and the API returns 401; a `proxy.ts` redirect could be added if Workers supports it
- [ ] An owner or manager signed out by the 30-minute idle timeout while watching the board will get the sign-in bar and stop hearing orders. The kitchen login has no idle timeout, so run the always-on tablet on the kitchen login

## Shop settings: hours, closures, pause, zones (`/admin/settings`)
- [x] Owner and manager only (`settings.edit`): every route calls `guard()`, kitchen gets 403/404, cross-site writes are refused; all input is schema-validated (strict keys, size-capped)
- [x] Opening hours: up to 3 periods a day, overnight periods allowed, overlaps (including across midnight and the Saturday-to-Sunday week wrap) rejected; the same rules run in the browser and on the server, and match how checkout reads the hours
- [x] No opening hours = closed (nothing is assumed); the page says so and warns when no delivery zone is active
- [x] Closed days override the weekly hours; duplicates and impossible dates refused
- [x] Pause switch with a customer message: applies to the very next checkout (read from the database on every request); owner/manager can pause or resume from the order board or the settings page, kitchen sees the paused banner but cannot change it (spec: kitchen is orders-only)
- [x] Delivery zones by postcode district: validated district, fee and minimum order in whole pence, time 5-180 min; duplicates refused; inactive zones refuse delivery
- [x] Default prep time and cash limits (largest cash order, per-phone and per-IP daily caps) editable
- [x] Every change is written to `audit_log` with before/after in the same transaction as the change (R9.13)
- [x] The public site now shows a "closed, reopens at..." notice and the opening hours on the contact page (see "Closed notice" below). Still open: opening hours in the footer and in the JSON-LD structured data (R11.2)
- [ ] "Site-wide notice bar" and shop contact details (rest of R9.9) are not editable yet

## Menu manager (`/admin/menu`)
- [x] Owner and manager only (`menu.edit`): every route goes through one wrapper that authorises, origin-checks, validates the body (strict keys, size-capped) and maps the result; kitchen gets 403/404
- [x] Create, rename, hide, reorder and delete categories; create, edit, hide, mark sold out, reorder, move and delete items; one option group per category ("Make it a Meal") with extras
- [x] Prices typed in pounds, sent as whole pence (1p to £500); changing a price by more than 3x either way asks "Is that right?" before saving
- [x] The 14 UK allergens as checkboxes with an explicit "Not supplied yet" state (stored as null, never guessed) versus "Confirmed" (a list, possibly empty); the manager shows how many visible items are still missing allergen data (launch blocker, R11.10) and can filter to them
- [x] The public menu shows allergen NAMES, "Allergens: please ask" when not supplied, and "No major allergens declared" when confirmed as none
- [x] Every change is audited with before and after in the same transaction, allergen edits included (R9.13)
- [x] The public menu cache is refreshed after every write with no stale copy served (`revalidateTag("menu", { expire: 0 })`): verified in a browser that price, sold-out, hidden, new items and reordering show on the very next page view. Ordering never uses that cache; checkout and pricing read the database
- [x] Item ids are built from the category's stable slug and the item's stable slug, so renaming a category or an item does not break customers' saved baskets. Moving an item to another category does change its id (a basket holding it will be told it is no longer on the menu)
- [x] Category names must be unique (case-insensitive) because the public menu matches by name; a category with items or an offer cannot be deleted; hidden categories' options never reach the public menu
- [ ] Photo upload with automatic resizing (R9.7) is not built: it needs file storage (Cloudflare R2) that is not set up. Items have no photos yet
- [x] Customers can now CHOOSE options (see "Option picker" below)
- [ ] Option groups attached to a single item (rather than a whole category) are not supported by the menu model or the manager

## Option picker (menu, basket, checkout)
- [x] Items in a category with an option group open a bottom-sheet picker (native `<dialog>`: focus trapped, Escape and outside-click close). Single choice = radio buttons (with "No thanks" when optional), multiple choice = checkboxes that stop at the maximum; Add stays disabled until the required minimum is met; price previews update live
- [x] The picker's rules live in one pure module and a test checks them against the real pricing engine for every possible selection of seven group configurations: the browser never offers what the server refuses, never blocks what it accepts, and the previewed price equals the charged price
- [x] Basket lines carry their chosen options: the same item with and without options are separate lines, identical choices merge, quantities change per line; saved baskets from before options existed still load
- [x] Checkout, the quote API and the order all use the options: the server prices them again from the database and stores each option's name and price on the order line (verified in a browser: £41.45 order with a meal and pizza toppings reached the database with correct options and totals); the order page, emails and kitchen board already showed options
- [x] A stale option (the owner renamed or removed it after the customer added it) shows "Unknown option for ..." and cannot be ordered at a wrong price; the line can be removed
- [ ] The seeded "Make it a Meal" option is named "Meal (fries + drink — contents TBC with owner)": placeholder text from the print-menu extraction that customers would now SEE. The owner must confirm the contents and rename it in the Menu manager before launch. (Renaming an option changes its id, so anyone with the old option in their basket is asked to re-add it)
- [ ] Test note: Next.js reuses its cached copy of the menu across builds for up to an hour, so after changing menu data directly in the database, delete `.next` before building (a normal deployment builds fresh)

## Offers and promo codes (`/admin/offers`)
- [x] Owner and manager only (`offers.edit`); every change authorised, origin-checked, strictly validated, and audited with before/after in one transaction (R9.13)
- [x] The four types in R6.7: percentage, fixed amount, free delivery, buy-one-get-one on a category; each with channel (any / delivery / collection), minimum spend, start and end, usage limit, optional promo code, and "show on website"
- [x] Combinations the pricing engine would silently ignore are refused (e.g. free delivery limited to collection; a percentage outside 1-100; a category on a non-bogof offer; end before start)
- [x] Start and end are entered in UK time and converted on the server with daylight-saving rules (the hour skipped in March is refused; the repeated October hour resolves to the earlier instant)
- [x] Promo codes are 3-20 letters/numbers, stored upper-case, and unique ignoring case, enforced by a database index as well as the app (race-safe). Guessing is throttled (see checkout)
- [x] The admin list shows status (active / scheduled / ended / used up), what the offer does in the same words customers read (one wording function shared with the website), and how many times it was used. Usage counts reservations made at checkout; they are released when an unpaid card order expires or an order is rejected
- [x] A used offer cannot be deleted (orders keep a reference to it); "End now" stops it instead
- [x] Public site is live: the home-page strip, `/offers` and the menu's category badges read the offers table instead of hard-coded text. Only offers marked "show on website" are published, and only while running: the cache holds the raw list (expired instantly on every admin save) and the running/ended decision is made at request time, so an expired offer cannot linger
- [x] Integration tests show saved offers drive the real quote and checkout code (codes in any case, minimum spend, channel, scheduling, editing dates, a usage limit enforced by a real checkout, automatic bogof scoped to its category); a browser run covered create, duplicate code, checkout discount, usage, End now, scheduling, hide/show
- [ ] A promo code marked "show on website" is printed publicly; the form warns the owner. Codes meant for specific people should leave that box unticked
- [ ] Offers do not stack: a customer gets one offer per order (the typed code, or the best automatic one). The form says so. Combining offers would be a pricing-engine change
- [ ] Offers are not limited per customer (one use per phone number or email); only a total usage limit exists

## Scheduled maintenance (Cloudflare Cron Trigger)
- [x] Every 5 minutes: unpaid card orders older than 45 minutes are cancelled and their promo use released (so abandoned checkouts never linger or hold a limited offer); old throttling counters (2 days), sessions (1 day after expiry), dead reset links (1 day after expiry) and Stripe event ids (60 days) are deleted. Each step runs on its own and failures are reported
- [x] Live orders are never touched: cash orders, paid orders, and card orders still inside the 45-minute window (a Stripe session itself expires at about 31 minutes). Running the job twice changes nothing and never releases a promo twice
- [x] `POST /api/cron/maintenance` is protected by `CRON_SECRET` (Bearer, constant-time compare). With no secret (or one under 16 characters) it refuses everything with 503, so it can never be left open; wrong or missing credentials get 401 and do no work; GET is 405. The response contains counts only
- [x] `cloudflare/worker.ts` wraps the OpenNext worker and adds the `scheduled` handler, which calls that route through the same worker; a non-2xx response or a missing secret makes the cron run FAIL visibly in Cloudflare's logs. `wrangler.jsonc` has `"main": "cloudflare/worker.ts"` and `"crons": ["*/5 * * * *"]`
- [ ] **Deployment steps (not testable here, needs your Cloudflare account):** run `openssl rand -base64 32 | wrangler secret put CRON_SECRET` (for production AND preview), deploy, then in the Cloudflare dashboard open Workers > food-haus > Triggers and confirm the cron appears and its first runs succeed. The custom worker entry was verified against a fake worker and the route against the real database, but not on Cloudflare's own runtime: do one preview deploy and look at the cron logs before relying on it
- [ ] The daily sales report (R9.12) will add a second cron
- [ ] Personal data retention (R13.12: anonymising old orders' contact details) is not scheduled yet

## Closed notice and public opening hours (R6.8, R5.1, R5.6)
- [x] One pure module (`lib/shop-status.ts`) decides open / paused / closed and when ordering reopens; the website banner, the checkout button, and the quote and checkout API messages all use it, so they cannot disagree
- [x] When ordering is not possible a banner under the header on every public page says why and when it reopens ("We are closed right now. Ordering opens today at 12pm", "tomorrow at...", "Friday at...", "Monday 16 Nov at..."; closure days with their reason; the owner's own message when paused), and says the menu can still be browsed and the basket filled. It is hidden on checkout (which says the same on the form and on its button: "Ordering opens today at 12pm" / "Orders are paused") and on order-tracking pages
- [x] Without opening hours the site says "We are not taking orders right now" and never invents a reopening time; it looks at most two weeks ahead
- [x] The home page shows "Open now, taking orders until 11pm" while open
- [x] The contact page shows the weekly opening hours from the admin settings (nothing is published until the owner has entered them)
- [x] Whether the shop is open right now is computed at request time from the clock; only the raw schedule is cached (expired at once by every admin save of hours, closed days or the pause switch). A page therefore cannot say "open" after closing time, and pausing shows on the very next page view (browser-verified)
- [ ] Opening hours are not yet in the footer or in the JSON-LD structured data (R11.2, R5.1 "hours, address and map" block)
