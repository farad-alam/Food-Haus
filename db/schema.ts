import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  time,
  timestamp,
  uniqueIndex,
  date,
} from "drizzle-orm/pg-core";

// Requirements section 12 data model. Money = whole pence. Times = UTC
// (shown in Europe/London). Order lines copy name + price at order time.

export const orderStatus = pgEnum("order_status", [
  "pending_payment",
  "received",
  "preparing",
  "ready",
  "out_for_delivery",
  "completed",
  "rejected",
  "cancelled",
  "refunded",
]);
export const orderType = pgEnum("order_type", ["delivery", "collection"]);
export const paymentMethod = pgEnum("payment_method", ["card", "cash"]);
export const paymentStatus = pgEnum("payment_status", ["unpaid", "paid", "failed", "refunded"]);
export const offerType = pgEnum("offer_type", ["percentage", "fixed", "free_delivery", "bogof"]);
export const offerChannel = pgEnum("offer_channel", ["any", "delivery", "collection"]);
export const adminRole = pgEnum("admin_role", ["owner", "manager", "kitchen"]);

export const category = pgTable("category", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  visible: boolean("visible").notNull().default(true),
});

export const item = pgTable(
  "item",
  {
    id: serial("id").primaryKey(),
    categoryId: integer("category_id").notNull().references(() => category.id),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description").notNull().default(""),
    price: integer("price").notNull(), // pence
    photo: text("photo"),
    photoAlt: text("photo_alt"), // R11.15; falls back to name
    // The 14 UK allergens. null = not yet supplied (blocks launch, R11.10).
    allergens: jsonb("allergens").$type<string[] | null>(),
    dietaryTags: jsonb("dietary_tags").$type<string[]>().notNull().default([]),
    soldOut: boolean("sold_out").notNull().default(false),
    visible: boolean("visible").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("item_category_idx").on(t.categoryId)],
);

export const optionGroup = pgTable("option_group", {
  id: serial("id").primaryKey(),
  // A group can hang off a single item or a whole category (e.g. "Make it a Meal").
  itemId: integer("item_id").references(() => item.id),
  categoryId: integer("category_id").references(() => category.id),
  name: text("name").notNull(),
  required: boolean("required").notNull().default(false),
  minPicks: integer("min_picks").notNull().default(0),
  maxPicks: integer("max_picks").notNull().default(1),
});

export const option = pgTable("option", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => optionGroup.id),
  name: text("name").notNull(),
  priceChange: integer("price_change").notNull().default(0), // pence
  sortOrder: integer("sort_order").notNull().default(0),
});

export const offer = pgTable("offer", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: offerType("type").notNull(),
  value: integer("value"), // percent, or pence for fixed
  appliesToCategoryId: integer("applies_to_category_id").references(() => category.id), // bogof
  channel: offerChannel("channel").notNull().default("any"),
  code: text("code"),
  minSpend: integer("min_spend").notNull().default(0),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  usageLimit: integer("usage_limit"),
  usedCount: integer("used_count").notNull().default(0),
  showOnSite: boolean("show_on_site").notNull().default(true),
});

