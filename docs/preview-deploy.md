# Preview deploy to Cloudflare (no terminal)

Branch: `preview-deploy` (not `main`). It differs from `main` in three ways only: `wrangler.jsonc` has no R2 or Images bindings (so photo upload does not work on the preview), `package.json` has a `cf:ci-build` script, and `scripts/ci-preflight.mts` and `scripts/bootstrap-preview.mts` exist. Everything else is identical.

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
