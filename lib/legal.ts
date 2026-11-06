import { CONTACT_RETENTION_MONTHS } from "./retention";

// The privacy and cookie policy pages (R5.10, R11.9, R11.12, R13.11) as DATA, so what is still
// undecided can be counted and checked.
//
// Two kinds of text:
//  - FACTS about how this site works (what the order form collects, that card details go to the
//    payment provider, that analytics only runs after Accept). They come from the code.
//  - DECISIONS that are the owner's or their adviser's to make (legal wording, which providers to
//    name, retention periods, contact details). These are `ph` placeholders, shown on the page in a
//    clearly marked box. NOTHING in a placeholder is a legal statement.
//
// LEGAL_APPROVED stays false until the owner has read and approved the pages (R11.12). While it is
// false the pages show a DRAFT notice, are hidden from search engines and are left out of the
// sitemap. A test refuses LEGAL_APPROVED = true while any placeholder remains.

export const LEGAL_APPROVED = false;

export type Ph = { ph: string; hint?: string };
export type Cell = string | Ph;
export type Block =
  | { t: "p"; text: Cell | Cell[] }
  | { t: "ul"; items: Cell[] }
  | { t: "table"; head: string[]; rows: Cell[][] }
  | { t: "ph"; ph: string; hint?: string };
export type Section = { id: string; title: string; blocks: Block[] };
export type LegalDoc = { slug: "privacy" | "cookies"; title: string; intro: Block[]; sections: Section[] };

export const isPh = (c: unknown): c is Ph => typeof c === "object" && c !== null && "ph" in c;
const ph = (need: string, hint?: string): Ph => ({ ph: need, hint });

export function placeholdersIn(doc: LegalDoc): Ph[] {
  const out: Ph[] = [];
  const cell = (c: Cell) => isPh(c) && out.push(c);
  const block = (b: Block) => {
    if (b.t === "ph") out.push({ ph: b.ph, hint: b.hint });
    else if (b.t === "p") (Array.isArray(b.text) ? b.text : [b.text]).forEach(cell);
    else if (b.t === "ul") b.items.forEach(cell);
    else b.rows.forEach((r) => r.forEach(cell));
  };
  doc.intro.forEach(block);
  doc.sections.forEach((s) => s.blocks.forEach(block));
  return out;
}

export const outstandingPlaceholders = () => [privacyPolicy, cookiePolicy].flatMap((d) => placeholdersIn(d).map((p) => ({ doc: d.slug, ...p })));

// ---------------------------------------------------------------------------------------------

export const privacyPolicy: LegalDoc = {
  slug: "privacy",
  title: "Privacy Policy",
  intro: [
    { t: "p", text: "This page explains what personal information Food Haus collects when you use this website and order from us, what we do with it, who else handles it, and your choices." },
    { t: "ph", ph: "Date this policy was last updated", hint: "Add once the owner approves the final wording." },
  ],
  sections: [
    {
      id: "who",
      title: "Who we are",
      blocks: [
        { t: "ph", ph: "Legal name of the business, Companies House number and registered office address (the data controller)", hint: "The site footer currently shows a provisional name that has not been confirmed (R11.11)." },
        { t: "ph", ph: "ICO registration number, if the business is registered with the Information Commissioner's Office", hint: "The owner or their adviser decides whether a registration applies." },
      ],
    },
    {
      id: "collect",
      title: "What we collect and why",
      blocks: [
        { t: "p", text: "We collect only what is needed to take and deliver an order (R13.11)." },
        {
          t: "table",
          head: ["What", "Why we need it"],
          rows: [
            ["Your name, mobile number and email address", "To prepare your order, contact you about it, and send your order confirmation."],
            ["Your delivery address and postcode (delivery orders only)", "To deliver your order and check it is inside our delivery area."],
            ["Your order, any note you add (for example allergies) and whether you pay by card or cash", "To make your order correctly and keep a record of the sale."],
            ["A scrambled (hashed) version of your internet address, for cash orders", "To limit repeat cash orders from one place and prevent abuse. We cannot turn it back into your address."],
            ["Admin accounts only: email, password (stored scrambled), and sign-in records", "To let staff sign in securely. This is not about customers."],
          ],
        },
        { t: "p", text: "We never see or store your card number. Card payments are taken on the payment provider's own secure page." },
        { t: "ph", ph: "Legal basis for each use of personal data (for example contract, legal obligation, legitimate interests) in the wording the owner's adviser approves" },
      ],
    },
    {
      id: "share",
      title: "Who else handles your information",
      blocks: [
        { t: "p", text: "We use other companies to run the site. Each one only receives what it needs for its job. The names are placeholders until the owner confirms the providers in use." },
        {
          t: "table",
          head: ["What they do", "Provider", "Information involved", "Where it is processed"],
          rows: [
            ["Takes card payments", ph("Payment provider name", "Expected: the provider the checkout uses today. Confirm."), "Name, email, payment details, order total", ph("Country and transfer safeguard wording")],
            ["Hosts the website", ph("Hosting provider name", "Expected: the provider in the hosting plan. Confirm."), "Everything you send to the site, such as the order form", ph("Country and transfer safeguard wording")],
            ["Stores orders in a database", ph("Database provider name", "Expected: the provider in the hosting plan. Confirm."), "Your order and contact details", ph("Country and transfer safeguard wording")],
            ["Sends order emails", ph("Email provider name", "Expected: the provider in the email set-up. Confirm."), "Your name, email address and order summary", ph("Country and transfer safeguard wording")],
            ["Checks forms are filled in by people, not bots", ph("Bot-check provider name", "Confirm whether it is switched on for the order form."), "Technical details of your browser", ph("Country and transfer safeguard wording")],
            ["Shows our Google rating and reviews", ph("Google entry wording", "Loading Google's reviews discloses your internet address to Google. Decide wording, and whether it should wait for cookie consent."), "Your internet address and browser details", ph("Country and transfer safeguard wording")],
            ["Measures how the site is used (only if you accept analytics cookies)", ph("Analytics provider name"), "Pages visited, device and approximate location, via cookies", ph("Country and transfer safeguard wording")],
          ],
        },
        { t: "ph", ph: "Statement on whether we ever sell or share data for marketing, and on authorities or legal requests", hint: "Legal decision." },
      ],
    },
    {
      id: "keep",
      title: "How long we keep it",
      blocks: [
        {
          t: "p",
          text: `How the site works today: contact details on an order (name, phone, email, address, postcode, note) are automatically wiped ${CONTACT_RETENTION_MONTHS} months after the order. The order itself, without those details, is kept for our accounts.`,
        },
        { t: "ph", ph: "Retention wording for each type of data, including how long accounting records must be kept", hint: "Retention periods are a legal and business decision. The 12 months above is a setting in the code, not a statement of what the law requires." },
        { t: "ph", ph: "Retention of backups, email provider logs and card-payment records held by the payment provider" },
      ],
    },
    {
      id: "rights",
      title: "Your rights",
      blocks: [
        { t: "p", text: "Under UK data protection law you can ask us to: show you the information we hold about you, correct it, delete it, restrict or object to how we use it, and give you a copy you can move elsewhere. You can also complain to the Information Commissioner's Office at ico.org.uk." },
        { t: "ph", ph: "Exact wording of the rights, the time we have to reply, and any limits that apply", hint: "Needs the owner's adviser's review. The sentence above is a plain summary, not approved legal wording." },
      ],
    },
    {
      id: "cookies",
      title: "Cookies",
      blocks: [{ t: "p", text: "See our Cookie Policy for the cookies and browser storage we use, and how to change your choice." }],
    },
    {
      id: "contact",
      title: "Contact us about your data",
      blocks: [
        { t: "ph", ph: "Contact email or postal address for privacy requests", hint: "The shop's general contact details are not assumed to be the right place for data requests." },
        { t: "ph", ph: "Name of a data protection contact, if the business appoints one" },
      ],
    },
  ],
};

