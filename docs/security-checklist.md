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

## Known gaps to close
- [ ] **CSP `script-src` still allows `'unsafe-inline'`** because Next.js injects inline bootstrap scripts into statically prerendered pages. Tighten with hash-based CSP before launch.
- [ ] `npm audit` reports `glob`/`minimatch` highs inside `@opennextjs/aws` build tooling. Build-time only (not bundled into the Worker). Re-check on each OpenNext release; do not run `npm audit fix --force` (it downgrades OpenNext to 0.3.0).
- [ ] KV and D1 cache bindings in `wrangler.jsonc` use local placeholder ids — create the real ones and update the file.

## To build (with the requirement that covers it)
- [ ] Admin auth: argon2id/bcrypt, rate-limited login, `HttpOnly`/`Secure`/`SameSite` cookies, role check on every action (R13.3, R9.1)
- [ ] Two-step login for Owner and Manager — **Must** (R9.2)
- [ ] Password reset: single-use, time-limited, rate-limited, no account enumeration, invalidates sessions (R9.1)
- [ ] Zod validation on every endpoint; CSRF protection on admin actions (R13.4)
- [ ] Server-side price/promo recalculation; browser prices never trusted (R6.14)
- [ ] Stripe webhook: verify `Stripe-Signature` against the raw body, 5-min tolerance, dedupe on event id (R8.4, R8.5)
- [ ] Rate limiting: Cloudflare WAF rules on checkout, promo codes, login; Turnstile on the same (R6.14, R13.13)
- [ ] Cash-order caps per phone and per IP enforced from `settings` (R6.15)
- [ ] Order emails and daily report contain no customer contact details (R9.12, R13.10)
- [ ] CSV export restricted to Owner/Manager (R9.11)
- [ ] Encrypted daily backups; one restore tested and recorded (R13.8)
- [ ] A Kitchen login cannot open any page above its role (acceptance, section 13)