export const order = pgTable(
  "order",
  {
    id: serial("id").primaryKey(),
    // Human-friendly number shown on screen and to the kitchen.
    number: integer("number").generatedAlwaysAsIdentity({ startWith: 1001 }),
    // R13.15: public URL token — 128-bit random, never the number.
    token: text("token").notNull(),
    // R13.7: client-generated key makes order creation idempotent.
    idempotencyKey: text("idempotency_key").notNull(),
    type: orderType("type").notNull(),
    status: orderStatus("status").notNull().default("pending_payment"),
    paymentMethod: paymentMethod("payment_method").notNull(),
    paymentStatus: paymentStatus("payment_status").notNull().default("unpaid"),
    subtotal: integer("subtotal").notNull(),
    deliveryFee: integer("delivery_fee").notNull().default(0),
    discount: integer("discount").notNull().default(0),
    total: integer("total").notNull(),
    customerName: text("customer_name").notNull(),
    phone: text("phone").notNull(),
    email: text("email").notNull(),
    address: text("address"),
    postcode: text("postcode"),
    note: text("note"),
    // R6.15: keyed hash of the client IP, only used to cap cash orders per IP.
    ipHash: text("ip_hash"),
    rejectionReason: text("rejection_reason"),
    prepMinutes: integer("prep_minutes"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    stripeSessionId: text("stripe_session_id"),
    offerId: integer("offer_id").references(() => offer.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // R13.12: set when contact details are anonymised after retention.
    anonymisedAt: timestamp("anonymised_at", { withTimezone: true }),
    // Set (atomically claimed) just before each email is sent so a retry or a
    // replayed webhook can never send the same email twice.
    confirmationEmailedAt: timestamp("confirmation_emailed_at", { withTimezone: true }),
    shopNotifiedAt: timestamp("shop_notified_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("order_token_idx").on(t.token),
    uniqueIndex("order_idempotency_idx").on(t.idempotencyKey),
    uniqueIndex("order_stripe_session_idx").on(t.stripeSessionId),
    index("order_status_idx").on(t.status, t.createdAt),
    index("order_phone_idx").on(t.phone, t.createdAt),
    index("order_ip_idx").on(t.ipHash, t.createdAt),
  ],
);

export const orderItem = pgTable("order_item", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => order.id),
  name: text("name").notNull(), // copied at order time
  unitPrice: integer("unit_price").notNull(), // copied, pence
  quantity: integer("quantity").notNull(),
  options: jsonb("options").$type<{ name: string; priceChange: number }[]>().notNull().default([]),
  lineTotal: integer("line_total").notNull(),
});

// R8.5: every Stripe event id is stored; repeats are ignored.
export const stripeEvent = pgTable("stripe_event", {
  id: text("id").primaryKey(), // evt_...
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deliveryZone = pgTable("delivery_zone", {
  id: serial("id").primaryKey(),
  district: text("district").notNull().unique(), // e.g. "LU4"
  fee: integer("fee").notNull(),
  minOrder: integer("min_order").notNull(),
  estimatedMinutes: integer("estimated_minutes").notNull(),
  active: boolean("active").notNull().default(true),
});

export const openingHours = pgTable("opening_hours", {
  id: serial("id").primaryKey(),
  weekday: integer("weekday").notNull(), // 0 = Sunday
  opensAt: time("opens_at").notNull(),
  closesAt: time("closes_at").notNull(),
});

export const closure = pgTable("closure", {
  id: serial("id").primaryKey(),
  day: date("day").notNull(),
  reason: text("reason"),
});

export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1), // single row
  paused: boolean("paused").notNull().default(false),
  pausedMessage: text("paused_message"),
  defaultPrepMinutes: integer("default_prep_minutes").notNull().default(20),
  noticeBar: text("notice_bar"),
  cashMaxPence: integer("cash_max_pence"), // R6.10; null = no cap
  cashDailyCapPerPhone: integer("cash_daily_cap_per_phone").notNull().default(3), // R6.15
  cashDailyCapPerIp: integer("cash_daily_cap_per_ip").notNull().default(5), // R6.15
  contact: jsonb("contact").$type<Record<string, string>>().notNull().default({}),
});

export const adminUser = pgTable("admin_user", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(), // argon2id / bcrypt (R13.3)
  role: adminRole("role").notNull(),
  totpSecretEnc: text("totp_secret_enc"), // R9.2 — AES-GCM envelope, see lib/auth/secret-box.ts
  totpLastStep: integer("totp_last_step"), // replay protection: last accepted 30s step
  disabled: boolean("disabled").notNull().default(false),
  lastLogin: timestamp("last_login", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Server-side sessions. Only the SHA-256 of the cookie token is stored, so a
// database leak does not yield usable session cookies.
export const adminSession = pgTable(
  "admin_session",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: integer("user_id").notNull().references(() => adminUser.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("admin_session_user_idx").on(t.userId)],
);

// Throttling counters (failed logins, reset requests), keyed by an opaque string.
export const authEvent = pgTable(
  "auth_event",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [index("auth_event_key_idx").on(t.key, t.at)],
);

export const passwordResetToken = pgTable("password_reset_token", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id").notNull().references(() => adminUser.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

// R9.13 (Must): the only record of who did what, given the shared kitchen login.
export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => adminUser.id),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});
