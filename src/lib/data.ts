import "server-only";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { cache } from "react";
import { getDb } from "@/db";
import { reviewerRole } from "@/lib/roles";
import {
  properties,
  reviews,
  users,
  type ReviewKind,
  type UserRole,
} from "@/db/schema";

export const PAGE_SIZE = 12;
export const REVIEWS_PAGE_SIZE = 10;

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** Everything about a user that's safe to show publicly (never the email). */
type PublicUser = {
  id: string;
  name: string;
  isLandlord: boolean;
  isRenter: boolean;
  city: string | null;
  bio: string | null;
  createdAt: Date;
  /** Set when the person closed their account (their profile and the reviews about them remain). */
  deletedAt: Date | null;
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
  address: string;
  unit: string | null;
  city: string;
  region: string;
  postalCode: string | null;
  description: string | null;
  landlord: { id: string; name: string } | null;
  createdAt: Date;
  average: number | null;
  reviewCount: number;
};

type PropertyDetail = Omit<PropertyListItem, "average" | "reviewCount">;

type ReviewSubject = { kind: ReviewKind; id: string; name: string };

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

type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageCount: number;
};

/**
 * Who/what a set of reviews is about. For a person, `as` says which role:
 * someone who's both a landlord and a renter has separate ratings for each.
 */
type ReviewTarget = { userId: string; as: UserRole } | { propertyId: string };

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

/** `%query%` for ILIKE, with the user's own `%`, `_` and `\` matched literally. */
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

/** A trimmed, length-limited search string from a search param. */
export function parseQuery(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  // Postgres rejects NUL characters in text, so drop them rather than erroring.
  // Cut by code points (not UTF-16 units) so an emoji is never split in half,
  // and drop any lone surrogates the raw input already had.
  const cleaned = raw?.replaceAll("\u0000", "").toWellFormed().replaceAll("\uFFFD", "").trim() ?? "";
  const query = Array.from(cleaned).slice(0, 100).join("").trim();
  // A query with no words (e.g. just ",") would otherwise match everything.
  return searchPatterns(query).length > 0 ? query : "";
}

/**
 * ILIKE patterns for each word of a search, so "Austin, TX" or "4521 Clark
 * Chicago" match even though the words live in different columns.
 */
export function searchPatterns(query: string | undefined): string[] {
  // De-duplicate ignoring case, but search with the words as typed: JavaScript
  // and Postgres lower-case some letters differently (Greek final sigma,
  // Turkish dotted İ), and ILIKE is already case-insensitive.
  const words = new Map<string, string>();
  for (const word of (query ?? "").split(/[\s,]+/)) {
    if (word && !words.has(word.toLowerCase())) words.set(word.toLowerCase(), word);
  }
  return [...words.values()].slice(0, 8).map(likePattern);
}

function paginate<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

const averageRating = sql<number | null>`round(avg(${reviews.rating}), 2)`.mapWith(Number);

const publicUserColumns = {
  id: users.id,
  name: users.name,
  isLandlord: users.isLandlord,
  isRenter: users.isRenter,
  city: users.city,
  bio: users.bio,
  createdAt: users.createdAt,
  deletedAt: users.deletedAt,
};

function targetCondition(target: ReviewTarget): SQL {
  return "userId" in target
    ? and(eq(reviews.subjectUserId, target.userId), eq(reviews.kind, target.as))!
    : eq(reviews.propertyId, target.propertyId);
}

/** "1408 E 6th St, Unit 2B" */
export function propertyLabel(p: { address: string; unit: string | null }): string {
  return p.unit ? `${p.address}, Unit ${p.unit}` : p.address;
}

// ---------------------------------------------------------------------------
// People (landlords and renters)
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

  const personText = sql`concat_ws(' ', ${users.name}, ${users.city})`;
  const where = and(
    eq(roleColumn(role), true),
    ...searchPatterns(query).map((pattern) => ilike(personText, pattern)),
  );

  const byName = [sql`lower(${users.name})`, asc(users.name)];
  const orderBy = {
    top: [sql`avg(${reviews.rating}) desc nulls last`, desc(count(reviews.id)), ...byName],
    most: [desc(count(reviews.id)), sql`avg(${reviews.rating}) desc nulls last`, ...byName],
    newest: [desc(users.createdAt)],
    name: byName,
  }[sort];

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        ...publicUserColumns,
        average: averageRating,
        reviewCount: count(reviews.id),
        propertyCount: sql<number>`(
          select count(*) from ${properties} where ${properties.landlordId} = ${users.id}
        )`.mapWith(Number),
      })
      .from(users)
      // Only the reviews about them in this role.
      .leftJoin(reviews, and(eq(reviews.subjectUserId, users.id), eq(reviews.kind, role)))
      .where(where)
      .groupBy(users.id)
      .orderBy(...orderBy, asc(users.id))
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

