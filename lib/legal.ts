import { CONTACT_RETENTION_MONTHS } from "./retention";

// The privacy, cookie and terms pages (R5.10, R11.9, R11.12, R13.11) as DATA, so what is still
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
export type LegalDoc = { slug: "privacy" | "cookies" | "terms" | "allergens"; title: string; intro: Block[]; sections: Section[] };

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

export const outstandingPlaceholders = () => [privacyPolicy, cookiePolicy, termsPolicy, allergenNotice].flatMap((d) => placeholdersIn(d).map((p) => ({ doc: d.slug, ...p })));

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

// ---------------------------------------------------------------------------------------------
// Terms and cancellation (R5.10, R11.12). The mechanics below are what the system really does;
// the legal wording of cancellation, refunds, liability and governing law is left to the owner.

export const termsPolicy: LegalDoc = {
  slug: "terms",
  title: "Terms & Cancellation Policy",
  intro: [
    { t: "p", text: "These terms explain how ordering from Food Haus through this website works: how an order is placed and accepted, how you pay, delivery and collection, and what happens if you need to cancel or something goes wrong." },
    { t: "ph", ph: "Date these terms were last updated, and which version applies to orders already placed", hint: "Add once the owner approves the final wording." },
  ],
  sections: [
    {
      id: "about",
      title: "Who these terms are with",
      blocks: [
        { t: "ph", ph: "Legal name of the business, Companies House number, registered office address and VAT number if registered", hint: "The same details as the privacy policy and the site footer (R11.11)." },
        { t: "ph", ph: "Who these terms apply to (for example consumers ordering for personal use) and anything excluded, such as large or catering orders" },
      ],
    },
    {
      id: "ordering",
      title: "Placing and accepting an order",
      blocks: [
        { t: "ul", items: [
          "You can order only while the shop is open and taking orders. When it is closed or paused the site says so and the order button is switched off.",
          "Prices are checked again on our server when you order. If a price, delivery fee or offer has changed since you added items, you see the new total before you pay.",
          "When you place an order we pass it to the kitchen. The kitchen can accept it or decline it, for example if it is too busy or an item has run out. You can follow the status on your order page, and you are told if it is declined and why.",
          "Orders are for as soon as possible. You cannot choose a later time.",
        ] },
        { t: "ph", ph: "Legal wording on when the contract between you and the business is formed (when the kitchen accepts the order, not when you press the button) and on the shop's right to decline" },
      ],
    },
    {
      id: "prices",
      title: "Prices and offers",
      blocks: [
        { t: "ul", items: [
          "All prices are in pounds sterling.",
          "Offers and promo codes apply only on the dates, up to the limits and with the conditions shown with them. A code that has expired, been used up or does not apply to your basket is refused at checkout.",
        ] },
        { t: "ph", ph: "Statement on VAT (the menu currently says prices include VAT) and whether the business is VAT registered" },
        { t: "ph", ph: "Legal wording for offer conditions, misprinted prices and who can use an offer" },
      ],
    },
    {
      id: "delivery",
      title: "Delivery and collection",
      blocks: [
        { t: "ul", items: [
          "We deliver only to the postcode areas listed at checkout. Each area has its own delivery fee, minimum order and estimated time, and you see them before you pay.",
          "Times are estimates, not promises. They can change when the kitchen is busy.",
          "For collection, come to the shop and give your order number.",
        ] },
        { t: "ph", ph: "What happens if nobody answers the door or the address is wrong, and who is responsible for delays", hint: "Business and legal decision." },
        { t: "ph", ph: "Shop address and phone shown for collection and for problems with delivery", hint: "Contact details are confirmed by the owner, not assumed." },
      ],
    },
    {
      id: "payment",
      title: "Paying for your order",
      blocks: [
        { t: "ul", items: [
          "Card: you pay on the payment provider's own secure page. We never see or store your card number. Your order goes to the kitchen only once the payment is confirmed.",
          `If you start a card payment and do not finish it, the payment page closes after about 30 minutes, the order is cancelled automatically and you are not charged. Your basket stays as it was so you can try again.`,
          "Cash: you pay the driver, or the shop when you collect. The shop may set a highest order value for cash and a daily limit on cash orders per phone number and per internet connection. If you reach one, the site tells you and you can pay by card instead.",
        ] },
        { t: "ph", ph: "Payment provider's terms to be referred to, wording about failed or disputed payments, and any card surcharge (the site has none today)" },
      ],
    },
    {
      id: "allergens",
      title: "Allergies and halal",
      blocks: [
        { t: "p", text: "Please read our allergen information before you order, and call us before you eat if you are unsure. A printed allergen list comes with delivery orders. Anything you write in the order note is passed to the kitchen but is not a substitute for telling the staff about a serious allergy." },
        { t: "ph", ph: "Legal wording on allergens, cross-contamination and the business's responsibility" },
        { t: "ph", ph: "Wording of the halal claim and the certifier, if any", hint: "Needs the owner's confirmation of what can truthfully be said (open question Q4)." },
      ],
    },
    {
      id: "cancel",
      title: "Cancelling an order",
      blocks: [
        { t: "ul", items: [
          "There is no cancel button on the website. Once you have placed an order, contact the shop as quickly as you can.",
          "A card order you never pay for is cancelled automatically (see Paying for your order).",
          "The shop can cancel or decline an order. If you had already paid by card you are refunded.",
        ] },
        { t: "ph", ph: "The cancellation policy: whether and until when a customer may cancel an accepted order, and what happens once cooking has started" },
        { t: "ph", ph: "Statement on the right to cancel for food that is made to order or quickly goes off, in the wording the owner's adviser approves", hint: "UK consumer law has an exception for goods that spoil quickly. Whether and how it applies here is a legal decision." },
        { t: "ph", ph: "How to contact the shop to cancel (phone number, hours)" },
      ],
    },
    {
      id: "refunds",
      title: "Refunds and problems with your order",
      blocks: [
        { t: "ul", items: [
          "Card refunds are made by the shop, back to the card that was used. They are not automatic and are done by hand.",
          "If the shop declines a card order you had already paid for, it refunds you.",
          "Tell us about a missing, wrong or poor-quality item as soon as you can, with your order number.",
        ] },
        { t: "ph", ph: "The refund policy: when a full or partial refund or replacement is given, evidence needed, time limit for reporting problems, and how long a refund takes to reach your account" },
        { t: "ph", ph: "How to make a complaint, and who deals with it" },
      ],
    },
    {
      id: "legal",
      title: "Our responsibility and the law",
      blocks: [
        { t: "ph", ph: "Limits on liability, in the wording the owner's adviser approves", hint: "Must not exclude anything the law does not allow to be excluded." },
        { t: "ph", ph: "Governing law and which courts apply" },
        { t: "ph", ph: "How these terms and our Privacy Policy and Cookie Policy relate, and how changes to the terms are announced" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// Allergen page (R5.10, R11.10). The per-item information is NOT here: it comes from the menu
// (lib/allergens.ts) and only ever shows what the owner entered. This is the wording around it.

export const allergenNotice: LegalDoc = {
  slug: "allergens",
  title: "Allergen Information",
  intro: [
    { t: "p", text: "If you have a food allergy or intolerance, please read this page before you order and tell us when you order. If you are not sure about anything, call us before you eat." },
    { t: "p", text: "This page shows the allergen information the shop has entered for each item. Where an item says it is not confirmed yet, we have not told you anything about it, so do not assume it is free of any allergen: ask us." },
    { t: "ph", ph: "Date the allergen information was last checked by the owner" },
  ],
  sections: [
    {
      id: "how",
      title: "How to read the information",
      blocks: [
        { t: "ul", items: [
          "Contains: the allergens the shop has confirmed are in that item.",
          "No major allergens declared: the shop has checked and confirmed that none of the 14 is in it.",
          "Not confirmed yet: no information has been entered. This is not the same as “none”. Please ask.",
          "Options such as “Make it a Meal” have their own information. They can add allergens to the item you choose.",
        ] },
        { t: "p", text: "The 14 allergens that UK law requires us to tell you about are: celery, cereals containing gluten, crustaceans, eggs, fish, lupin, milk, molluscs, mustard, tree nuts, peanuts, sesame, soya and sulphur dioxide (sulphites)." },
      ],
    },
    {
      id: "kitchen",
      title: "Our kitchen",
      blocks: [
        { t: "ph", ph: "Cross-contamination statement: whether and how the kitchen can avoid traces of allergens, shared fryers and equipment, and what customers with severe allergies should do", hint: "Legal and food-safety decision. This must be true of the real kitchen." },
        { t: "ph", ph: "Wording about recipe or supplier changes and how allergen information is kept up to date" },
        { t: "ph", ph: "Phone number and times to call about allergens", hint: "Contact details are confirmed by the owner, not assumed." },
      ],
    },
  ],
};
