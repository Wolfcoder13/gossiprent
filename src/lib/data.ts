import "server-only";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  like,
  ne,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { cache } from "react";
import { getDb } from "@/db";
import { properties, reviews, users, type UserRole } from "@/db/schema";
import { KENNITALA_SHAPED } from "@/lib/kennitala";
import { placeName, postcodesMatching } from "@/lib/postcodes";
import { reviewerRole } from "@/lib/roles";
import { foldForSearch, propertyAddressKeys, SEARCH_FOLDS } from "@/lib/text";

/*
 * Read queries for the public pages and the dashboard. Locale-free: the pages
 * turn these values into words. Nothing here selects an email, a kennitala or
 * a password hash.
 */

export const PAGE_SIZE = 12;
export const REVIEWS_PAGE_SIZE = 10;

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** Everything about a person that's safe to show publicly. */
export type PublicUser = {
  id: string;
  name: string;
  isLandlord: boolean;
  isRenter: boolean;
  isCompany: boolean;
  /**
   * False for a profile created when someone reviewed this kennitala or named it
   * as a property's landlord, and not (yet) taken over by its owner.
   */
  hasAccount: boolean;
  /** Only accounts have a city and bio. */
  city: string | null;
  bio: string | null;
  /** When the account was created ("Member since"); null without an account. */
  joinedAt: Date | null;
  /** When the earliest review about them was written ("First reviewed"); null if none. */
  firstReviewedAt: Date | null;
};

export type RatingSummary = {
  average: number | null;
  count: number;
  /** Number of reviews at each star level, index 0 = 1 star … index 4 = 5 stars. */
  distribution: [number, number, number, number, number];
};

export type PersonListItem = PublicUser & {
  average: number | null;
  reviewCount: number;
  propertyCount: number;
};

export type PropertyListItem = {
  id: string;
  /** "Njálsgata 23" */
  address: string;
  /** The apartment as typed ("0201", "2. hæð t.v."), without "íbúð"; null if none. */
  unit: string | null;
  postalCode: number;
  /** The postcode's place name ("Reykjavík"). */
  place: string;
  description: string | null;
  /** hasAccount false: a renter named this landlord and they haven't confirmed it. */
  landlord: { id: string; name: string; hasAccount: boolean } | null;
  /** Who added the property; null if their account is gone. */
  createdById: string | null;
  createdAt: Date;
  average: number | null;
  reviewCount: number;
};

export type PropertyDetail = Omit<PropertyListItem, "average" | "reviewCount">;

export type ReviewSubject =
  | { kind: "landlord" | "renter"; id: string; name: string }
  | {
      kind: "property";
      id: string;
      address: string;
      unit: string | null;
      postalCode: number;
      place: string;
    };

export type ReviewItem = {
  id: string;
  rating: number;
  title: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  /** `role` is the role they wrote this review in (a renter, for a landlord review). */
  author: { id: string; name: string; role: UserRole; isLandlord: boolean; isRenter: boolean };
  subject: ReviewSubject;
};

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageCount: number;
};

/**
 * Who/what a set of reviews is about. For a person, `as` says which role:
 * someone who's both a landlord and a renter has separate ratings for each.
 */
export type ReviewTarget = { userId: string; as: UserRole } | { propertyId: string };

const roleColumn = (role: UserRole) => (role === "landlord" ? users.isLandlord : users.isRenter);

export type PersonSort = "top" | "most" | "newest" | "name";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route params are user input; anything that isn't a UUID can't match a row. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** `%query%` for LIKE, with the user's own `%`, `_` and `\` matched literally. */
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** 1-based page number from a search param, clamped to a sane range. */
export function parsePage(value: string | string[] | undefined): number {
  const page = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(page) && page > 0 ? Math.min(page, 10_000) : 1;
}

export function parseSort(value: string | string[] | undefined): PersonSort {
  const sort = Array.isArray(value) ? value[0] : value;
  return sort === "most" || sort === "newest" || sort === "name" ? sort : "top";
}

/**
 * A trimmed, length-limited search string from a search param. Empty for a
 * kennitala-shaped query, which must never be searched or echoed (pages
 * redirect those to the lookup form first; this is the backstop).
 */
export function parseQuery(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  // Postgres rejects NUL characters in text, so drop them rather than erroring.
  // Cut by code points (not UTF-16 units) so an emoji is never split in half,
  // and drop any lone surrogates the raw input already had.
  const cleaned = raw?.replaceAll("\u0000", "").toWellFormed().replaceAll("\uFFFD", "").trim() ?? "";
  if (KENNITALA_SHAPED.test(cleaned)) return "";
  const query = Array.from(cleaned).slice(0, 100).join("").trim();
  // A query with no words (e.g. just ",") would otherwise match everything.
  return searchTerms(query).length > 0 ? query : "";
}

