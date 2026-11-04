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
- [ ] Login/logout/reset pages and server actions; session cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix)
- [ ] Enforce `canAccessPath` in a server layout and `can()` inside every server action
- [ ] 2FA enrolment screen (QR from `otpauth://` URI) and one-time recovery codes
- [ ] Send reset emails; confirm the page always shows the same message
- [ ] Cloudflare Turnstile on login and reset (R13.13)
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
- [ ] Stripe webhook handler (R8.3-R8.5): mark paid only from the signed webhook; must tolerate an order already cancelled by the expiry sweeper
- [ ] Schedule `expireUnpaidOrders` on a Cloudflare Cron Trigger (R8.7)
- [ ] Cloudflare WAF rate-limit rule on `/api/checkout` (R6.14); app-level limits only cover cash orders
- [ ] Order confirmation page `/order/[token]` and confirmation email (R5.5, R6.11)
