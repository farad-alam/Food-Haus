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
- [ ] Schedule `expireUnpaidOrders` on a Cloudflare Cron Trigger (R8.7)
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
- [ ] Prune old `auth_event` rows (login and promo counters) on a Cron Trigger

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