/**
 * The words of a search, folded like the stored search columns ("Þórdís" →
 * "thordis"), so "Njalsgata 23, Reykjavik" matches across columns.
 */
export function searchTerms(query: string | undefined): string[] {
  const words = new Set<string>();
  for (const word of (query ?? "").split(/[\s,]+/)) {
    const folded = foldForSearch(word);
    if (folded) words.add(folded);
  }
  return [...words].slice(0, 8);
}

// A person's city has no stored search column, so fold it in SQL like foldForSearch
// does (lower() alone only folds ASCII under the C collation).
const SINGLE_FOLDS = Object.entries(SEARCH_FOLDS).filter(([, plain]) => plain.length === 1);
const MULTI_FOLDS = Object.entries(SEARCH_FOLDS).filter(([, plain]) => plain.length > 1);
const TRANSLATE_FROM = [
  ...SINGLE_FOLDS.flatMap(([accented]) => [accented, accented.toUpperCase()]),
  ...MULTI_FOLDS.map(([accented]) => accented.toUpperCase()),
].join("");
const TRANSLATE_TO = [
  ...SINGLE_FOLDS.flatMap(([, plain]) => [plain, plain]),
  ...MULTI_FOLDS.map(([accented]) => accented),
].join("");

function foldedSql(column: AnyColumn): SQL {
  let folded = sql`translate(lower(${column}), ${TRANSLATE_FROM}, ${TRANSLATE_TO})`;
  for (const [accented, plain] of MULTI_FOLDS) folded = sql`replace(${folded}, ${accented}, ${plain})`;
  return folded;
}

function paginate<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

const averageRating = sql<number | null>`round(avg(${reviews.rating}), 2)`.mapWith(Number);

// The users row of the surrounding query, for correlated subqueries. Drizzle leaves
// column names unqualified in a single-table select list, and inside a subquery a
// bare "id" would mean the subquery's own table.
const USERS_ID = sql.raw(`"users"."id"`);

const publicUserColumns = {
  id: users.id,
  name: users.name,
  isLandlord: users.isLandlord,
  isRenter: users.isRenter,
  isCompany: users.isCompany,
  hasAccount: sql<boolean>`${users.passwordHash} is not null`,
  city: users.city,
  bio: users.bio,
  joinedAt: users.joinedAt,
  firstReviewedAt: sql<Date | null>`(
    select min(${reviews.createdAt}) from ${reviews} where ${reviews.subjectUserId} = ${USERS_ID}
  )`.mapWith(reviews.createdAt),
};

function targetCondition(target: ReviewTarget): SQL {
  return "userId" in target
    ? and(eq(reviews.subjectUserId, target.userId), eq(reviews.kind, target.as))!
    : eq(reviews.propertyId, target.propertyId);
}

// ---------------------------------------------------------------------------
// People (landlords and renters, with or without an account)
// ---------------------------------------------------------------------------

// Memoized per request: generateMetadata and the page both ask for the same row.
export const getPublicUser = cache(
  async (id: string): Promise<PublicUser | null> => {
    if (!isUuid(id)) return null;
    const db = await getDb();
    const [user] = await db.select(publicUserColumns).from(users).where(eq(users.id, id)).limit(1);
    return user ?? null;
  },
);

export async function listPeople(options: {
  role: UserRole;
  query?: string;
  sort?: PersonSort;
  page?: number;
  pageSize?: number;
}): Promise<Paginated<PersonListItem>> {
  const { role, query, sort = "top", page = 1, pageSize = PAGE_SIZE } = options;
  const db = await getDb();

  const where = and(
    eq(roleColumn(role), true),
    // Every word must match the name or (only accounts have one) the city.
    ...searchTerms(query).map((term) =>
      or(like(users.nameSearch, likePattern(term)), like(foldedSql(users.city), likePattern(term))),
    ),
  );

  const byName = [asc(users.nameSort), asc(users.id)];
  const orderBy = {
    top: [sql`avg(${reviews.rating}) desc nulls last`, desc(count(reviews.id)), ...byName],
    most: [desc(count(reviews.id)), sql`avg(${reviews.rating}) desc nulls last`, ...byName],
    newest: [desc(users.createdAt), asc(users.id)],
    name: byName,
  }[sort];

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        ...publicUserColumns,
        average: averageRating,
        reviewCount: count(reviews.id),
        propertyCount: sql<number>`(
          select count(*) from ${properties} where ${properties.landlordId} = ${USERS_ID}
        )`.mapWith(Number),
      })
      .from(users)
      // Only the reviews about them in this role.
      .leftJoin(reviews, and(eq(reviews.subjectUserId, users.id), eq(reviews.kind, role)))
      .where(where)
      .groupBy(users.id)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(users).where(where),
  ]);

  return paginate(rows, total, page, pageSize);
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

