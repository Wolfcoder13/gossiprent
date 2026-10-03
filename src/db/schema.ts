import { sql } from "drizzle-orm";
import {
  boolean,
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

export const USER_ROLES = ["landlord", "renter"] as const;

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

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // Always stored lower-cased so the unique index is case-insensitive.
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    // Someone can rent a home and also rent one out, so a person can be a
    // landlord, a renter, or both. Reviews say which role they're about.
    isLandlord: boolean("is_landlord").notNull().default(false),
    isRenter: boolean("is_renter").notNull().default(false),
    city: text("city"),
    bio: text("bio"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Set when someone closes their account. The profile stays (anonymized
    // login details, no bio) so reviews others wrote about them aren't erased.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("users_email_unique").on(t.email),
    index("users_is_landlord_idx").on(t.isLandlord).where(sql`${t.isLandlord}`),
    index("users_is_renter_idx").on(t.isRenter).where(sql`${t.isRenter}`),
    check("users_has_a_role", sql`${t.isLandlord} or ${t.isRenter}`),
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
    address: text("address").notNull(),
    unit: text("unit"),
    city: text("city").notNull(),
    region: text("region").notNull(),
    postalCode: text("postal_code"),
    description: text("description"),
    landlordId: uuid("landlord_id").references(() => users.id, {
      onDelete: "set null",
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
    index("properties_city_idx").on(t.city),
    // The same street address + unit in the same city/region is one property.
    uniqueIndex("properties_address_unique").on(
      sql`lower(${t.address})`,
      sql`lower(coalesce(${t.unit}, ''))`,
      sql`lower(${t.city})`,
      sql`lower(${t.region})`,
    ),
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
    subjectUserId: uuid("subject_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    propertyId: uuid("property_id").references(() => properties.id, {
      onDelete: "cascade",
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

export type UserRole = (typeof USER_ROLES)[number];
export type ReviewKind = (typeof reviewKind.enumValues)[number];
export type User = typeof users.$inferSelect;
export type Property = typeof properties.$inferSelect;
export type Review = typeof reviews.$inferSelect;
