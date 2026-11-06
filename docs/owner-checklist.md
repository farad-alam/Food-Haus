# Food Haus: everything needed before we deploy

Compiled 6 November 2026 from the code, the requirements (`docs/requirements.md`) and the detailed notes in `docs/security-checklist.md`. Nothing below has been guessed: where the owner has to decide or supply something, it is listed here and, in the site, shown as a clearly marked placeholder or left empty.

**Where things stand.** Every Must-have in the requirements that can be built and tested without the owner's information or a real Cloudflare account is built (525 automated tests pass; the main flows were also run in a real browser). What is left is in four groups: **A** things only the owner can decide or supply, **B** accounts, keys and settings to create, **C** things that can only be checked once it runs on the real services, and **D** features not built (all Should or later, or small optional extras). We are stopping before the deploy step itself.

---

## A. Decisions and information only the owner can provide

### A1. Business details (R11.11, privacy and terms pages)
- [ ] Exact **legal name** of the business (nothing is shown in the footer until you enter it; no name is guessed)
- [ ] **Companies House number**
- [ ] **Registered office address**
- [ ] **VAT number**, or confirmation the business is not VAT registered (Q2). The menu already says "Prices include VAT"; this must be true
- [ ] **ICO registration number**, if the business is registered with the Information Commissioner's Office (an adviser can say whether it must be)
- [ ] Enter these in the admin under **Settings, Shop and company details** (they are stored in the database, no code change). They then appear in the footer. Before setting `LEGAL_APPROVED = true`, run `npm run contact:check`: it exits 1 until the details have been saved once and the legal name, Companies House number and registered office are filled in
- [ ] Check the **shop address, phone number and email** in **Settings, Shop and company details**, then press Save once to confirm them. They start from the Google Maps listing (address 314-318 Selbourne Road, Luton LU4 8NU; phone 07438 795428; email `FoodHausfoodhaus72@gmail.com`) and must match your Google Business Profile exactly (R11.5). They appear in the footer, contact page, structured data, order emails and receipts. The **TikTok link** is still in `lib/shop.ts`
- [ ] Optional: the shop's **latitude and longitude** for search-engine structured data (not added, because it must not be invented)

### A2. Decisions
- [ ] **How long to keep customers' contact details (R13.12):** the requirements suggested **24 months** (Q9); you asked for **12 months** and that is what is built. It is one constant, `CONTACT_RETENTION_MONTHS` in `lib/retention.ts`. The wording on the privacy page must match whichever you choose. It is a business and legal decision, not a technical one
- [ ] **Cash orders (Q6):** is there a maximum order value for cash? (Setting exists; no cap is set.) Daily limits per phone number and per connection are 3 and 5 by default
- [ ] **Later-time orders (Q5):** not at launch (as-soon-as-possible only). Confirm
- [ ] **Halal wording (Q4):** exactly what may the site claim, and is there a certifying body? Until answered the site says "Halal" and the terms page has a placeholder
- [ ] **Staff accounts (Q7, Q8):** how many owners/managers, and which device sits in the kitchen for the order board? (Plan: owner, one manager, one shared kitchen login on a tablet)
- [ ] **Should the Google reviews block wait for cookie consent?** Today it loads without asking, which discloses the visitor's IP address to Google. Your adviser should decide; if yes it is a small code change
- [ ] **Should ordering be blocked in production until every allergen is entered?** Today the shop can take orders while allergen data is missing (customers are told to ask). A small code change if you want it blocked
- [ ] **Domain (Q3):** is there an existing Food Haus website or domain to redirect, or is a new domain being registered? Which exact web address is canonical (with or without `www`)?
- [ ] **Order email sender (Q10):** an address on the shop's own domain (not Gmail) and access to that domain's DNS settings
- [x] **Shop contact details in the admin (R9.9):** built. Edit them under Settings; no code change or redeploy is needed