export const cookiePolicy: LegalDoc = {
  slug: "cookies",
  title: "Cookie Policy",
  intro: [
    { t: "p", text: "Cookies are small files a website saves in your browser. Browser storage (localStorage) works in a similar way. This page lists what Food Haus uses." },
    { t: "p", text: "Some are strictly necessary to run the site and are always on. Analytics cookies are optional: they stay off unless you press Accept, and the site works the same either way." },
  ],
  sections: [
    {
      id: "necessary",
      title: "Always on: needed to run the site",
      blocks: [
        {
          t: "table",
          head: ["Name", "What it does", "How long"],
          rows: [
            ["fh_consent (cookie)", "Remembers your answer to the cookie question so we do not keep asking.", "6 months"],
            ["fh-basket-v1 (browser storage)", "Keeps your basket if you reload the page or close the tab.", "Until you place the order, empty the basket or clear your browser data"],
            ["fh-order-cleared-… (browser storage)", "Remembers that your basket was emptied after an order, so it is not emptied twice.", "Until you clear your browser data"],
            ["Payment provider (set on their page)", "Lets the card payment complete securely and helps prevent fraud.", ph("Cookie names and lifetimes the payment provider sets", "List from the provider's own documentation.")],
            ["Bot check (set on forms)", "Tells people from automated bots, if switched on.", ph("Cookie names and lifetimes, or confirmation none are set")],
            ["Staff sign-in (staff only)", "Keeps a staff member signed in to the admin pages. Customers never receive it.", "Ends when staff sign out or after a period of inactivity"],
          ],
        },
        { t: "p", text: "These do not need your consent because the site cannot work without them." },
        { t: "ph", ph: "Wording on why these are exempt from consent", hint: "Legal wording for the owner's adviser to approve." },
      ],
    },
    {
      id: "google",
      title: "Google rating and reviews",
      blocks: [
        { t: "p", text: "Where we show our Google rating and reviews, Google's own code is loaded from Google when you scroll to that part of the page. Google may receive your internet address and browser details." },
        { t: "ph", ph: "Decision: should Google reviews wait for cookie consent, and the wording about what Google sets", hint: "Currently they load without waiting. This is flagged in the security checklist." },
      ],
    },
    {
      id: "analytics",
      title: "Optional: analytics (only after you accept)",
      blocks: [
        {
          t: "table",
          head: ["Name", "What it does", "How long"],
          rows: [
            ["_ga and _ga_… (set by Google Analytics)", "Counts visits and shows which pages are used, without identifying you by name.", ph("Lifetime, taken from Google's current documentation")],
          ],
        },
        { t: "ph", ph: "Analytics provider wording, what is collected, and any data sharing settings the owner chooses" },
      ],
    },
    {
      id: "change",
      title: "Change your choice",
      blocks: [{ t: "p", text: "You can change your mind at any time using the buttons below, or the Cookie settings link at the bottom of every page. Choosing Reject also removes any analytics cookies already saved. You can also delete cookies in your browser settings." }],
    },
    {
      id: "contact",
      title: "Questions",
      blocks: [{ t: "ph", ph: "Contact for questions about cookies" }],
    },
  ],
};
