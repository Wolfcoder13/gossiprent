import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * What a review is about:
 * - "landlord": a renter reviewing a landlord (subjectUserId is set)
 * - "renter":   a landlord reviewing a renter (subjectUserId is set)
 * - "property": a renter reviewing the place they rent (propertyId is set)
 */
export const reviewKind = pgEnum("review_kind", [
  "landlord",
  "renter",
  "property",
]);

/**
 * Everyone with a kennitala that GossipRent knows about: people (and
 * companies) with an account, and profiles without one, which are created
 * when someone reviews a kennitala, or links it as a property's landlord.
 * Signing up with that kennitala later takes the profile over.
 *
 * The kennitala is never shown publicly; only src/lib/people.ts queries by it.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 10 digits, no separator.
    kennitala: char("kennitala", { length: 10 }).notNull(),
    isCompany: boolean("is_company").notNull().default(false),
    name: text("name").notNull(),
    // Derived from name on every write (src/lib/text.ts): A–Ö order, and
    // accent-insensitive search ("Thordis" finds "Þórdís").
    nameSort: text("name_sort").notNull(),
    nameSearch: text("name_search").notNull(),
    // Account fields: all set (an account) or all null (a profile without one).
    // Always stored lower-cased so the unique index is case-insensitive.
    email: text("email"),
    passwordHash: text("password_hash"),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    // Someone can rent a home and also rent one out, so a person can be a
    // landlord, a renter, or both. Reviews say which role they're about.
    isLandlord: boolean("is_landlord").notNull().default(false),
    isRenter: boolean("is_renter").notNull().default(false),
    city: text("city"),
    bio: text("bio"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("users_kennitala_unique").on(t.kennitala),
    uniqueIndex("users_email_unique").on(t.email),
    index("users_is_landlord_idx").on(t.isLandlord).where(sql`${t.isLandlord}`),
    index("users_is_renter_idx").on(t.isRenter).where(sql`${t.isRenter}`),
    index("users_name_sort_idx").on(t.nameSort),
    check("users_kennitala_digits", sql`${t.kennitala} ~ '^[0-9]{10}$'`),
    check("users_has_a_role", sql`${t.isLandlord} or ${t.isRenter}`),
    check(
      "users_account_complete",
      sql`(${t.email} is null) = (${t.passwordHash} is null) and (${t.email} is null) = (${t.joinedAt} is null)`,
    ),
    check(
      "users_profile_text_needs_account",
      sql`${t.email} is not null or (${t.city} is null and ${t.bio} is null)`,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256 of the random token stored in the visitor's cookie. The raw token
    // never touches the database, so a leaked table can't be used to log in.
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const properties = pgTable(
  "properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // "Njálsgata 23" and an optional apartment ("0201" or "2. hæð t.v.").
    address: text("address").notNull(),
    unit: text("unit"),
    // Icelandic postcode; the place name comes from src/lib/postcodes.ts.
    postalCode: smallint("postal_code").notNull(),
    description: text("description"),
    // Derived on every write (src/lib/text.ts): addressSort orders A–Ö;
    // addressSearch = foldForSearch(`${address} ${unit}`), used for search and uniqueness.
    addressSort: text("address_sort").notNull(),
    addressSearch: text("address_search").notNull(),
    // Restrict: a landlord profile is only deleted once nothing refers to it.
    landlordId: uuid("landlord_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("properties_landlord_id_idx").on(t.landlordId),
    index("properties_created_by_id_idx").on(t.createdById),
    index("properties_postal_code_idx").on(t.postalCode),
    // The same street address + apartment in the same postcode is one property.
    // address_search is folded in TS (Postgres lower() only handles ASCII under
    // the C collation), so "ÁLFHEIMAR 3" and "Álfheimar 3" are one address.
    uniqueIndex("properties_address_unique").on(t.addressSearch, t.postalCode),
    check("properties_postal_code_range", sql`${t.postalCode} between 100 and 999`),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: reviewKind("kind").notNull(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Restrict, not cascade: nothing may delete reviews about someone by
    // deleting the person or the property. (Authors' own reviews do cascade.)
    subjectUserId: uuid("subject_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    propertyId: uuid("property_id").references(() => properties.id, {
      onDelete: "restrict",
    }),
    rating: smallint("rating").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("reviews_rating_range", sql`${t.rating} between 1 and 5`),
    check(
      "reviews_subject_matches_kind",
      sql`(${t.kind} = 'property' and ${t.propertyId} is not null and ${t.subjectUserId} is null)
        or (${t.kind} <> 'property' and ${t.subjectUserId} is not null and ${t.propertyId} is null)`,
    ),
    check(
      "reviews_not_self",
      sql`${t.subjectUserId} is null or ${t.subjectUserId} <> ${t.authorId}`,
    ),
    // One review per author per person / per property. Writing again edits it.
    // Per kind, so someone who is both can be reviewed once as a landlord and
    // once as a renter by the same person.
    uniqueIndex("reviews_author_subject_user_kind_unique")
      .on(t.authorId, t.subjectUserId, t.kind)
      .where(sql`${t.subjectUserId} is not null`),
    uniqueIndex("reviews_author_property_unique")
      .on(t.authorId, t.propertyId)
      .where(sql`${t.propertyId} is not null`),
    index("reviews_subject_user_idx").on(t.subjectUserId, t.createdAt),
    index("reviews_property_idx").on(t.propertyId, t.createdAt),
    index("reviews_author_idx").on(t.authorId, t.createdAt),
    index("reviews_created_at_idx").on(t.createdAt),
  ],
);

/**
 * One row per recent login/signup attempt, keyed by e.g. "login:ip:1.2.3.4".
 * Used for rate limiting; old rows are pruned as new ones are written.
 */
export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("auth_attempts_key_created_at_idx").on(t.key, t.createdAt)],
);

export const reportTarget = pgEnum("report_target", ["review", "profile", "property", "account"]);

export const reportReason = pgEnum("report_reason", [
  "wrong_person",
  "wrong_name",
  "false_or_abusive",
  "personal_data",
  "identity_claimed",
  "other",
]);

/** Problems people report to the site's operator (see scripts/admin.ts). */
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetKind: reportTarget("target_kind").notNull(),
    // The review, profile or property reported (null for "someone has my account").
    targetId: uuid("target_id"),
    reason: reportReason("reason").notNull(),
    details: text("details").notNull(),
    contactEmail: text("contact_email"),
    reporterId: uuid("reporter_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolution: text("resolution"),
  },
  (t) => [index("reports_unresolved_idx").on(t.createdAt).where(sql`${t.resolvedAt} is null`)],
);

export type UserRole = "landlord" | "renter";
export type ReviewKind = (typeof reviewKind.enumValues)[number];
export type ReportTarget = (typeof reportTarget.enumValues)[number];
export type ReportReason = (typeof reportReason.enumValues)[number];
