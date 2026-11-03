# Food Haus Direct — Website Build Requirements

Oct 26, 2026 · @MotionBite · Revised 3 Nov 2026: security fixes (order-page tokens, 2FA, cash-abuse caps, audit log), hosting moved to Cloudflare, SEO requirements added after keyword research, and the print menu received (halal confirmed)

## 1. Project overview

Food Haus needs its own ordering website so customers order direct instead of through Uber, which takes about 30% of every order. This document is the single source of requirements for the developer. Each requirement has an ID (for example R6.3) and a priority: **Must** ships in the first release, **Should** ships if time allows, **Later** is parked.

| Item | Detail |
| --- | --- |
| Client | Food Haus Ltd, burger takeaway, 314–318 Selbourne Rd, Maidenhall, Luton LU4 8NU |
| Problem | 70–80% of orders arrive through Uber promotions; Uber's commission is about 30% |
| Goal | A phone-friendly site where a customer lands, sees the menu and offers, and pays in a few taps |
| Payments | Card or bank payment through Stripe, plus cash on delivery |
| Brand | Black and orange (orange #F47B20, taken from the Food Haus Google Maps menu image) |
| Delivery mode | Supersonic: 2–3 weeks to launch |
| Built by | MotionBite (motionbite.com), with the MotionBite developer |

**How we will know it works.** From launch day we track four numbers: direct orders per week, share of orders paid by card versus cash, visit-to-order conversion rate, and mobile page speed. Business targets are agreed with the owner after the first 30 days of live data.

## 2. Build principles

Three rules override every other decision in this document. When a feature or a design choice fights one of them, the rule wins.

| Principle | What it means for the build | How it is checked |
| --- | --- | --- |
| Mobile-first and superfast | Design and code for a 360 px phone first, then enlarge for tablet and desktop. Ship the least JavaScript that works. Every image, font and script has to earn its weight. | Performance budgets in section 10, measured on every release |
| Google reviews on the site | The Google star rating, review count and recent reviews appear on the home page, with Google's required attribution. | Section 7 acceptance checks |
| Straight-forward | A visitor lands, sees the menu and offers, and orders. No account needed, no pop-ups blocking the menu, no hidden steps. | A guest completes an order in three screens or fewer: basket, details, payment |

**Always-on rules that follow from these.**

- One primary action, "Order now", is visible on every public page without scrolling on a phone.
- No autoplay video, no full-screen carousels and no pop-ups before the visitor has seen the menu.
- Buttons use black text on orange. White text on the brand orange (#F47B20) scores about 2.7:1 contrast; black text scores about 7.7:1.

## 3. Scope of this build

The build delivers a working ordering website and admin panel in 2–3 weeks (Supersonic mode), counted from the advance payment and receipt of the client inputs in section 14. The wording below matches the signed agreement.

| In this build | Not in this build |
| --- | --- |
| Public website: Home, Menu, Offers, About, Contact, area pages such as "Burgers in LU4" | Rider app and live delivery tracking |
| Online menu, basket, checkout, delivery and collection with delivery zones | Loyalty points |
| Card or bank payment through Stripe, and cash on delivery | Printer or till link |
| Admin panel: menu, prices, offers, promo codes, opening hours, delivery zones | Mobile app |
| Live order board with sound alert and status updates | Several branches |
| Order emails to customers and a daily sales report to the owner | Paid ads and social media management |
| Google reviews and star rating shown on the site | Content beyond what is agreed (extra articles, photo or video shoots) |
| Secure hosting, SSL, backups, allergen, privacy and cookie pages, Google Analytics | Any new feature not listed here (quoted separately) |

**Handled by others, not by the developer.** The Google Business Profile clean-up, listings and the 3-month Local SEO programme (keyword research, 2 local articles a month, monthly ranking report) are run by the MotionBite SEO lead. The developer only supplies the technical hooks in section 11.

## 4. Users and key journeys

Four kinds of people use the site. Customers are phone-first; staff use a phone or tablet in the kitchen. Design each journey for its main device.

| User | Main device | Arrives from | Goal | Path that must be effortless |
| --- | --- | --- | --- | --- |
| New customer | Phone | Google Maps, Google search, TikTok, word of mouth | Find something to eat and order it | Home → Menu → add items → basket → details → pay → confirmation |
| Returning customer | Phone | Saved link, Google Maps "Order online" button | Reorder quickly | Menu → add items → checkout with details remembered on the device |
| Owner or manager | Phone, tablet or laptop | Admin login | Change menu, prices, offers, hours; see sales | Login → edit item → save → live on the site within seconds |
| Kitchen staff | Tablet or phone, kept on | Admin login, order board | Spot, accept and prepare new orders | New order alert → accept → set prep time → mark ready or out for delivery |

**Customer journey rules.**

- The Google Maps "Order online" button deep-links to the menu page (the Maps clean-up is done by the SEO lead).
- A customer can order as a guest. No account, no password and no email confirmation step.
- After a customer's first order, name, mobile and delivery details are remembered on the device (local storage) to speed up the next one.

## 5. Pages and content

The public site has seven core pages plus legal pages. All copy is British English (`lang="en-GB"`) and all prices are in pounds (GBP), shown including VAT.

| ID | Path | Purpose | Must contain | Priority |
| --- | --- | --- | --- | --- |
| R5.1 | `/` | Home: convert a visit into an order | Hero with "Order now" button, open or closed status, Google rating badge; today's offers; six popular items; Google reviews; delivery and collection summary; opening hours, address and map link | Must |
| R5.2 | `/menu` | Browse and order | Sticky category tabs, item cards with photo, price, short description, allergen icons, add button; sticky basket bar | Must |
| R5.3 | `/offers` | Show every live offer and promo code | Offer cards with end date, code and "Order now" | Must |
| R5.4 | `/checkout` | Take the order | Section 6 | Must |
| R5.5 | `/order/[token]` | Confirmation and live status | Order number, items, total, status line, contact number. The URL uses a long random token (R13.15), never the sequential order number, so order pages cannot be guessed or enumerated | Must |
| R5.6 | `/contact` | Reach the shop | Address, phone, hours, delivery area, "Get directions" link, WhatsApp or call button | Must |
| R5.7 | `/about` | Short brand story | Two short paragraphs, photos, TikTok link (@mia.bhai43) | Should |
| R5.8 | `/areas/[slug]` | Local SEO landing pages (for example "Burgers in LU4") | One reusable template filled by the SEO lead, with menu teaser and Order now button | Should |
| R5.9 | `/blog` | Home for the monthly local articles | Article list and article template; articles published by MotionBite in Sanity Studio | Should |
| R5.10 | `/allergens`, `/privacy`, `/cookies`, `/terms` | Legal pages | Allergen grid for every item, privacy policy, cookie policy, terms with cancellation and refund policy | Must |
| R5.11 | `/admin/*` | Staff area | Section 9 | Must |
| R5.12 | `404` and error pages | Never leave a visitor stuck | Link back to the menu and a phone number | Must |

**Home page order, top to bottom on a phone.** (1) Header with logo and a small "Order now" button. (2) Hero: one line, one photo, "Order now", open or closed status, rating badge. (3) Today's offers strip. (4) Popular items. (5) Google reviews. (6) How ordering works: delivery or collection, pay by card, bank or cash. (7) Hours, address and map link. (8) Footer with company name, number, registered office and legal links.

**Design direction.** Black and orange (#F47B20), photo-led, large readable prices, generous tap targets. The developer proposes the visual design on top of these rules; the owner approves it once, after the first working build (see section 15).

## 6. Customer ordering requirements

A guest can go from the menu to a paid or confirmed order in three screens: basket, details, payment. All money is stored as whole pence and every total is calculated on the server.

| ID | Requirement | Priority |
| --- | --- | --- |
| R6.1 | Menu data comes from the database: categories, items with name, description, price, photo, dietary tags and the 14 allergens | Must |
| R6.2 | Item options: required choices (for example size or meal side) and optional extras with a price, with minimum and maximum picks | Must |
| R6.3 | Admin can mark an item sold out or hidden; the site reflects it within seconds and the item cannot be ordered | Must |
| R6.4 | Basket survives a page reload and a closed tab (local storage); change quantity, remove item, add a note of up to 200 characters | Must |
| R6.5 | On phones, a sticky bottom bar shows item count and total and opens the basket | Must |
| R6.6 | Delivery or collection toggle in the basket. Delivery asks for a postcode first and shows the delivery fee, minimum order and estimated time before the customer goes on | Must |
| R6.7 | Offers: automatic offers and promo codes of four types: percentage off, fixed amount off, free delivery, and buy-one-get-one-free on a chosen category. Each has a minimum spend, start and end date and a usage limit, and can be limited to delivery or collection (the current print menu runs "Buy 1 Get 1 Free on wings, collection only") | Must |
| R6.8 | Orders are accepted only while the shop is open and not paused. When closed, the menu stays browsable and the button says when ordering reopens | Must |
| R6.9 | Checkout fields: name, UK mobile, email, delivery address, note. Use correct `autocomplete` and `inputmode` attributes and 16 px or larger inputs so phones fill them quickly | Must |
| R6.10 | Payment choice: pay online (section 8) or cash on delivery or collection. Admin can set a maximum order value for cash orders | Must |
| R6.11 | Confirmation screen and email with order number, items, total, payment status, allergen reminder and shop phone number | Must |
| R6.12 | Order status page for the customer, refreshing every 15 seconds: received, preparing, out for delivery or ready to collect, completed. The page is reached only through the random token in R5.5 | Must |
| R6.13 | Schedule an order for later today (time slots from the opening hours) | Should |
| R6.14 | Server-side validation of every field, price and promo code; the browser's price is never trusted; rate limiting on checkout and promo code attempts (Cloudflare WAF rate-limiting rules plus application checks) | Must |
| R6.15 | Abuse control for cash orders: a daily cap on cash orders per phone number and per IP address at launch, alongside the R6.10 maximum value. An SMS code to verify the mobile number is added only if abuse appears | Must (caps); Later (SMS) |

**Acceptance.** On a mid-range phone on a 4G connection, a first-time guest completes a cash order or a card order in three screens after the menu: basket, details, payment. For a card order, the payment screen is Stripe's.

## 7. Google Maps reviews and ratings

The site shows Food Haus's live Google star rating, review count and recent reviews, with Google's required attribution. The one open decision is the data source, because Google's rules differ by product.

| Option | What it returns | Storage rule | Cost | Fit |
| --- | --- | --- | --- | --- |
| 1. Places API (New), called from our server | Rating, review count, up to 5 reviews sorted by relevance | Content may not be pre-fetched, cached or stored; only the Place ID can be stored | Rating $20 and reviews $25 per 1,000 calls, with 1,000 free calls a month for each | Every page view is a paid call, and storing the result breaks Google's rule. Not recommended |
| 2. Places UI Kit element, loaded in the browser | Google renders place details, rating and reviews, with attribution built in | We store nothing | Google lists a Places UI Kit SKU at $1.00 per 1,000 after 10,000 free a month; confirm before launch | Compliant by design and live on day 1. It is marked experimental, loads Google's script and has limited styling |
| 3. Business Profile API (the owner's own listing) | All reviews of the verified location | Policy page allows temporary storage of up to 30 calendar days | Free; needs access approval, a business verified for 60+ days and an owner or manager login | Fastest for visitors, since data comes from our database. Approval time is not published, and the rule on showing reviews on the owner's site must be confirmed |

**Recommended path.** Launch with option 2. File the option 3 access request on day 1 and switch only if it is approved and the Business Profile terms allow showing reviews on the owner's own site. Put the source behind one internal `ReviewsProvider` function so the switch changes no page.

| ID | Requirement | Priority |
| --- | --- | --- |
| R7.1 | Show the star rating, total review count and recent reviews on the home page, and a small rating badge on the menu page | Must |
| R7.2 | Attribution as Google requires: Google Maps logo (or the text "Google Maps" where space is tight), reviewer avatar and name, a link to each review on Google Maps, and a clear note on how reviews are ordered and filtered | Must |
| R7.3 | Never type, copy or hand-store review text or ratings in the database or code | Must |
| R7.4 | Nothing from Google loads before first paint. Reserve the space so the page does not jump, and hide the block quietly if loading fails | Must |
| R7.5 | Keep the Place ID in configuration. Restrict the Google API key by website address and by API, and set a billing alert | Must |
| R7.6 | "Leave us a review" button linking to Food Haus's Google write-a-review link, supplied by the SEO lead | Should |
| R7.7 | A `ReviewsProvider` interface so the data source can change without touching pages | Should |

**Acceptance.** On launch day the rating and recent reviews on the site match the Google Maps listing, attribution is visible, and Lighthouse mobile performance stays within the section 10 budget with reviews enabled.

## 8. Payments and order flow

Online payment uses Stripe Checkout, Stripe's hosted payment page, so card details never touch our server. Cash orders skip payment and go straight to the kitchen. The embedded Stripe payment form can replace the hosted page later if the owner wants payment inside the site.

An order moves through these statuses: `pending_payment`, `received`, `preparing`, `ready` (collection) or `out_for_delivery` (delivery), then `completed`. Side exits are `rejected` (kitchen declines), `cancelled` (payment abandoned or expired) and `refunded`.

&#91;embedded content: order status flow · 5 steps, 3 side exits\]

Card orders become Received only when Stripe's webhook confirms payment. Cash orders start at Received. A refund can follow from any paid status.

| ID | Requirement | Priority |
| --- | --- | --- |
| R8.1 | Use Stripe Checkout in GBP. Enable cards and Pay by Bank in the Stripe Dashboard. Stripe lists Pay by Bank as supported in Checkout for UK customers paying in GBP. Confirm in test mode that Apple Pay and Google Pay appear | Must |
| R8.2 | Create the order first as `pending_payment` with totals calculated on the server. Then create the Checkout Session with the order ID in its metadata and a short expiry of about 30 minutes | Must |
| R8.3 | Mark an order paid only from the webhook, never because the customer returned to the site. Handle `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`, and check `payment_status` before fulfilling. Stripe's docs do not say which event a Pay by Bank payment triggers, so test it in test mode | Must |
| R8.4 | Verify the `Stripe-Signature` header against the raw request body and the endpoint's signing secret, keep the default 5-minute tolerance, and return a 2xx response quickly | Must |
| R8.5 | Fulfil once per payment. Webhooks can arrive more than once, so store the Stripe session ID and ignore repeats | Must |
| R8.6 | Cash orders make no Stripe call. They go straight to `received` and the board shows "CASH £x to collect" | Must |
| R8.7 | A customer who cancels or abandons payment returns to the basket with items intact. Orders that never get paid expire and never appear on the kitchen board | Must |
| R8.8 | Test keys in development and preview only; live keys only in production settings. Use a restricted Stripe API key limited to what the site needs | Must |
| R8.9 | Card statement name "FOOD HAUS"; Stripe receipt emails on, plus our own confirmation email | Should |
| R8.10 | Refunds done in the Stripe Dashboard for the first release; a Refund button (full or partial) on the admin order screen is added when time allows | Should |

**Stripe access.** The owner opens the Stripe account in the company name by following the Stripe set-up guide and invites MotionBite as a Developer team member. We never hold the owner's password, and the Developer role cannot change bank details or payout schedules.

**Acceptance.** In Stripe test mode, these all pass: successful card payment, declined card, abandoned checkout, Pay by Bank, duplicate webhook delivery (the order is fulfilled once), and a cash order. The standard Stripe test card is 4242 4242 4242 4242.

## 9. Admin panel requirements

The admin panel lives at `/admin`, works on a phone, tablet and laptop, and is built so the owner can run the shop without calling a developer. Anything the owner edits shows on the public site within seconds.

| ID | Module | Requirement | Priority |
| --- | --- | --- | --- |
| R9.1 | Login and roles | Email and password login with password reset. Three roles: Owner (everything), Manager (menu, offers, hours, orders, no refunds or user management), Kitchen (orders only). Every admin action is authorised on the server, not only hidden in the screen. Password reset uses a single-use, time-limited link, is rate-limited, gives the same response whether or not the email exists, and signs the user out of every session | Must |
| R9.2 | Login and roles | Two-step login for Owner and Manager, the roles that control money, prices and customers' personal data; automatic logout after inactivity for those roles (the Kitchen order board stays signed in) | Must |
| R9.3 | Live order board | New orders appear within 5 seconds with a loud sound and a flashing card. A "Start taking orders" button switches the sound on, because browsers block sound until someone taps | Must |
| R9.4 | Live order board | Order card shows number, time, delivery or collection, items with options and notes, customer name, tap-to-call number, address with a map link, and a clear "PAID online" or "CASH £x" label | Must |
| R9.5 | Live order board | Accept or reject (with a reason the customer sees), set preparation time, move through the statuses in section 8 with one tap; large touch targets for use with greasy hands | Must |
| R9.6 | Live order board | Keep the screen awake while the board is open | Should |
| R9.7 | Menu manager | Create, edit, reorder and hide categories and items; price in pounds; photo upload resized automatically; option groups and extras; the 14 allergens as checkboxes; dietary tags; sold-out switch | Must |
| R9.8 | Offers and promo codes | Create offers and codes as in R6.7, schedule them, see how many times each was used, and choose which appear on the home page and `/offers` | Must |
| R9.9 | Shop settings | Opening hours per weekday plus exceptions (bank holidays, closed days); a "Pause orders" switch with a message; default preparation time; contact details; a site-wide notice bar | Must |
| R9.10 | Delivery zones | Zones by UK postcode district (for example LU1 to LU4), each with fee, minimum order and estimated time; orders outside the zones are refused politely | Must |
| R9.11 | Order history | Search and filter by date, status and payment type; open any past order; export to CSV (Owner and Manager only, since the export contains customers' contact details); a print-friendly receipt view | Should |
| R9.12 | Reports | Daily sales email to the owner after closing time: orders, revenue, average order, online versus cash, top items. The email carries totals only, never customers' contact details. Dashboard shows today and the last 7 days | Must |
| R9.13 | Audit log | Record who changed a price, offer or setting, and when. With a shared Kitchen login (Q7), this log is the only record of who did what, so it ships at launch | Must |
| R9.14 | Training | A 30-minute walkthrough with the owner and one short written how-to for the daily routine | Must |

**Acceptance.** The owner or manager changes an item price, adds an offer and pauses orders on a phone, and each change shows on the public site within 10 seconds. A test order triggers the sound and appears on the board within 5 seconds.

## 10. Performance and mobile-first requirements

The site must load fast on an ordinary phone and a mobile connection, because hungry customers leave slow pages. These budgets apply to `/`, `/menu`, `/offers` and `/checkout`, measured on a production build.

| Measure | Budget | Source |
| --- | --- | --- |
| Largest Contentful Paint (LCP) | 2.5 s or less | [Core Web Vitals](https://web.dev/articles/vitals), at the 75th percentile |
| Interaction to Next Paint (INP) | 200 ms or less | Core Web Vitals, at the 75th percentile |
| Cumulative Layout Shift (CLS) | 0.1 or less | Core Web Vitals, at the 75th percentile |
| Lighthouse mobile Performance score | 90 or more (Must), 95 or more (Should) | MotionBite budget |
| JavaScript on first load, home page | 150 KB or less, compressed | MotionBite budget |
| Hero image | 100 KB or less | MotionBite budget |
| Total first-load transfer, home page | 700 KB or less; below-the-fold images load later | MotionBite budget |

| ID | Requirement | Priority |
| --- | --- | --- |
| R10.1 | Mobile-first CSS: base styles for a 360 px screen, enhanced with `min-width` rules. Works down to 320 px with no sideways scrolling | Must |
| R10.2 | Tap targets at least 44 × 44 CSS px. Primary actions sit in the thumb zone, such as the sticky basket bar | Must |
| R10.3 | Public pages render as HTML on the server and are cached at the edge. A menu or offer edit refreshes the cache on demand within seconds. Only the basket, item pop-up, checkout and admin need heavy JavaScript | Must |
| R10.4 | Minimal JavaScript: server components by default, client components only where needed, no large UI kit, no whole-library imports | Must |
| R10.5 | Images in AVIF or WebP with fallback, `srcset` sizes, explicit width and height, hero image preloaded, all others lazy. Admin uploads are resized to 1,600 px wide at most and compressed, using Cloudflare Images or resizing at upload time in the Worker (there is no automatic host-side image optimisation to lean on) | Must |
| R10.6 | At most two font families, self-hosted, Latin subset, `font-display: swap`, main weight preloaded, fallback font matched to avoid a jump | Must |
| R10.7 | No third-party script blocks first paint. Google Analytics loads only after consent and after the page is interactive. The map is a "Get directions" link or a static image, not a live embed | Must |
| R10.8 | Reserve space for images, the reviews block and the notice bar. Nothing is inserted above content that has already appeared | Must |
| R10.9 | The menu page ships its data in the HTML: no spinner on first view. Basket changes feel instant | Must |
| R10.10 | Brotli compression, long-lived cache headers on hashed files, HTTP/2 or newer, and a CDN with a point of presence near UK users | Must |
| R10.11 | Lighthouse runs on every pull request against the preview site and fails the build below budget | Should |
| R10.12 | Accessibility to WCAG 2.2 AA: contrast, visible focus, labelled fields, keyboard use, reduced-motion respected. Orange text on white is not allowed | Must |

**Acceptance.** Lighthouse mobile (default throttling) meets the budgets above on the four pages, and a hands-on check on one current iPhone and one mid-range Android phone confirms the menu, basket and checkout feel instant.

## 11. Local SEO, analytics and legal pages

The SEO lead runs the keyword and content work. The developer's job is to make the site easy for Google to read and to meet UK food and privacy rules.

**Keyword reality (checked 3 November 2026).** Page 1 for head terms such as "burgers luton" and "halal takeaway luton" is held by Just Eat, Deliveroo and Uber Eats category pages, so the site does not chase those organically; they are won in the Google local pack, which is the SEO lead's Business Profile work. The site targets, in order: the brand ("food haus", "food haus luton", "food haus menu" — these must beat the aggregators' Food Haus listings), halal long-tail ("halal burgers luton" currently has no established LU4 competitor; the print menu confirms the shop is halal), district and neighbourhood terms ("burgers LU4", "burger delivery LU4", "burgers maidenhall"), and offer terms ("burger deals luton"). "Near me" searches are decided by Business Profile proximity and categories, never by a page. One warning for the SEO lead: directories list several food brands at 314–318 Selbourne Road (Burger & Co, Biryaniwala and others), and shared-address virtual brands commonly cause Google Business Profile merges or suspensions — consolidating and defending the listing is the first job.

| ID | Requirement | Priority |
| --- | --- | --- |
| R11.1 | Every page has a unique title and meta description, a canonical URL, `lang="en-GB"`, per-page OpenGraph and Twitter tags and a share image. Titles and the single H1 per page follow keyword templates agreed with the SEO lead (home: "Food Haus — Halal Burger Takeaway & Delivery in Luton"; menu: "Order Halal Burgers Online in Luton | Food Haus"). The SEO lead supplies the wording in an editable file or admin field | Must |
| R11.2 | JSON-LD `Restaurant` structured data: name, address, phone, `geo` position, `servesCuisine`, `priceRange`, opening hours, `hasMenu` with sections and items (names and prices from the same database as the live menu) and `potentialAction`/`OrderAction` pointing at `/menu`. It reads from the same shop settings and menu data as the admin, so nothing ever disagrees | Must |
| R11.3 | Do not add star-rating markup for Food Haus's own Google reviews. Google's structured-data guidance treats a business reviewing itself as ineligible, so confirm before launch | Should |
| R11.4 | Auto-generated `/sitemap.xml` covering pages, area pages and articles. `robots.txt` blocks `/admin`, `/checkout` and `/order/*` (this only steers crawlers and is not access control; the real protection is the R9.1 login and the R13.15 tokens) | Must |
| R11.5 | Name, address and phone are written identically in the footer, on the contact page, in the structured data and on the Google listing | Must |
| R11.6 | Area page template (for example "Burgers in LU4"): H1, intro, popular items, hours, directions link, order button. Only districts inside the live delivery zones get a page; each carries genuinely local content (that district's delivery fee, minimum and estimated time, plus unique copy from the SEO lead) and joins the sitemap only once its content is real — templated pages with swapped place names count as doorway pages under Google's spam policy | Should |
| R11.7 | Google Search Console verified and sitemap submitted; GA4 property created and connected | Must |
| R11.8 | GA4 events: `view_menu`, `add_to_cart`, `begin_checkout`, `purchase` (value and payment type), `promo_applied`, `click_call`, `click_directions` | Must |
| R11.9 | Cookie banner with equally prominent Accept and Reject. GA4 loads only after Accept. Basket and admin-session cookies are strictly necessary and need no consent ([ICO guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/)) | Must |
| R11.10 | Allergens: each item shows its allergens on the card and pop-up, `/allergens` shows a grid of items against the 14 allergens, and checkout shows a notice and a note field. The confirmation email repeats the allergen reminder | Must |
| R11.11 | Footer shows company name, Companies House number and registered office; VAT number if registered; links to privacy, cookies, terms and allergens | Must |
| R11.12 | MotionBite drafts the privacy policy, cookie policy and terms (including cancellation and refund wording). The owner reads and approves them before launch | Must |
| R11.13 | Preview and every other non-production deployment send `X-Robots-Tag: noindex` and block all crawlers; only production is indexable | Must |
| R11.14 | One canonical origin (for example `https://www.`): plain HTTP, the alternate host and trailing-slash variants 301 to it. If an old Food Haus domain or site exists (Q3), its URLs 301 to the new pages before launch | Must |
| R11.15 | Every image has descriptive alt text; menu photos use an admin alt field, falling back to the item name | Must |
| R11.16 | `lastmod` on sitemap entries; `BreadcrumbList` structured data on blog and area pages | Should |

**Allergen rule behind R11.10.** The UK Food Standards Agency says allergen information for food sold by delivery or takeaway must be given at two points: before the purchase is completed (for example on the website or menu) and when the food is delivered (for example allergen stickers or an enclosed menu). The first point is the site's job. The second is the shop's job: the owner puts a printed allergen list or menu in every delivery bag, and the confirmation email says so. Source: [FSA allergen guidance](https://www.gov.uk/government/publications/allergen-guidance-for-food-businesses/allergen-guidance-for-food-businesses).

**Acceptance.** Search Console shows the sitemap as read, the structured data passes Google's Rich Results Test, the cookie banner blocks GA4 until Accept, and every menu item has allergen information filled in.

## 12. Technical approach

One TypeScript codebase serves the public site, the admin panel and the small API behind them. The stack below is the recommendation; the developer may swap a part if the requirements in sections 6 to 11 still hold and the reason is written in the repository.

&#91;embedded content: architecture · one app, four services\]

Customers, staff and Stripe all talk to the same app, which keeps its data in one database. Google reviews load in the customer's browser and do not pass through the app (section 7, option 2).

| Layer | Recommendation | Why |
| --- | --- | --- |
| Framework | Next.js (App Router) with TypeScript | Server-rendered pages cached at the edge, on-demand cache refresh when the owner edits the menu, and one codebase for site, admin and API |
| Styling | Tailwind CSS | Small CSS output and fast mobile-first work |
| Database | PostgreSQL in a London or nearest EU region, reached through Cloudflare Hyperdrive (or a serverless driver such as Neon's), with Drizzle | Orders need relational integrity; UK data stays close to UK customers. Workers do not hold long-lived database connections, so Hyperdrive does the pooling; Drizzle runs on Workers without the driver-adapter work Prisma needs |
| Admin login | Auth.js (or equivalent) with email and password, sessions in secure cookies | Simple, no third-party login needed |
| Payments | Stripe Checkout and webhooks | Section 8 |
| Email | A transactional email service with SPF and DKIM set up on the shop's domain | Order confirmations and the daily sales report must reach inboxes |
| Live order board | The board asks the server for new orders every 3 to 5 seconds | Simple and reliable on serverless hosting; no always-on connection needed |
| Scheduled jobs | Cloudflare Cron Triggers: daily sales email, expire unpaid orders, refresh reviews if option 3 in section 7 is used | No extra server |
| Articles | Sanity Studio, as on other MotionBite sites | The SEO lead publishes without touching code |
| Hosting | Cloudflare Workers (Workers Paid, US$5 a month per [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)) with the [OpenNext Cloudflare adapter](https://opennext.js.org/cloudflare) (`@opennextjs/cloudflare`) | Points of presence across the UK, a built-in WAF, rate limiting and Turnstile (R6.14, R13.13), Cron Triggers for scheduled jobs, and preview deployments per pull request. On-demand cache refresh (R10.3) works through the adapter's cache on KV/R2 and is set up on days 1–2, not bolted on later. Stripe's raw-body webhook verification (R8.4) works on Workers unchanged |
| Code and releases | GitHub repository, pull requests, a preview site for every pull request, merge to main deploys to production | Review and rollback are easy |
| Monitoring | Error tracking and an uptime check | Should; the owner is told within minutes if checkout breaks |

**Environments.** Local, preview (test Stripe keys, sample menu) and production (live keys). Secrets live only in the host's settings, never in the repository. A `.env.example` file lists every variable.

**Data model.** Money is stored as whole pence. Times are stored in UTC and shown in Europe/London time. Order lines copy the item name and price at the time of ordering, so a later price edit never changes an old order.

| Entity | Main fields |
| --- | --- |
| `category` | name, sort order, visible |
| `item` | category, name, description, price, photo, 14 allergen flags, dietary tags, sold out, visible, sort order |
| `option_group`, `option` | item, name, required, minimum and maximum picks; option name and price change |
| `offer` | type (percentage, fixed, free delivery), value, optional code, minimum spend, start, end, usage limit, used count, show on site |
| `order` | number, type, status, payment method and status, subtotal, delivery fee, discount, total, customer name, phone, email, address, postcode, note, scheduled time, Stripe session ID, timestamps |
| `order_item` | order, copied name and price, quantity, copied options, line total |
| `delivery_zone` | postcode district, fee, minimum order, estimated minutes |
| `opening_hours`, `closure` | weekday, open and close times; closed dates with a reason |
| `settings` | paused flag and message, default preparation time, notice bar, contact details |
| `admin_user` | email, password hash, role, last login |
| `audit_log` | user, action, entity, before and after, time |

## 13. Security, privacy and reliability

The site handles customers' names, phone numbers, addresses and money, and the kitchen depends on it during service. These rules keep both safe.

| ID | Requirement | Priority |
| --- | --- | --- |
| R13.1 | HTTPS everywhere with HSTS; plain HTTP redirects to HTTPS | Must |
| R13.2 | Card details never reach our server or database; Stripe's hosted page takes them | Must |
| R13.3 | Admin passwords stored with a modern slow hash (argon2id or bcrypt; on Cloudflare Workers, where neither runs reliably, PBKDF2-SHA256 at 600,000 iterations or more through the platform's Web Crypto); login attempts rate-limited; session cookies are `HttpOnly`, `Secure` and `SameSite`; every admin page and action checks the user's role on the server | Must |
| R13.4 | Every endpoint validates its input against a schema; database access is parameterised through the ORM; state-changing admin actions are protected against cross-site requests | Must |
| R13.5 | Security headers including a Content-Security-Policy that allows only our own files and the exact third-party hostnames in use (Stripe's checkout and js domains, the Places UI Kit hosts, Google Analytics) — never a wholesale `*.google.com` allowance | Must |
| R13.6 | Secrets live only in host settings, never in the repository or the browser bundle. Rotate any key that was shared in chat or email | Must |
| R13.7 | Order creation is idempotent: a double tap or a retry never creates two orders. Totals are always recalculated on the server | Must |
| R13.8 | Automatic daily database backups, encrypted at rest, kept for at least 7 days; one restore is tested before launch | Must |
| R13.9 | If Stripe is down, cash orders still work. If Google is down, the reviews block hides. Visitors never see a raw error page | Must |
| R13.10 | If the order board cannot reach the server for 15 seconds, it shows a red "No connection, orders may be missed" bar. A new-order email also goes to the shop's inbox as a backup; the email carries the order number and items, not the customer's contact details | Must |
| R13.11 | Collect only what an order needs: name, mobile, email, address, note. The privacy policy names every service that handles that data (Stripe, host, database, email service, Google Analytics if accepted) | Must |
| R13.12 | Retention: delete or anonymise customers' contact details on old orders after a period the owner chooses, keeping totals for accounts | Should |
| R13.13 | Bot protection on checkout, promo codes and login, using an invisible check rather than a puzzle (Cloudflare Turnstile, included with the hosting) | Should |
| R13.14 | Error tracking, an uptime check, a dependency lockfile and automatic alerts for vulnerable packages | Should |
| R13.15 | Customer order pages are addressed by a long random token (at least 128 bits of randomness), generated server-side and separate from the human-friendly order number. The token appears only in the customer's own confirmation screen and email | Must |

**Acceptance.** A security checklist in the repository is ticked before launch, the restore test is recorded, and a staff login cannot open any page above its role.

## 14. Inputs we need from the client

The 2–3 week clock starts when the advance is paid and the "before start" items below are in. Under the agreement the owner approves work within 2 working days, and any longer wait moves the launch date by the same number of days. The developer builds with sample data until real content arrives, so nothing waits for photos.

| Item | Used for | From | Needed by |
| --- | --- | --- | --- |
| Logo (vector or large PNG) and confirmation of brand colours | Header, favicon, emails, share image | Owner | Before start |
| Company details: legal name, Companies House number, registered office, VAT number if registered | Footer, legal pages, emails | Owner | Before start |
| Opening hours and holiday closures | Shop settings, structured data | Owner | Before start |
| Delivery area by postcode district, fee, minimum order, estimated times | Delivery zones | Owner | Before start |
| Full menu: categories, items, descriptions, prices, options and extras | Menu data | Owner | Before start |
| Domain name, and registrar login if the owner already holds one | Launch and email sending | Owner or MotionBite | Before start |
| Google Business Profile manager access for MotionBite, and the Place ID | Reviews, Maps work | Owner and SEO lead | Day 1 |
| Food photos, at least 1,200 px wide (hero and per item) | Hero, menu cards | Owner | End of week 1 |
| Allergen details for every item (14 allergens) | Menu, allergen grid | Owner or kitchen | End of week 1 |
| Shop phone, order email, staff names, emails and roles for admin accounts | Alerts, daily report, logins | Owner | End of week 1 |
| Stripe account in the company name, with MotionBite invited as Developer | Payments | Owner | End of week 1 (live approval before go-live) |
| Launch offers and promo codes | Offers page | Owner | Week 2 |
| TikTok and other social links | About and footer | Owner | Week 2 |
| Approval of design, then of legal pages | Sign-off | Owner | Weeks 1 and 3 |

**MotionBite sets up.** The GitHub repository, hosting account, database, email service, Google Cloud project and API key (section 7), GA4 and Search Console, Sanity project and error tracking. The domain, the Stripe account and the Google listing stay in the owner's name.

## 15. Delivery plan and acceptance

The plan fits Supersonic mode (2–3 weeks). It is built so the owner sees a working site early and can correct course before the end. The developer adjusts the order of work inside a week, but the end of each week is a fixed checkpoint.

| Week | Outcome at the end of the week | Checkpoint |
| --- | --- | --- |
| Days 1–2 | Repository, hosting, database and preview site live; design tokens and layout shell; sample menu loaded; Stripe test account connected | Preview link shared with the owner |
| Week 1 | Home, menu, basket and offers pages built from the database; admin login; menu and offers manager | Owner approves the look on his phone |
| Week 2 | Checkout, Stripe payment and webhook, cash orders, confirmation page and emails; delivery zones and opening hours; live order board with sound | A full test order works from phone to board |
| Week 3 | Google reviews, SEO and legal pages, analytics and cookie banner, performance and accessibility pass, device tests, owner training | Go-live checklist signed off |
| After launch | First month of free support; Maps and Local SEO programme continues for 3 months | Review with the owner after 30 days |

**Definition of done.** A requirement is done when it works on the preview site, meets its priority and budget, passes its acceptance check, and is merged through a reviewed pull request.

**Go-live checklist.**

- [ ] Home, menu, offers, checkout and order pages meet the section 10 budgets on a production build
- [ ] Guest order completed on one iPhone and one Android phone: cash order, card order and Pay by Bank order in Stripe test mode
- [ ] Declined card, abandoned checkout and duplicate webhook tested; each order is created and fulfilled once
- [ ] Admin changes (price, offer, sold out, pause) show on the public site within 10 seconds
- [ ] Order board sound, 5-second refresh and the offline warning tested on the shop's own tablet or phone
- [ ] Google rating and reviews match the Maps listing, with attribution visible
- [ ] Allergen data complete for every item; allergen grid and checkout notice live
- [ ] Privacy, cookie and terms pages approved by the owner; footer shows company details
- [ ] Cookie banner blocks Google Analytics until Accept; GA4 events arrive
- [ ] Sitemap submitted in Search Console; structured data passes the Rich Results Test
- [ ] Stripe switched to live keys; one real low-value payment made and refunded
- [ ] Domain, SSL, email sending (SPF and DKIM) and daily backup confirmed; one restore tested
- [ ] Owner and staff trained; short how-to handed over
- [ ] Launch announced by the owner on TikTok and the Google listing's "Order online" button points to the menu page

## 16. Assumptions and open questions

The developer starts with the defaults below. Each question has an owner; if no answer arrives, the default stands and the question is revisited at the next checkpoint.

**Assumptions.** One shop and one branch. Delivery by the shop's own drivers, with no live tracking. Orders and prices in GBP only, for UK customers, in English. No alcohol or other age-restricted items, no tips or service charge, no loyalty scheme. The owner opens the Stripe account by following the set-up guide. Sample content is used until real content arrives.

| ID | Open question | Default if unanswered | Who answers |
| --- | --- | --- | --- |
| Q1 | Which reviews data source (section 7)? | Option 2 at launch; option 3 requested on day 1 | MotionBite owner |
| Q2 | Is Food Haus Ltd VAT-registered? | Prices shown including VAT, no VAT breakdown on receipts | Client |
| Q3 | Does a Food Haus website or domain already exist? We could not open one from Bangladesh | MotionBite registers a new domain in the owner's name (free for year 1) | Client |
| Q4 | The print menu confirms the shop is halal (halal badge shown). Which exact wording or certification may the site claim? | "Halal" shown prominently site-wide: header badge, home H1 and titles (R11.1) and the Business Profile attribute. A certifying body is named only if the owner supplies proof | Client |
| Q5 | Is ordering for a later time needed at launch (R6.13)? | Not at launch; ASAP orders only | Client |
| Q6 | Maximum order value for cash on delivery (R6.10)? | Admin setting present, no cap set | Client |
| Q7 | How many admin users, and which roles? | Owner, one Manager and one shared Kitchen login | Client |
| Q8 | Which device sits in the kitchen for the order board? | The owner's phone or a shop tablet | Client |
| Q9 | How long do we keep customers' contact details on old orders (R13.12)? | 24 months, then anonymise | Client |
| Q10 | Which email address sends order emails? | An address on the new domain; needs access to the domain settings | Client and MotionBite |

**To verify while building.** Stripe's docs do not say which event a Pay by Bank payment sends, nor name Apple Pay and Google Pay for Checkout, so test both in test mode (section 8). The Places UI Kit element is marked experimental, so check its current tag names and styling limits before building the reviews block. The Business Profile terms must be read for the rule on showing reviews on an owner's own site before option 3 is used.

## Sources

Pages opened and read on 26 October 2026:

- [Places API Place Details](https://developers.google.com/maps/documentation/places/web-service/place-details), [Places API policies and attribution](https://developers.google.com/maps/documentation/places/web-service/policies), [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing), [Google Maps Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)
- [Places UI Kit Place Details element](https://developers.google.com/maps/documentation/javascript/places-ui-kit/place-details), [Business Profile API review data](https://developers.google.com/my-business/content/review-data), [Business Profile API prerequisites](https://developers.google.com/my-business/content/prereqs), [Business Profile API policies](https://developers.google.com/my-business/content/policies)
- [Stripe Pay by Bank](https://docs.stripe.com/payments/pay-by-bank), [Stripe Checkout fulfilment](https://docs.stripe.com/checkout/fulfillment.md?ui=full-page), [Stripe webhooks](https://docs.stripe.com/webhooks)
- [FSA allergen guidance for food businesses](https://www.gov.uk/government/publications/allergen-guidance-for-food-businesses/allergen-guidance-for-food-businesses), [ICO guidance on cookies and similar technologies](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/)
- [Core Web Vitals thresholds](https://web.dev/articles/vitals)

Added in the 3 Nov 2026 revision (Cloudflare hosting):

- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [OpenNext Cloudflare adapter](https://opennext.js.org/cloudflare), [Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/)
