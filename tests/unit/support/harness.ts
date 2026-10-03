/**
 * Shared setup for unit tests that run server code against a real database:
 * a throwaway embedded Postgres per test file (or the freshly migrated Postgres
 * named by UNIT_DATABASE_URL), fake Next request APIs (next-mocks.ts), and
 * helpers to create people, properties, reviews and visitors.
 *
 * Wiring, at the top of a test file (vi.mock calls must be in the test file
 * itself so Vitest can hoist them):
 *
 *   import { vi } from "vitest";
 *   vi.mock("next/headers", async () => (await import("./support/next-mocks")).nextHeadersMock);
 *   vi.mock("next/navigation", async () => (await import("./support/next-mocks")).nextNavigationMock);
 *   vi.mock("next/cache", async () => (await import("./support/next-mocks")).nextCacheMock);
 *   import { createUser, form, logInAs, outcome } from "./support/harness";
 *
 * Importing this module configures the database and registers hooks: open the
 * database before the file's tests, start every test as a new visitor (fresh
 * IP, cookie jar with lang=en, nobody logged in), clear the next/cache spies,
 * undo vi.stubEnv after each test, and close and delete the database at the end.
 * Rate limits are on (AUTH_RATE_LIMIT unset) and X-Real-IP is trusted; turn
 * limits off for a file with `vi.stubEnv("AUTH_RATE_LIMIT", "off")` in a beforeEach.
 *
 * Against a real Postgres (concurrency tests need one; the embedded database
 * runs one transaction at a time):
 *
 *   createdb gossiprent_unit
 *   DATABASE_URL=postgres://…/gossiprent_unit node scripts/migrate.mjs
 *   UNIT_DATABASE_URL=postgres://…/gossiprent_unit npx vitest run tests/unit
 *
 * That database is shared by every file and every run, so tests must only use
 * data they created (unique(), freshKennitala(), freshIp()).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { getDb } from "@/db";
import { closeDatabase } from "@/db/connect";
import { authAttempts, properties, reviews, users, type ReviewKind, type UserRole } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { isAdultKennitala, parseKennitalaInput } from "@/lib/kennitala";
import { personNameKeys, propertyAddressKeys } from "@/lib/text";
import {
  activeVisitor,
  asVisitor,
  makeVisitor,
  nextCacheMock,
  NotFoundSignal,
  RedirectSignal,
  setCurrentVisitor,
  type Visitor,
} from "./next-mocks";

export { asVisitor, NotFoundSignal, RedirectSignal, type Visitor };
export { nextCacheMock };

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

// Read lazily by "@/db" on the first getDb() call, so setting them here (at
// import time, before any test runs) is early enough.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "gossiprent-unit-"));
process.env.PGLITE_DATA_DIR = path.join(root, "pglite");
process.env.SEED_DEMO_DATA = "false";
process.env.DATABASE_URL = process.env.UNIT_DATABASE_URL ?? "";
process.env.POSTGRES_URL = "";
process.env.VERCEL = "";
delete process.env.AUTH_RATE_LIMIT;
// The tests play the part of a reverse proxy that sets X-Real-IP (see clientIp).
process.env.TRUST_PROXY_HEADERS = "true";

/** True when running against UNIT_DATABASE_URL (real concurrency) instead of the embedded database. */
export const usingPostgres = Boolean(process.env.UNIT_DATABASE_URL);

export { getDb };

beforeAll(async () => {
  // Opens the database and runs the migrations.
  await getDb();
}, 60_000);