const landlordUser = alias(users, "landlord_user");

const propertyColumns = {
  id: properties.id,
  address: properties.address,
  unit: properties.unit,
  postalCode: properties.postalCode,
  description: properties.description,
  createdById: properties.createdById,
  createdAt: properties.createdAt,
  landlordId: landlordUser.id,
  landlordName: landlordUser.name,
  landlordHasAccount: sql<boolean>`${landlordUser.passwordHash} is not null`,
};

type PropertyRow = {
  postalCode: number;
  landlordId: string | null;
  landlordName: string | null;
  landlordHasAccount: boolean;
};

function toPropertyDetail<T extends PropertyRow>({ landlordId, landlordName, landlordHasAccount, ...rest }: T) {
  return {
    ...rest,
    place: placeName(rest.postalCode),
    landlord: landlordId && landlordName ? { id: landlordId, name: landlordName, hasAccount: landlordHasAccount } : null,
  };
}

export async function listProperties(options: {
  query?: string;
  sort?: PersonSort;
  page?: number;
  pageSize?: number;
  /** Only properties this person is the landlord of. */
  landlordId?: string;
  /** Only properties this person added. */
  createdById?: string;
  /** Leave out properties this person is the landlord of. */
  notLandlordId?: string;
}): Promise<Paginated<PropertyListItem>> {
  const {
    query,
    sort = "top",
    page = 1,
    pageSize = PAGE_SIZE,
    landlordId,
    createdById,
    notLandlordId,
  } = options;
  const db = await getDb();

  const where = and(
    landlordId ? eq(properties.landlordId, landlordId) : undefined,
    createdById ? eq(properties.createdById, createdById) : undefined,
    notLandlordId
      ? or(isNull(properties.landlordId), ne(properties.landlordId, notLandlordId))
      : undefined,
    // Every word must match the address and apartment, or name the postcode or place.
    ...searchTerms(query).map((term) => {
      const postcodes = postcodesMatching(term);
      return or(
        like(properties.addressSearch, likePattern(term)),
        postcodes.length > 0 ? inArray(properties.postalCode, postcodes) : undefined,
      );
    }),
  );

  const byAddress = [asc(properties.addressSort), asc(properties.postalCode), asc(properties.id)];
  const orderBy = {
    top: [sql`avg(${reviews.rating}) desc nulls last`, desc(count(reviews.id)), ...byAddress],
    most: [desc(count(reviews.id)), sql`avg(${reviews.rating}) desc nulls last`, ...byAddress],
    newest: [desc(properties.createdAt), asc(properties.id)],
    name: byAddress,
  }[sort];

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ ...propertyColumns, average: averageRating, reviewCount: count(reviews.id) })
      .from(properties)
      .leftJoin(landlordUser, eq(landlordUser.id, properties.landlordId))
      .leftJoin(reviews, eq(reviews.propertyId, properties.id))
      .where(where)
      .groupBy(properties.id, landlordUser.id)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(properties).where(where),
  ]);

  return paginate(rows.map(toPropertyDetail), total, page, pageSize);
}

// Memoized per request: generateMetadata and the page both ask for the same row.
export const getProperty = cache(async (id: string): Promise<PropertyDetail | null> => {
  if (!isUuid(id)) return null;
  const db = await getDb();
  const [row] = await db
    .select(propertyColumns)
    .from(properties)
    .leftJoin(landlordUser, eq(landlordUser.id, properties.landlordId))
    .where(eq(properties.id, id))
    .limit(1);
  return row ? toPropertyDetail(row) : null;
});

/**
 * An existing property at the same address, apartment and postcode, compared
 * the way the unique index does (folded: "NJÁLSGATA 23, íbúð 0201" is "Njálsgata 23 0201").
 */
export async function findPropertyByAddress(p: {
  address: string;
  unit: string | null;
  postalCode: number;
}): Promise<{ id: string } | null> {
  const db = await getDb();
  const { addressSearch } = propertyAddressKeys(p.address, p.unit);
  const [row] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.addressSearch, addressSearch), eq(properties.postalCode, p.postalCode)))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

const author = alias(users, "author");
const subjectUser = alias(users, "subject_user");