### A3. Menu and shop data (entered by the owner in the admin; the site goes live with whatever is there)
- [ ] Check **every price, name and description**. The database holds the 38 items from the print menu as **sample data**, which carries the print typos (for example the meal option is named "Meal (fries + drink — contents TBC with owner)")
- [ ] **What is in "Make it a Meal"**, and a proper name for it. It cannot get allergen information until its contents are known
- [ ] **Opening hours** per weekday, bank holidays and closed days (Settings). Nothing is shown (footer, contact page, structured data, open/closed status) until entered, and the shop shows as closed until then
- [ ] **Delivery zones** (postcode districts such as LU1 to LU4) with fee, minimum order and estimated time (Settings). Delivery is refused everywhere until zones exist
- [ ] **Default preparation time**, and the **notice bar** if wanted
- [ ] **Offers and promo codes** if any at launch
- [ ] **Photos** for the menu items, with a short description of each for screen readers (otherwise the item name is used). Photos should be at least 1200 x 900 pixels, JPEG, PNG or WebP
- [ ] A photo-led **share image** (replaces the simple branded card `public/share.png`), optional but better for links shared on WhatsApp and social media
- [ ] Stripe, Google and GA4 accounts in the **owner's name** (see B)

### A4. Allergen data: safety-critical, nothing is guessed
The site shows **no** allergen claim for any item until the owner has entered it for that specific item. Currently **38 of 38 items and 1 option have none entered** (run `npm run allergens:check` for the live list). The owner must enter, in the menu manager, for every item and for the "Make it a Meal" option: "I have checked", then tick what it contains (ticking nothing means "contains none of the 14", so only confirm that after checking every ingredient). Items by category: Burgers 10, Wings 7, Wraps 4, Loaded Fries 4, Tenders 7, Sides 6.
- [ ] All 38 items entered
- [ ] The Meal option entered (after its contents are decided)
- [ ] `npm run allergens:check` prints "OK"
- [ ] The yellow "Allergen information is NOT complete" bar has disappeared from the admin
- [ ] Someone who knows the recipes and suppliers has done this, and there is a routine for updating it when a recipe or supplier changes

### A5. Wording for the legal and allergen pages (54 placeholders)
Every one of these is shown on the live page as an amber **PLACEHOLDER** box and has to be decided by the owner or their adviser. Facts about how the site works are already written; these are the decisions. When all are filled in and the owner has read and approved the pages, set `LEGAL_APPROVED = true` in `lib/legal.ts` (one switch for all four pages). Until then the pages carry a DRAFT notice, are hidden from search engines and left out of the sitemap; a test refuses the switch while any placeholder remains.

#### Privacy Policy (/privacy): 24 decisions