afterAll(async () => {
  const holder = globalThis as typeof globalThis & { __gossiprentDb?: Promise<unknown> };
  if (holder.__gossiprentDb) {
    await closeDatabase(await getDb());
    holder.__gossiprentDb = undefined;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  newVisitor();
  for (const spy of Object.values(nextCacheMock)) spy.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Unique values
// ---------------------------------------------------------------------------

let counter = 0;
/** A short token no other call (in this run) returns. */
export function unique(): string {
  counter += 1;
  return `${counter}${Math.random().toString(36).slice(2, 8)}`;
}

const ipRun = Math.floor(Math.random() * 0xffff).toString(16);
let ipCounter = 0;
/** A documentation-range IPv6 address no other test (or earlier run) uses. */
export function freshIp(): string {
  ipCounter += 1;
  return `2001:db8:${ipRun}::${ipCounter.toString(16)}`;
}

const DAY = 24 * 60 * 60 * 1000;
// Each day has 800 numbers: digits 7–8 from 20 to 99, digit 9 from 0 to 9.
const PER_DAY = 800;
const RANGES = {
  // Born 1960–1999 (the 10th digit, 9, is the century).
  adult: { from: Date.UTC(1960, 0, 1), days: 14_610 },
  // Born two to five years ago: a minor for as long as these tests exist.
  minor: { from: Date.now() - 5 * 365 * DAY, days: 3 * 365 },
  // Registered 1970–1999 (companies add 40 to the day).
  company: { from: Date.UTC(1970, 0, 1), days: 10_957 },
};
// Consecutive numbers from a random starting point, so runs sharing one
// database (UNIT_DATABASE_URL) practically never pick the same numbers.
const kennitalaStart = Math.floor(Math.random() * RANGES.company.days * PER_DAY);
let kennitalaCounter = 0;

function kennitalaAt(kind: keyof typeof RANGES, index: number): string {
  const range = RANGES[kind];
  const slot = index % (range.days * PER_DAY);
  const date = new Date(range.from + Math.floor(slot / PER_DAY) * DAY);
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = date.getUTCDate() + (kind === "company" ? 40 : 0);
  const year = date.getUTCFullYear();
  const serial = 200 + (slot % PER_DAY);
  return `${pad(day)}${pad(date.getUTCMonth() + 1)}${pad(year % 100)}${serial}${Math.floor(year / 100) % 10}`;
}

/**
 * A valid kennitala (10 digits) nobody else in this run has: an adult born
 * 1960–1999 by default, or a child, or a company.
 */
export function freshKennitala(kind: "adult" | "minor" | "company" = "adult"): string {
  for (;;) {
    kennitalaCounter += 1;
    const value = kennitalaAt(kind, kennitalaStart + kennitalaCounter);
    const parsed = parseKennitalaInput(value);
    if (!parsed || parsed.type !== (kind === "company" ? "company" : "person")) continue;
    if (kind !== "company" && isAdultKennitala(parsed) !== (kind === "adult")) continue;
    return value;
  }
}

// ---------------------------------------------------------------------------
// Visitors and requests
// ---------------------------------------------------------------------------

/** Act as a new visitor from `ip` (null: no proxy headers), with a cookie jar holding only lang=en. */
export function newVisitor(ip: string | null = freshIp()): Visitor {
  const visitor = makeVisitor(ip);
  setCurrentVisitor(visitor);
  return visitor;
}

/** The visitor requests come from right now. */
export function currentVisitor(): Visitor {
  return activeVisitor();
}

/** Go back to acting as an earlier visitor. */
export function useVisitor(visitor: Visitor): void {
  setCurrentVisitor(visitor);
}

/**
 * Start two requests at (nearly) the same moment. `i` varies which one starts
 * first and the gap between them, so a loop over i tries several interleavings.
 * Wrap each in asVisitor(visitor, …) to give it its own cookies.
 */
export async function atOnce<A, B>(a: () => Promise<A>, b: () => Promise<B>, i = 0): Promise<[A, B]> {
  const delay = [0, 0, 1, 2, 3, 5, 8, 13][Math.floor(i / 2) % 8];
  const pause = () => new Promise((resolve) => setTimeout(resolve, delay));
  if (i % 2 === 0) {
    const first = a();
    await pause();
    return Promise.all([first, b()]);
  }
  const first = b();
  await pause();
  const second = a();
  const [bResult, aResult] = await Promise.all([first, second]);
  return [aResult, bResult];
}

/** FormData from plain fields; undefined fields are left out. */
export function form(fields: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) data.set(key, value);
  return data;
}

/** An action's result, or where it redirected to (with the redirect type when one was given). */
export async function outcome<T>(
  promise: Promise<T>,
): Promise<T | { redirect: string; type?: "push" | "replace" }> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof RedirectSignal) return { redirect: error.url, ...(error.type ? { type: error.type } : {}) };
    throw error;
  }
}