export async function listProperties(options: {
  query?: string;
  sort?: PersonSort;
  page?: number;
  pageSize?: number;
  landlordId?: string;
  createdById?: string;
  /** Leave out properties this landlord manages. */
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

  // Everything a renter might type: "1408 E 6th St, Unit 2B, Austin TX 78702", or the landlord.
  const propertyText = sql`concat_ws(' ', ${properties.address}, 'Unit ' || ${properties.unit},
    ${properties.city}, ${properties.region}, ${properties.postalCode}, ${landlordUser.name})`;
  const where = and(
    landlordId ? eq(properties.landlordId, landlordId) : undefined,
    createdById ? eq(properties.createdById, createdById) : undefined,
    notLandlordId
      ? or(isNull(properties.landlordId), ne(properties.landlordId, notLandlordId))
      : undefined,
    ...searchPatterns(query).map((pattern) => ilike(propertyText, pattern)),
  );

  const byAddress = [sql`lower(${properties.address})`, sql`lower(coalesce(${properties.unit}, ''))`];
  const orderBy = {
    top: [sql`avg(${reviews.rating}) desc nulls last`, desc(count(reviews.id)), ...byAddress],
    most: [desc(count(reviews.id)), sql`avg(${reviews.rating}) desc nulls last`, ...byAddress],
    newest: [desc(properties.createdAt)],
    name: byAddress,
  }[sort];

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: properties.id,
        address: properties.address,
        unit: properties.unit,
        city: properties.city,
        region: properties.region,
        postalCode: properties.postalCode,
        description: properties.description,
        createdAt: properties.createdAt,
        landlordId: landlordUser.id,
        landlordName: landlordUser.name,
        average: averageRating,
        reviewCount: count(reviews.id),
      })
      .from(properties)
      .leftJoin(landlordUser, eq(landlordUser.id, properties.landlordId))
      .leftJoin(reviews, eq(reviews.propertyId, properties.id))
      .where(where)
      .groupBy(properties.id, landlordUser.id)
      .orderBy(...orderBy, asc(properties.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: count() })
      .from(properties)
      .leftJoin(landlordUser, eq(landlordUser.id, properties.landlordId))
      .where(where),
  ]);

  const items = rows.map(({ landlordId: lid, landlordName, ...rest }) => ({
    ...rest,
    landlord: lid && landlordName ? { id: lid, name: landlordName } : null,
  }));
  return paginate(items, total, page, pageSize);
}

// Memoized per request: generateMetadata and the page both ask for the same row.
export const getProperty = cache(async (id: string): Promise<PropertyDetail | null> => {
  if (!isUuid(id)) return null;
  const db = await getDb();
  const [row] = await db
    .select({
      id: properties.id,
      address: properties.address,
      unit: properties.unit,
      city: properties.city,
      region: properties.region,
      postalCode: properties.postalCode,
      description: properties.description,
      createdAt: properties.createdAt,
      landlordId: landlordUser.id,
      landlordName: landlordUser.name,
    })
    .from(properties)
    .leftJoin(landlordUser, eq(landlordUser.id, properties.landlordId))
    .where(eq(properties.id, id))
    .limit(1);
  if (!row) return null;
  const { landlordId, landlordName, ...rest } = row;
  return {
    ...rest,
    landlord: landlordId && landlordName ? { id: landlordId, name: landlordName } : null,
  };
});

/** An existing property at the same address (case-insensitive), if any. */
export async function findPropertyByAddress(p: {
  address: string;
  unit: string | null;
  city: string;
  region: string;
}): Promise<{ id: string } | null> {
  const db = await getDb();
  const [row] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(
      and(
        sql`lower(${properties.address}) = lower(${p.address})`,
        sql`lower(coalesce(${properties.unit}, '')) = lower(${p.unit ?? ""})`,
        sql`lower(${properties.city}) = lower(${p.city})`,
        sql`lower(${properties.region}) = lower(${p.region})`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Landlords to pick from when a renter adds the place they rent. */
export async function listLandlordOptions(): Promise<
  { id: string; name: string; city: string | null }[]
> {
  const db = await getDb();
  return db
    .select({ id: users.id, name: users.name, city: users.city })
    .from(users)
    .where(and(eq(users.isLandlord, true), isNull(users.deletedAt)))
    .orderBy(sql`lower(${users.name})`, asc(users.name))
    .limit(1000);
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
      propertyCity: properties.city,
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
            name: `${propertyLabel({ address: row.propertyAddress!, unit: row.propertyUnit })}, ${row.propertyCity}`,
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