1. [ ] Date this policy was last updated _(Add once the owner approves the final wording.)_
2. [ ] Legal name of the business, Companies House number and registered office address (the data controller) _(Enter the confirmed details in Settings (Shop and company details): the site footer shows nothing for them until then (R11.11).)_
3. [ ] ICO registration number, if the business is registered with the Information Commissioner's Office _(The owner or their adviser decides whether a registration applies.)_
4. [ ] Legal basis for each use of personal data (for example contract, legal obligation, legitimate interests) in the wording the owner's adviser approves
5. [ ] Payment provider name _(Expected: the provider the checkout uses today. Confirm.)_
6. [ ] Country and transfer safeguard wording
7. [ ] Hosting provider name _(Expected: the provider in the hosting plan. Confirm.)_
8. [ ] Country and transfer safeguard wording
9. [ ] Database provider name _(Expected: the provider in the hosting plan. Confirm.)_
10. [ ] Country and transfer safeguard wording
11. [ ] Email provider name _(Expected: the provider in the email set-up. Confirm.)_
12. [ ] Country and transfer safeguard wording
13. [ ] Bot-check provider name _(Confirm whether it is switched on for the order form.)_
14. [ ] Country and transfer safeguard wording
15. [ ] Google entry wording _(Loading Google's reviews discloses your internet address to Google. Decide wording, and whether it should wait for cookie consent.)_
16. [ ] Country and transfer safeguard wording
17. [ ] Analytics provider name
18. [ ] Country and transfer safeguard wording
19. [ ] Statement on whether we ever sell or share data for marketing, and on authorities or legal requests _(Legal decision.)_
20. [ ] Retention wording for each type of data, including how long accounting records must be kept _(Retention periods are a legal and business decision. The 12 months above is a setting in the code, not a statement of what the law requires.)_
21. [ ] Retention of backups, email provider logs and card-payment records held by the payment provider
22. [ ] Exact wording of the rights, the time we have to reply, and any limits that apply _(Needs the owner's adviser's review. The sentence above is a plain summary, not approved legal wording.)_
23. [ ] Contact email or postal address for privacy requests _(The shop's general contact details are not assumed to be the right place for data requests.)_
24. [ ] Name of a data protection contact, if the business appoints one

#### Cookie Policy (/cookies): 7 decisions

1. [ ] Cookie names and lifetimes the payment provider sets _(List from the provider's own documentation.)_
2. [ ] Cookie names and lifetimes, or confirmation none are set
3. [ ] Wording on why these are exempt from consent _(Legal wording for the owner's adviser to approve.)_
4. [ ] Decision: should Google reviews wait for cookie consent, and the wording about what Google sets _(Currently they load without waiting. This is flagged in the security checklist.)_
5. [ ] Lifetime, taken from Google's current documentation
6. [ ] Analytics provider wording, what is collected, and any data sharing settings the owner chooses
7. [ ] Contact for questions about cookies

#### Terms & Cancellation (/terms): 19 decisions

1. [ ] Date these terms were last updated, and which version applies to orders already placed _(Add once the owner approves the final wording.)_
2. [ ] Legal name of the business, Companies House number, registered office address and VAT number if registered _(The same details as the privacy policy and the site footer (R11.11).)_
3. [ ] Who these terms apply to (for example consumers ordering for personal use) and anything excluded, such as large or catering orders
4. [ ] Legal wording on when the contract between you and the business is formed (when the kitchen accepts the order, not when you press the button) and on the shop's right to decline
5. [ ] Statement on VAT (the menu currently says prices include VAT) and whether the business is VAT registered
6. [ ] Legal wording for offer conditions, misprinted prices and who can use an offer
7. [ ] What happens if nobody answers the door or the address is wrong, and who is responsible for delays _(Business and legal decision.)_
8. [ ] Shop address and phone shown for collection and for problems with delivery _(Contact details are confirmed by the owner, not assumed.)_
9. [ ] Payment provider's terms to be referred to, wording about failed or disputed payments, and any card surcharge (the site has none today)
10. [ ] Legal wording on allergens, cross-contamination and the business's responsibility
11. [ ] Wording of the halal claim and the certifier, if any _(Needs the owner's confirmation of what can truthfully be said (open question Q4).)_
12. [ ] The cancellation policy: whether and until when a customer may cancel an accepted order, and what happens once cooking has started
13. [ ] Statement on the right to cancel for food that is made to order or quickly goes off, in the wording the owner's adviser approves _(UK consumer law has an exception for goods that spoil quickly. Whether and how it applies here is a legal decision.)_
14. [ ] How to contact the shop to cancel (phone number, hours)
15. [ ] The refund policy: when a full or partial refund or replacement is given, evidence needed, time limit for reporting problems, and how long a refund takes to reach your account
16. [ ] How to make a complaint, and who deals with it
17. [ ] Limits on liability, in the wording the owner's adviser approves _(Must not exclude anything the law does not allow to be excluded.)_
18. [ ] Governing law and which courts apply
19. [ ] How these terms and our Privacy Policy and Cookie Policy relate, and how changes to the terms are announced

#### Allergen page wording (/allergens): 4 decisions

1. [ ] Date the allergen information was last checked by the owner
2. [ ] Cross-contamination statement: whether and how the kitchen can avoid traces of allergens, shared fryers and equipment, and what customers with severe allergies should do _(Legal and food-safety decision. This must be true of the real kitchen.)_
3. [ ] Wording about recipe or supplier changes and how allergen information is kept up to date
4. [ ] Phone number and times to call about allergens _(Contact details are confirmed by the owner, not assumed.)_

**Total: 54 placeholders.**

### A6. Staff
- [ ] A **30-minute walkthrough** with the owner (R9.14), using `docs/daily-routine.md` (one page for the counter)
- [ ] Each owner and manager has a phone with an authenticator app, and saves their **recovery codes** somewhere safe
- [ ] Staff told not to type customers' names into rejection reasons (those are not wiped by the 12-month clean-up)

---

## B. Accounts, keys and settings to create

### B1. Secrets and keys (set as Cloudflare secrets with `wrangler secret put`, never in the repository)
| Name | What it is | Where it comes from |
| --- | --- | --- |
| `DATABASE_URL` | Neon Postgres connection string (pooled) for the **production** database | Neon console. Use a new production database, not the test one used while building |
| `SECRET_BOX_KEY` | Encrypts two-step-login secrets: `openssl rand -base64 32` | Generate once and **keep a copy in the password manager**: losing it locks every owner and manager out of two-step login |
| `STRIPE_SECRET_KEY` | A **restricted** live key limited to what the site needs (R8.8) | Stripe Dashboard. Test keys only in preview |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the webhook endpoint | Stripe, after adding the endpoint (B2) |
| `EMAIL_API_KEY` | Resend API key | Resend |
| `EMAIL_FROM` | Sender, an address on the shop's own domain, e.g. `Food Haus <orders@yourdomain>` | Needs SPF and DKIM on that domain |
| `ORDER_NOTIFY_EMAIL` | The shop inbox that gets a copy of each new order (R13.10). Optional but recommended: it is the backup if the board loses connection | Owner |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret | Cloudflare dashboard |
| `CRON_SECRET` | Shared secret for the scheduled clean-up job. Generate with `openssl rand -base64 32` and store with `wrangler secret put CRON_SECRET`, for production **and** preview | Generate |

### B2. Build-time public values (`NEXT_PUBLIC_*`: fixed when the site is **built**, so set them in the build environment, not only on the Worker)
| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | The final web address, e.g. `https://www.example.co.uk` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Turnstile site key |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Restricted Google key (B4) |
| `NEXT_PUBLIC_GOOGLE_PLACE_ID` | The shop's Google Place ID |
| `NEXT_PUBLIC_GOOGLE_REVIEW_URL` | Optional "write a review" link (https, Google domains only) |
| `NEXT_PUBLIC_GA_ID` | GA4 measurement ID, `G-XXXXXXXXXX`. Without it there is no cookie banner and no analytics |
| `APP_ENV` | `production` for the live site (only production is indexable), `preview` otherwise (already set in `wrangler.jsonc`) |

Not needed yet: `NEXT_PUBLIC_SANITY_*` (the blog is not built) and `EMAIL_API_URL` (testing only; leave empty).

### B3. Accounts and services
- [ ] **Cloudflare:** account on the **Workers Paid** plan; the domain added; HTTPS/HSTS and "always use HTTPS"; the production and preview Workers
- [ ] **Neon:** a production project in a London or nearest EU region; **daily backups on and a restore tested once** (R13.8, required before launch); then run the database migrations (`npm run db:migrate`, migrations 0000 to 0006) and load the sample menu once (`npm run db:seed`)
- [ ] **Stripe:** live account; **Pay by Bank** and cards enabled; add the endpoint `https://<site>/api/stripe/webhook` with the events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and `checkout.session.expired`; copy its signing secret; test Apple Pay and Google Pay and Pay by Bank in test mode first; make one real low-value payment and refund it (refunds are done by hand in the Stripe Dashboard); statement name "FOOD HAUS" (R8.9)
- [ ] **Resend:** the shop's domain verified with SPF and DKIM
- [ ] **Cloudflare Turnstile:** a widget for the site (checkout, promo codes, admin login)
- [ ] **Google Analytics 4:** a property, with the measurement ID
- [ ] **Google Search Console:** the site verified and `/sitemap.xml` submitted (R11.7)
- [ ] **Google Business Profile:** the listing's name, address and phone match the site exactly (R11.5)

### B4. Google Cloud setup (for the reviews block, R7)
- [ ] Create a Google Cloud project and an **API key**; enable **"Maps JavaScript API"** and **"Places API (New)"**
- [ ] **Restrict the key** by website address (the live domain and the preview domain) **and** by those two APIs (R7.5); never a wildcard on all of Google
- [ ] Set a **billing alert** (each reviews element load is billed; lazy loading means only visitors who reach the block count)
- [ ] Find the **Place ID** with Google's Place ID finder
- [ ] The reviews block has **never been seen with real data** (no valid key was available): check the real rating and reviews match the Google Maps listing on the preview site (the R7 acceptance test)

### B5. Cloudflare R2 bucket and Images (menu photos)
- [ ] `wrangler r2 bucket create food-haus-photos` (the name in `wrangler.jsonc`; change both together if different)
- [ ] The **Images binding** enabled on the account (it resizes uploads); check its pricing and free allowance
- [ ] Both bindings are already declared in `wrangler.jsonc` as `PHOTOS` and `IMAGES`. In production a missing binding makes uploads fail with an error; it never quietly saves to local disk
- [ ] Add a Cloudflare **Cache Rule for `/media/*`** if photos are not cached at the edge (check for `cf-cache-status: HIT`)

### B6. `wrangler.jsonc` status
- [x] **Fixed:** the file was not valid (a missing comma before the cron block), so the Cloudflare build and every deploy would have failed. It now parses and `opennextjs-cloudflare build` completes (`.open-next/worker.js`)
- [ ] **Still to do:** the two cache bindings use **placeholder ids**: create them (`wrangler kv namespace create NEXT_INC_CACHE_KV`, `wrangler d1 create food-haus-tag-cache`) and paste the real ids over `local-placeholder-replace-before-deploy`. Without real ids the deploy will not work and menu edits will not refresh the public pages
- [ ] Check the Worker name, the production environment name, and that routes or a custom domain are attached (none are configured in the file)
- [ ] `"triggers": { "crons": ["*/5 * * * *"] }` is present; it needs `CRON_SECRET` (B1)

### B7. Edge rules and redirects (Cloudflare settings, not code)
- [ ] **Rate-limit rules** (WAF) on `/api/checkout`, the promo-code endpoint and `/api/admin/login` (R6.14, R13.13). The app limits cash orders and logins itself, but not card checkout
- [ ] **One canonical address (R11.14):** redirect plain HTTP, the other host (with/without `www`) and any old Food Haus domain to the canonical address with a 301. Not in the code, because the domain is not decided
- [ ] The admin login limit is keyed on Cloudflare's visitor-IP header, so the site must only be reached **through Cloudflare** (otherwise 20 failures from anyone lock everyone out)

### B8. First accounts
- [ ] Create the owner: `ADMIN_PASSWORD=… SECRET_BOX_KEY=… DATABASE_URL=… npm run admin:create -- owner@example.com owner`; it prints a **one-time setup link** (24 hours). Open it yourself first, with the password, before anyone else has access. Send the link and the password by **different channels**
- [ ] Then the manager (`manager`) and the kitchen login (`kitchen`, no two-step login). `npm run admin:setup-link -- <email>` issues a new link; add `--reset` for someone who lost both phone and recovery codes
- [ ] The first owner's password is 12+ characters and not the example

---

## C. Can only be checked once it runs on real services (after the first deploy)
Everything here was tested as far as it can be without the real service (fakes, Cloudflare's local simulator, or a real browser against a local build). None of it has run on Cloudflare itself.
- [ ] **The scheduled job on Cloudflare's runtime:** the cron handler has been tested in code but never run on Cloudflare. After deploying, confirm a run in the Cloudflare dashboard succeeds every 5 minutes (unpaid card orders cancelled after 45 minutes, old counters tidied, daily sales email, 12-month contact clean-up)
- [ ] **The real Google reviews** (B4)
- [ ] **R2 and Images, for real:** upload a phone photo with a rotation and GPS tag: it must come out the right way up, centred, with **no GPS or EXIF**, as a small WebP; check the real Images service's limits with an 8 MB, 12-megapixel photo; confirm replacing and removing a photo deletes the objects in the bucket; confirm the `PHOTOS` and `IMAGES` bindings resolve inside the deployed app (the whole app was not run on Cloudflare's runtime here); confirm `/media/...` is cached at the edge
- [ ] **The whole app on Cloudflare's runtime:** a full pass through browse, basket, checkout (cash and card), order page, admin login with two-step, order board, menu and settings
- [ ] **Two-step login speed on Workers:** password checking measured about 290 ms in Node; re-measure against the Worker CPU limit (staff logins only)
- [ ] **Stripe end to end in test mode,** including Pay by Bank (Stripe's documentation does not say which event it sends) and Apple Pay / Google Pay; webhook delivered and the order marked paid; alerts on the log lines `PAID ORDER NOT PENDING` and `amount mismatch`
- [ ] **Order emails really arrive** (customer confirmation, shop alert, daily sales report) from the shop's domain, not in spam
- [ ] **GA4:** with `NEXT_PUBLIC_GA_ID` set in the build, events (view_menu, add_to_cart, begin_checkout, purchase, promo_applied, click_call, click_directions) show in GA4's real-time report only after pressing Accept
- [ ] **Lighthouse and real-phone checks** (R10.11): the performance budgets, accessibility, and the order board on the actual kitchen tablet (sound, wake lock, reconnect bar)
- [ ] **Backup restore** tested once (B3)
- [ ] **Search Console:** sitemap read, structured data valid in Google's Rich Results Test (R11.2)
- [ ] **The content-security policy** still allows inline scripts because the framework needs them; tighten with hashes before or soon after launch
- [ ] `npm audit` shows high-severity notes in build-time tooling only (not shipped in the Worker); re-check before each deploy and do not run `npm audit fix --force`
- [ ] Alerts and monitoring: an uptime check and error tracking are **not set up** (R13.14, Should)

---

## D. Not built (so nobody expects it at launch)
**Must-have items not built:** none that can be built without the owner's information or a real deployment. Everything in the requirements marked Must is either built or is on this list for the owner or the deployment.

**Should-have or later, not built:** `/about` page; local area pages and the blog (R5.7 to R5.9, R11.6); later-time ordering (Q5); an admin Refund button (refunds are done in Stripe); per-customer limits on offers and stacking offers; option groups for a single item rather than a whole category; card fees, refunds and VAT in the daily report; a scheduled sweep for unused photo files; error tracking and uptime monitoring.

**Known limits worth knowing:** unauthenticated visits to `/admin` return HTTP 200 with a redirect instruction rather than a 307 (no data is in it); unknown order links show "not found" with HTTP 200; an owner or manager signed out by the 30-minute inactivity timeout on the board stops hearing orders (the always-on kitchen login has no timeout, so run the board on that); the daily-report and history screens are read-only.

---

## E. The order to do it in
1. Owner answers section A2 and supplies A1 and the business facts.
2. Create the accounts and keys (B). Create the real KV and D1 ids and put them in `wrangler.jsonc` (B6).
3. Fill in the 54 placeholders with the adviser, enter the company details in Settings, run `npm run contact:check`, then set `LEGAL_APPROVED = true`.
4. In the admin, the owner confirms the shop and company details, checks prices, enters hours, zones and photos, and enters **every** allergen. `npm run allergens:check` says OK.
5. Deploy to a **preview** address first (`APP_ENV=preview`: hidden from search engines), and work through section C.
6. Only then point the real domain at it and switch to `production`.