/** Log `user` in as a new visitor (session cookie set); later requests come from that visitor. */
export async function logInAs(user: { id: string }): Promise<Visitor> {
  const visitor = newVisitor();
  // Imported here: session.ts uses next/headers, whose mock loads next-mocks.ts.
  const { createSession } = await import("@/lib/auth/session");
  await createSession(user.id);
  return visitor;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type Roles = UserRole | "both";

export type TestUser = {
  id: string;
  name: string;
  /** 10 digits. */
  kennitala: string;
  isCompany: boolean;
  isLandlord: boolean;
  isRenter: boolean;
  hasAccount: boolean;
  /** Null for a profile without an account. */
  email: string | null;
  password: string | null;
};

/**
 * Insert a person directly (fast; skips the signup action and its checks):
 * an account by default, or with `account: false` a profile without one.
 */
export async function createUser(options: {
  roles: Roles;
  account?: boolean;
  name?: string;
  kennitala?: string;
  company?: boolean;
  city?: string;
}): Promise<TestUser> {
  const { roles, account = true, company = false } = options;
  const db = await getDb();
  const id = unique();
  const kennitala = options.kennitala ?? freshKennitala(company ? "company" : "adult");
  const keys = personNameKeys(options.name ?? (company ? `Prófun ${id} ehf.` : `Unit ${roles} ${id}`));
  const email = account ? `unit-${id}@example.com` : null;
  const password = account ? `pw-${id}-secret` : null;
  const isLandlord = roles !== "renter";
  const isRenter = roles !== "landlord";
  const [row] = await db
    .insert(users)
    .values({
      kennitala,
      isCompany: company,
      ...keys,
      isLandlord,
      isRenter,
      ...(account
        ? { email, passwordHash: await hashPassword(password!), joinedAt: new Date(), city: options.city ?? null }
        : {}),
    })
    .returning({ id: users.id });
  return {
    id: row.id,
    name: keys.name,
    kennitala,
    isCompany: company,
    isLandlord,
    isRenter,
    hasAccount: account,
    email,
    password,
  };
}

export type TestProperty = { id: string; address: string; unit: string | null; postalCode: number };

/**
 * Insert a property directly; the address defaults to a unique street in 101
 * Reykjavík. `landlordConfirmed` (default false) is whether the landlord
 * confirmed the link themselves (listed it as their own, or claimed it).
 */
export async function insertProperty(options: {
  landlordId: string | null;
  createdById: string | null;
  landlordConfirmed?: boolean;
  address?: string;
  unit?: string | null;
  postalCode?: number;
  description?: string;
}): Promise<TestProperty> {
  const db = await getDb();
  const keys = propertyAddressKeys(options.address ?? `Prófunargata ${unique()}`, options.unit);
  const postalCode = options.postalCode ?? 101;
  const [row] = await db
    .insert(properties)
    .values({
      ...keys,
      postalCode,
      description: options.description ?? null,
      landlordId: options.landlordId,
      landlordConfirmed: options.landlordConfirmed ?? false,
      createdById: options.createdById,
    })
    .returning({ id: properties.id });
  return { id: row.id, address: keys.address, unit: keys.unit, postalCode };
}

/** Insert a review directly, skipping the permission checks (and leaving role flags alone). */
export async function insertReview(values: {
  kind: ReviewKind;
  authorId: string;
  subjectUserId?: string;
  propertyId?: string;
  rating?: number;
  title?: string;
  body?: string;
}): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .insert(reviews)
    .values({
      kind: values.kind,
      authorId: values.authorId,
      subjectUserId: values.subjectUserId ?? null,
      propertyId: values.propertyId ?? null,
      rating: values.rating ?? 3,
      title: values.title ?? `Title ${unique()}`,
      body: values.body ?? "A review body that is long enough to be valid.",
    })
    .returning({ id: reviews.id });
  return row.id;
}

/** The users row as stored (kennitala, account fields, flags…), or null if it's gone. */
export async function userRow(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}

/** Recorded rate-limit attempts for `key`. */
export async function attemptsFor(key: string): Promise<number> {
  const db = await getDb();
  return (await db.select({ id: authAttempts.id }).from(authAttempts).where(eq(authAttempts.key, key))).length;
}

/** `times` recent attempts for `key`, written straight to the table (faster than real ones). */
export async function seedAttempts(key: string, times: number): Promise<void> {
  if (times <= 0) return;
  const db = await getDb();
  await db.insert(authAttempts).values(Array.from({ length: times }, () => ({ key })));
}