async function queryReviews(options: {
  where: SQL | undefined;
  limit: number;
  offset?: number;
}): Promise<ReviewItem[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: reviews.id,
      kind: reviews.kind,
      rating: reviews.rating,
      title: reviews.title,
      body: reviews.body,
      createdAt: reviews.createdAt,
      updatedAt: reviews.updatedAt,
      authorId: author.id,
      authorName: author.name,
      authorIsLandlord: author.isLandlord,
      authorIsRenter: author.isRenter,
      subjectUserId: subjectUser.id,
      subjectUserName: subjectUser.name,
      propertyId: properties.id,
      propertyAddress: properties.address,
      propertyUnit: properties.unit,
      propertyPostalCode: properties.postalCode,
    })
    .from(reviews)
    .innerJoin(author, eq(author.id, reviews.authorId))
    .leftJoin(subjectUser, eq(subjectUser.id, reviews.subjectUserId))
    .leftJoin(properties, eq(properties.id, reviews.propertyId))
    .where(options.where)
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(options.limit)
    .offset(options.offset ?? 0);

  return rows.map((row) => ({
    id: row.id,
    rating: row.rating,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    author: {
      id: row.authorId,
      name: row.authorName,
      role: reviewerRole(row.kind),
      isLandlord: row.authorIsLandlord,
      isRenter: row.authorIsRenter,
    },
    subject:
      row.kind === "property"
        ? {
            kind: "property",
            id: row.propertyId!,
            address: row.propertyAddress!,
            unit: row.propertyUnit,
            postalCode: row.propertyPostalCode!,
            place: placeName(row.propertyPostalCode!),
          }
        : { kind: row.kind, id: row.subjectUserId!, name: row.subjectUserName! },
  }));
}

export async function getRatingSummary(target: ReviewTarget): Promise<RatingSummary> {
  const db = await getDb();
  const rows = await db
    .select({ rating: reviews.rating, count: count() })
    .from(reviews)
    .where(targetCondition(target))
    .groupBy(reviews.rating);

  const distribution: RatingSummary["distribution"] = [0, 0, 0, 0, 0];
  let total = 0;
  let sum = 0;
  for (const row of rows) {
    distribution[row.rating - 1] = row.count;
    total += row.count;
    sum += row.rating * row.count;
  }
  return {
    average: total > 0 ? Math.round((sum / total) * 100) / 100 : null,
    count: total,
    distribution,
  };
}

export async function listReviewsAbout(
  target: ReviewTarget,
  page = 1,
  pageSize = REVIEWS_PAGE_SIZE,
): Promise<Paginated<ReviewItem>> {
  const db = await getDb();
  const where = targetCondition(target);
  const [items, [{ total }]] = await Promise.all([
    queryReviews({ where, limit: pageSize, offset: (page - 1) * pageSize }),
    db.select({ total: count() }).from(reviews).where(where),
  ]);
  return paginate(items, total, page, pageSize);
}

/** The most recent reviews of any property this landlord manages, plus the total. */
export async function listReviewsOfLandlordProperties(
  landlordId: string,
  limit: number,
): Promise<{ items: ReviewItem[]; total: number }> {
  const db = await getDb();
  const [items, [{ total }]] = await Promise.all([
    queryReviews({ where: eq(properties.landlordId, landlordId), limit }),
    db
      .select({ total: count() })
      .from(reviews)
      .innerJoin(properties, eq(properties.id, reviews.propertyId))
      .where(eq(properties.landlordId, landlordId)),
  ]);
  return { items, total };
}

/** The most recent reviews this person wrote, plus the total. */
export async function listReviewsByAuthor(
  authorId: string,
  limit: number,
): Promise<{ items: ReviewItem[]; total: number }> {
  const db = await getDb();
  const [items, [{ total }]] = await Promise.all([
    queryReviews({ where: eq(reviews.authorId, authorId), limit }),
    db.select({ total: count() }).from(reviews).where(eq(reviews.authorId, authorId)),
  ]);
  return { items, total };
}

export async function listRecentReviews(limit: number): Promise<ReviewItem[]> {
  return queryReviews({ where: undefined, limit });
}

/** The review this author already wrote about the target, if any. */
export async function getReviewByAuthor(
  authorId: string,
  target: ReviewTarget,
): Promise<ReviewItem | null> {
  const [review] = await queryReviews({
    where: and(eq(reviews.authorId, authorId), targetCondition(target)),
    limit: 1,
  });
  return review ?? null;
}

// ---------------------------------------------------------------------------
// Site-wide
// ---------------------------------------------------------------------------

/** Counts for the home page. People are counted with or without an account. */
export async function getSiteStats(): Promise<{
  landlords: number;
  renters: number;
  properties: number;
  reviews: number;
}> {
  const db = await getDb();
  const [[roleCounts], [propertyCount], [reviewCount]] = await Promise.all([
    db
      .select({
        landlords: count(sql`case when ${users.isLandlord} then 1 end`),
        renters: count(sql`case when ${users.isRenter} then 1 end`),
      })
      .from(users),
    db.select({ count: count() }).from(properties),
    db.select({ count: count() }).from(reviews),
  ]);
  return {
    landlords: roleCounts.landlords,
    renters: roleCounts.renters,
    properties: propertyCount.count,
    reviews: reviewCount.count,
  };
}
