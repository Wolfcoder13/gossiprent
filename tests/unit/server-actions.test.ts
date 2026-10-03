/**
 * Server Actions run against a throwaway embedded database, with Next's
 * request APIs (headers, cookies, redirect, revalidatePath) replaced by small
 * fakes. Covers what the end-to-end suite can't easily reach: rate limiting
 * (the e2e server runs with AUTH_RATE_LIMIT=off) and server-side checks that
 * only a tampered request would hit.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const testDb = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gossiprent-unit-actions-"));
  process.env.PGLITE_DATA_DIR = path.join(root, "pglite");
  process.env.SEED_DEMO_DATA = "false";
  // UNIT_DATABASE_URL runs this file against a real Postgres instead (a freshly
  // migrated database used only for tests), e.g. to check the rate limiter
  // under real concurrency with a connection pool.
  process.env.DATABASE_URL = process.env.UNIT_DATABASE_URL ?? "";
  process.env.POSTGRES_URL = "";
  process.env.VERCEL = "";
  delete process.env.AUTH_RATE_LIMIT;
  // These tests play the part of a reverse proxy that sets X-Real-IP /
  // X-Forwarded-For, so trust those headers (see clientIp).
  process.env.TRUST_PROXY_HEADERS = "true";
  return { root };
});

/** One fake "browser": its request headers and cookie jar. */
const browser = vi.hoisted(() => ({
  headers: new Headers(),
  cookies: new Map<string, string>(),
}));

// Both read the *current* fake browser when called, which a Server Action
// does synchronously when it starts. So parallel calls can each have their own
// headers by changing `browser.headers` between starting them.
vi.mock("next/headers", () => ({
  headers: async () => browser.headers,
  cookies: async () => {
    const jar = browser.cookies;
    return {
      get: (name: string) => {
        const value = jar.get(name);
        return value === undefined ? undefined : { name, value };
      },
      set: (name: string, value: string) => {
        jar.set(name, value);
      },
      delete: (name: string) => {
        jar.delete(name);
      },
    };
  },
}));

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`redirect to ${url}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import fs from "node:fs";
import { eq, like } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { changePassword, deleteAccount, signOutOtherDevices } from "@/app/actions/account";
import { login, signup } from "@/app/actions/auth";
import { claimProperty, unlinkProperty } from "@/app/actions/properties";
import { getDb } from "@/db";
import { closeDatabase } from "@/db/connect";
import { authAttempts, properties, reviews, sessions, users } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { idleFormState, type FormState } from "@/lib/validation";

const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";
const NO_MATCH = "That email and password don't match an account.";
const NOT_CURRENT = "That isn't your current password.";
const MISMATCH = "The new passwords don't match.";
const CLAIMED = "Done. You're now listed as this property's landlord.";
const ALREADY_MANAGED = "Another landlord already manages this property.";
const UNLINKED = "Done. You're no longer listed as this property's landlord.";
const NOT_LISTED = "You aren't listed as this property's landlord.";
const LOG_IN_AGAIN = "Please log in again.";

let counter = 0;
function unique(): string {
  counter += 1;
  return `${counter}${Math.random().toString(36).slice(2, 8)}`;
}

const ipRun = Math.floor(Math.random() * 0xffff).toString(16);
let ipCounter = 0;
/**
 * A documentation-range IPv6 address no other test (or earlier run against the
 * same database) uses, so tests don't share per-network buckets.
 */
function freshIp(): string {
  ipCounter += 1;
  return `2001:db8:${ipRun}::${ipCounter.toString(16)}`;
}

/** Act as a new visitor from `ip` (empty cookie jar). */
function newVisitor(ip = freshIp()): string {
  browser.headers = new Headers({ "x-real-ip": ip });
  browser.cookies = new Map();
  return ip;
}

/** Act as a new visitor whose IP address the server can't tell (no proxy headers). */
function newVisitorWithoutIp(): void {
  browser.headers = new Headers();
  browser.cookies = new Map();
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

type Roles = "landlord" | "renter";
type CreatedUser = { id: string; email: string; password: string; name: string };

/** Insert a user directly (fast; skips the signup action and its rate limit). */
async function createUser(roles: Roles = "renter"): Promise<CreatedUser> {
  const db = await getDb();
  const id = unique();
  const email = `unit-${id}@example.com`;
  const password = `pw-${id}-secret`;
  const name = `Unit ${roles} ${id}`;
  const [row] = await db
    .insert(users)
    .values({
      name,
      email,
      passwordHash: await hashPassword(password),
      isLandlord: roles !== "renter",
      isRenter: roles !== "landlord",
      city: "Testville",
    })
    .returning({ id: users.id });
  return { id: row.id, email, password, name };
}

/** Run an action that's expected to redirect; returns where it redirected to. */
async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.url;
    throw error;
  }
  throw new Error("expected a redirect");
}

/** The action's result, or where it redirected to. */
async function outcome(promise: Promise<FormState>): Promise<FormState | { redirect: string }> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof RedirectSignal) return { redirect: error.url };
    throw error;
  }
}

function tryLogin(email: string, password: string, next?: string): Promise<FormState | { redirect: string }> {
  return outcome(login(idleFormState, form({ email, password, ...(next ? { next } : {}) })));
}

/** Log `user` in on the current fake browser (sets the session cookie). */
async function logInAs(user: CreatedUser): Promise<void> {
  expect(await tryLogin(user.email, user.password)).toEqual({ redirect: "/dashboard" });
  expect(browser.cookies.get(SESSION_COOKIE)).toBeTruthy();
}

async function sessionCount(userId: string): Promise<number> {
  const db = await getDb();
  return (await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId))).length;
}

/** Recorded rate-limit attempts for `key`. */
async function attemptsFor(key: string): Promise<number> {
  const db = await getDb();
  return (await db.select({ id: authAttempts.id }).from(authAttempts).where(eq(authAttempts.key, key))).length;
}

/** Recorded rate-limit attempts whose key starts with `prefix`. */
async function attemptsStartingWith(prefix: string): Promise<number> {
  const db = await getDb();
  return (await db.select({ id: authAttempts.id }).from(authAttempts).where(like(authAttempts.key, `${prefix}%`)))
    .length;
}

/** `times` recent attempts for `key`, written straight to the table (faster than real ones). */
async function seedAttempts(key: string, times: number): Promise<void> {
  const db = await getDb();
  await db.insert(authAttempts).values(Array.from({ length: times }, () => ({ key })));
}

const accountKey = (email: string) => `login:account:${email}`;
const accountAndIpKey = (email: string, ip: string) => `login:account-ip:${email}|${ip}`;
const ipKey = (ip: string) => `login:ip:${ip}`;

async function insertReview(values: {
  kind: "landlord" | "renter" | "property";
  authorId: string;
  subjectUserId?: string;
  propertyId?: string;
}): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .insert(reviews)
    .values({
      kind: values.kind,
      authorId: values.authorId,
      subjectUserId: values.subjectUserId ?? null,
      propertyId: values.propertyId ?? null,
      rating: 3,
      title: `Title ${unique()}`,
      body: "A review body that is long enough to be valid.",
    })
    .returning({ id: reviews.id });
  return row.id;
}

async function insertProperty(landlordId: string | null, createdById: string | null): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .insert(properties)
    .values({ address: `${unique()} Unit Test Ave`, city: "Testville", region: "TS", landlordId, createdById })
    .returning({ id: properties.id });
  return row.id;
}

async function landlordOf(propertyId: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db
    .select({ landlordId: properties.landlordId })
    .from(properties)
    .where(eq(properties.id, propertyId));
  return row.landlordId;
}

beforeAll(async () => {
  await getDb();
}, 60_000);

afterAll(async () => {
  const holder = globalThis as typeof globalThis & { __gossiprentDb?: Promise<unknown> };
  if (holder.__gossiprentDb) {
    await closeDatabase(await getDb());
    holder.__gossiprentDb = undefined;
  }
  fs.rmSync(testDb.root, { recursive: true, force: true });
});

beforeEach(() => {
  newVisitor();
  vi.mocked(revalidatePath).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Login rate limiting
// ---------------------------------------------------------------------------

describe("login rate limiting", () => {
  it("blocks an account on one network after 10 failed attempts, even with the right password", async () => {
    const user = await createUser();
    for (let i = 0; i < 10; i++) {
      const result = await tryLogin(user.email, "wrong-password");
      expect(result).toMatchObject({ status: "error", message: NO_MATCH });
    }
    const blocked = await tryLogin(user.email, user.password);
    expect(blocked).toMatchObject({ status: "error", message: TOO_MANY, values: { email: user.email } });
    // The password is never echoed back.
    expect(JSON.stringify(blocked)).not.toContain(user.password);
    expect(browser.cookies.get(SESSION_COOKIE)).toBeUndefined();
  }, 30_000);

  it("a stranger's failed guesses from another network don't lock the owner out", async () => {
    const owner = await createUser();
    const ownerIp = freshIp();

    // A stranger guesses from their own network until they're blocked.
    const strangerIp = newVisitor();
    for (let i = 0; i < 10; i++) {
      expect(await tryLogin(owner.email, "wrong-password")).toMatchObject({ message: NO_MATCH });
    }
    for (let i = 0; i < 5; i++) {
      expect(await tryLogin(owner.email, "wrong-password")).toMatchObject({ message: TOO_MANY });
    }
    // Even with the right password, they stay blocked on that network.
    expect(await tryLogin(owner.email, owner.password)).toMatchObject({ message: TOO_MANY });

    // The owner, on their own network, logs in fine.
    newVisitor(ownerIp);
    await logInAs(owner);

    // ...which doesn't unblock the stranger's network.
    newVisitor(strangerIp);
    expect(await tryLogin(owner.email, owner.password)).toMatchObject({ message: TOO_MANY });
  }, 30_000);

  it("strangers on several networks still can't lock the owner out", async () => {
    const owner = await createUser();
    // 9 networks x 10 failures = 90, under the per-account backstop of 100.
    for (let n = 0; n < 9; n++) {
      newVisitor();
      for (let i = 0; i < 10; i++) {
        expect(await tryLogin(owner.email, "wrong-password")).toMatchObject({ message: NO_MATCH });
      }
      expect(await tryLogin(owner.email, "wrong-password")).toMatchObject({ message: TOO_MANY });
    }
    expect(await attemptsFor(accountKey(owner.email))).toBe(90);
    newVisitor();
    await logInAs(owner);
  }, 60_000);

  it("more than 100 failures across networks block the account everywhere", async () => {
    const user = await createUser();
    // 10 networks x 10 failures, each network staying within its own limit.
    for (let n = 0; n < 10; n++) {
      newVisitor();
      for (let i = 0; i < 10; i++) {
        expect(await tryLogin(user.email, "wrong-password")).toMatchObject({ message: NO_MATCH });
      }
    }
    // The 101st attempt is refused from any network, even with the right password.
    newVisitor();
    expect(await tryLogin(user.email, user.password)).toMatchObject({ message: TOO_MANY });
    expect(browser.cookies.get(SESSION_COOKIE)).toBeUndefined();
    newVisitor();
    expect(await tryLogin(user.email, user.password)).toMatchObject({ message: TOO_MANY });
    // Blocked attempts aren't counted, so the block doesn't grow.
    expect(await attemptsFor(accountKey(user.email))).toBe(100);
  }, 60_000);

  it("99 recent failures for an account still allow a login (the 100th attempt)", async () => {
    const user = await createUser();
    await seedAttempts(accountKey(user.email), 99);
    await logInAs(user);
    await seedAttempts(accountKey(user.email), 1);
    newVisitor();
    expect(await tryLogin(user.email, user.password)).toMatchObject({ message: TOO_MANY });
  });

  it("treats different casing and spacing of the email as the same account", async () => {
    const user = await createUser();
    const variants = [user.email.toUpperCase(), `  ${user.email}  `, user.email.replace("unit", "UNIT")];
    for (let i = 0; i < 10; i++) await tryLogin(variants[i % variants.length], "wrong-password");
    expect(await tryLogin(user.email, user.password)).toMatchObject({ message: TOO_MANY });
  }, 30_000);

  it("doesn't block other accounts from the same network", async () => {
    const victim = await createUser();
    const other = await createUser();
    for (let i = 0; i < 10; i++) await tryLogin(victim.email, "wrong-password");
    expect(await tryLogin(victim.email, victim.password)).toMatchObject({ message: TOO_MANY });
    expect(await tryLogin(other.email, other.password)).toEqual({ redirect: "/dashboard" });
  }, 30_000);

  it("a successful login isn't counted and forgets this network's misses for the account", async () => {
    const user = await createUser();
    const ip = newVisitor();
    for (let i = 0; i < 9; i++) await tryLogin(user.email, "wrong-password");
    await logInAs(user);

    expect(await attemptsFor(accountAndIpKey(user.email, ip))).toBe(0);
    // The misses still count toward the per-account and per-network limits; the success doesn't.
    expect(await attemptsFor(accountKey(user.email))).toBe(9);
    expect(await attemptsFor(ipKey(ip))).toBe(9);

    browser.cookies = new Map();
    for (let i = 0; i < 10; i++) {
      expect(await tryLogin(user.email, "wrong-password")).toMatchObject({ message: NO_MATCH });
    }
    // 19 failures from this network in total, but only 10 since the last success.
    expect(await tryLogin(user.email, user.password)).toMatchObject({ message: TOO_MANY });
  }, 30_000);

  it("release() un-counts successful logins, so they never add up to a block", async () => {
    const user = await createUser();
    const ip = newVisitor();
    // One short of the per-network limit (50).
    await seedAttempts(ipKey(ip), 49);
    // More successful logins than any limit allows attempts.
    for (let i = 0; i < 12; i++) {
      browser.cookies = new Map();
      expect(await tryLogin(user.email, user.password), `login ${i + 1}`).toEqual({ redirect: "/dashboard" });
    }
    expect(await attemptsFor(ipKey(ip))).toBe(49);
    expect(await attemptsFor(accountKey(user.email))).toBe(0);
    expect(await attemptsFor(accountAndIpKey(user.email, ip))).toBe(0);
  }, 30_000);

  it("failed attempts for unknown emails count too", async () => {
    const email = `nobody-${unique()}@example.com`;
    for (let i = 0; i < 10; i++) {
      expect(await tryLogin(email, "whatever-password")).toMatchObject({ message: NO_MATCH });
    }
    expect(await tryLogin(email, "whatever-password")).toMatchObject({ message: TOO_MANY });
  }, 30_000);

  it("blocks a network after 50 failed attempts across accounts", async () => {
    const ip = newVisitor();
    // 50 recent failures from this network (recorded directly, to keep the test fast).
    await seedAttempts(ipKey(ip), 50);
    const user = await createUser();
    expect(await tryLogin(user.email, user.password)).toMatchObject({ message: TOO_MANY });
    // Not counted against the account.
    expect(await attemptsFor(accountKey(user.email))).toBe(0);

    // Same account, different network: fine.
    newVisitor();
    expect(await tryLogin(user.email, user.password)).toEqual({ redirect: "/dashboard" });
  });

  it("49 failures from a network are still allowed", async () => {
    const ip = newVisitor();
    await seedAttempts(ipKey(ip), 49);
    const user = await createUser();
    expect(await tryLogin(user.email, user.password)).toEqual({ redirect: "/dashboard" });
  });

  it("reads the IP from x-forwarded-for when x-real-ip is missing", async () => {
    const ip = freshIp();
    await seedAttempts(ipKey(ip), 50);
    const user = await createUser();
    browser.headers = new Headers({ "x-forwarded-for": `${ip}, 10.0.0.1` });
    expect(await tryLogin(user.email, user.password)).toMatchObject({ message: TOO_MANY });
    browser.headers = new Headers({ "x-forwarded-for": `${freshIp()}, ${ip}` });
    expect(await tryLogin(user.email, user.password)).toEqual({ redirect: "/dashboard" });
  });

  it("without a known IP address, the per-network limit is skipped (no shared bucket)", async () => {
    newVisitorWithoutIp();
    // Nothing that looks like a shared "unknown network" bucket is consulted...
    for (const key of ["login:ip:unknown", "login:ip:null", "login:ip:", "login:ip:undefined"]) {
      await seedAttempts(key, 60);
    }
    const before = await attemptsStartingWith("login:ip:");

    // ...and 54 failures across 6 accounts don't block a 7th one.
    for (let a = 0; a < 6; a++) {
      const email = `noip-${unique()}@example.com`;
      for (let i = 0; i < 9; i++) {
        expect(await tryLogin(email, "wrong-password")).toMatchObject({ message: NO_MATCH });
      }
    }
    const user = await createUser();
    await logInAs(user);
    // ...nor is anything recorded under a per-network key.
    expect(await attemptsStartingWith("login:ip:")).toBe(before);
  }, 60_000);

  it("without a known IP address, the per-account limits still apply", async () => {
    const user = await createUser();
    newVisitorWithoutIp();
    for (let i = 0; i < 10; i++) {
      expect(await tryLogin(user.email, "wrong-password")).toMatchObject({ message: NO_MATCH });
    }
    expect(await tryLogin(user.email, user.password)).toMatchObject({ message: TOO_MANY });
    expect(await attemptsFor(accountAndIpKey(user.email, "unknown"))).toBe(10);
    // A visitor whose IP is known has their own per-network allowance.
    newVisitor();
    await logInAs(user);
  }, 30_000);

  it("self-hosted without TRUST_PROXY_HEADERS, a faked IP header doesn't buy fresh attempts", async () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "");
    const user = await createUser();
    // A new made-up X-Real-IP / X-Forwarded-For on every guess...
    for (let i = 0; i < 10; i++) {
      newVisitor();
      browser.headers.set("x-forwarded-for", freshIp());
      expect(await tryLogin(user.email, "wrong-password")).toMatchObject({ message: NO_MATCH });
    }
    // ...all counted as one unknown network, so the per-account limit kicks in.
    newVisitor();
    expect(await tryLogin(user.email, user.password)).toMatchObject({ message: TOO_MANY });
    expect(await attemptsFor(accountAndIpKey(user.email, "unknown"))).toBe(10);
  }, 30_000);

  it("invalid form input doesn't count as an attempt", async () => {
    const user = await createUser();
    for (let i = 0; i < 15; i++) {
      const result = await tryLogin(user.email, "");
      expect(result).toMatchObject({ status: "error", fieldErrors: { password: ["Enter your password."] } });
    }
    expect(await attemptsFor(accountKey(user.email))).toBe(0);
    expect(await tryLogin(user.email, user.password)).toEqual({ redirect: "/dashboard" });
  }, 30_000);

  it("is switched off by AUTH_RATE_LIMIT=off", async () => {
    vi.stubEnv("AUTH_RATE_LIMIT", "off");
    const user = await createUser();
    for (let i = 0; i < 12; i++) await tryLogin(user.email, "wrong-password");
    expect(await tryLogin(user.email, user.password)).toEqual({ redirect: "/dashboard" });
    expect(await attemptsFor(accountKey(user.email))).toBe(0);
  }, 30_000);

  it("parallel guesses from one network can't exceed the per-account-and-network limit", async () => {
    const user = await createUser();
    const results = await Promise.all(
      Array.from({ length: 30 }, () => login(idleFormState, form({ email: user.email, password: "wrong-password" }))),
    );
    const checked = results.filter((r) => r.message === NO_MATCH).length;
    const blocked = results.filter((r) => r.message === TOO_MANY).length;
    expect(checked + blocked).toBe(30);
    // At most 10 guesses may actually be checked against the password.
    expect(checked).toBeLessThanOrEqual(10);
    expect(await attemptsFor(accountKey(user.email))).toBe(checked);
  }, 30_000);

  it("a parallel burst of exactly 10 guesses is all checked, and the next one is refused", async () => {
    const user = await createUser();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => login(idleFormState, form({ email: user.email, password: "wrong-password" }))),
    );
    expect(results.map((r) => r.message)).toEqual(Array.from({ length: 10 }, () => NO_MATCH));
    expect(await tryLogin(user.email, user.password)).toMatchObject({ message: TOO_MANY });
  }, 30_000);

  it("parallel guesses from many networks can't exceed the per-account limit", async () => {
    const user = await createUser();
    const results = await Promise.all(
      Array.from({ length: 130 }, () => {
        // Each call reads the headers as it starts, so each one has its own IP.
        newVisitor();
        return login(idleFormState, form({ email: user.email, password: "wrong-password" }));
      }),
    );
    const checked = results.filter((r) => r.message === NO_MATCH).length;
    const blocked = results.filter((r) => r.message === TOO_MANY).length;
    expect(checked + blocked).toBe(130);
    expect(checked).toBeLessThanOrEqual(100);
    expect(await attemptsFor(accountKey(user.email))).toBe(checked);
  }, 60_000);

  it("parallel guesses across accounts from one network can't exceed the per-network limit", async () => {
    newVisitor();
    const results = await Promise.all(
      Array.from({ length: 80 }, () =>
        login(idleFormState, form({ email: `spray-${unique()}@example.com`, password: "wrong-password" })),
      ),
    );
    const checked = results.filter((r) => r.message === NO_MATCH).length;
    const blocked = results.filter((r) => r.message === TOO_MANY).length;
    expect(checked + blocked).toBe(80);
    expect(checked).toBeLessThanOrEqual(50);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Sign-up rate limiting
// ---------------------------------------------------------------------------

function signupForm(overrides: Record<string, string> = {}): FormData {
  const id = unique();
  return form({
    name: `Signup ${id}`,
    email: `signup-${id}@example.com`,
    password: "long-enough-password",
    isRenter: "on",
    city: "",
    ...overrides,
  });
}

describe("sign-up rate limiting", () => {
  it("allows 20 sign-ups per IP per hour, then refuses", async () => {
    const ip = newVisitor();
    await seedAttempts(`signup:ip:${ip}`, 19);
    // The 20th sign-up goes through.
    expect(await redirectOf(signup(idleFormState, signupForm()))).toBe("/dashboard");

    browser.cookies = new Map();
    const id = unique();
    const blocked = await signup(idleFormState, signupForm({ name: `Blocked ${id}`, email: `blocked-${id}@example.com` }));
    expect(blocked).toMatchObject({
      status: "error",
      message: TOO_MANY,
      values: { name: `Blocked ${id}`, email: `blocked-${id}@example.com`, isRenter: "on" },
    });
    expect(blocked.values).not.toHaveProperty("password");
    const db = await getDb();
    expect(await db.select().from(users).where(eq(users.email, `blocked-${id}@example.com`))).toEqual([]);
    // The refused sign-up isn't counted.
    expect(await attemptsFor(`signup:ip:${ip}`)).toBe(20);

    // Another IP can still sign up.
    newVisitor();
    expect(await redirectOf(signup(idleFormState, signupForm()))).toBe("/dashboard");
  });

  it("invalid sign-ups don't use up the allowance", async () => {
    const ip = newVisitor();
    await seedAttempts(`signup:ip:${ip}`, 19);
    for (let i = 0; i < 5; i++) {
      const result = await signup(idleFormState, signupForm({ password: "short" }));
      expect(result).toMatchObject({ status: "error", fieldErrors: { password: expect.any(Array) } });
    }
    expect(await redirectOf(signup(idleFormState, signupForm()))).toBe("/dashboard");
  });

  it("a duplicate email still counts as an attempt (so it can't be used to probe for free)", async () => {
    const existing = await createUser();
    const ip = newVisitor();
    await seedAttempts(`signup:ip:${ip}`, 19);
    const duplicate = await signup(idleFormState, signupForm({ email: existing.email }));
    expect(duplicate.fieldErrors?.email).toEqual(["An account with this email already exists. Try logging in instead."]);
    expect(await signup(idleFormState, signupForm())).toMatchObject({ message: TOO_MANY });
  });

  it("is switched off by AUTH_RATE_LIMIT=off", async () => {
    vi.stubEnv("AUTH_RATE_LIMIT", "off");
    const ip = newVisitor();
    await seedAttempts(`signup:ip:${ip}`, 25);
    expect(await redirectOf(signup(idleFormState, signupForm()))).toBe("/dashboard");
  });

  it("isn't limited per IP when the IP address is unknown", async () => {
    newVisitorWithoutIp();
    for (const key of ["signup:ip:unknown", "signup:ip:null", "signup:ip:"]) await seedAttempts(key, 25);
    const before = await attemptsStartingWith("signup:ip:");
    for (let i = 0; i < 3; i++) {
      browser.cookies = new Map();
      expect(await redirectOf(signup(idleFormState, signupForm()))).toBe("/dashboard");
    }
    expect(await attemptsStartingWith("signup:ip:")).toBe(before);
  });

  it("parallel sign-ups from one IP can't exceed the limit", async () => {
    const ip = newVisitor();
    await seedAttempts(`signup:ip:${ip}`, 15);
    const results = await Promise.all(
      Array.from({ length: 15 }, () => outcome(signup(idleFormState, signupForm()))),
    );
    const created = results.filter((r) => "redirect" in r).length;
    const blocked = results.filter((r) => "message" in r && r.message === TOO_MANY).length;
    expect(created + blocked).toBe(15);
    // Only 5 of the 20 per hour were left.
    expect(created).toBeLessThanOrEqual(5);
    expect(await attemptsFor(`signup:ip:${ip}`)).toBe(15 + created);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Password change and sessions
// ---------------------------------------------------------------------------

async function tryChangePassword(
  currentPassword: string,
  newPassword: string,
  confirmPassword = newPassword,
): Promise<FormState> {
  return changePassword(idleFormState, form({ currentPassword, newPassword, confirmPassword }));
}

async function hasPassword(userId: string, password: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId));
  return verifyPassword(password, row.hash);
}

describe("changePassword", () => {
  it("requires a signed-in user", async () => {
    expect(await tryChangePassword("anything", "new-password-1")).toEqual({
      status: "error",
      message: LOG_IN_AGAIN,
    });
  });

  it("validates the fields", async () => {
    const user = await createUser();
    await logInAs(user);
    const result = await tryChangePassword("", "short");
    expect(result.status).toBe("error");
    expect(result.fieldErrors).toEqual({
      currentPassword: ["Enter your current password."],
      newPassword: ["Password must be at least 8 characters."],
    });
    // Password values are never echoed back to the form.
    expect(result.values).toEqual({});
  });

  it("requires the new password to be typed the same way twice", async () => {
    const user = await createUser();
    await logInAs(user);
    const result = await tryChangePassword(user.password, "brand-new-password", "brand-new-passwrod");
    expect(result).toMatchObject({
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { confirmPassword: [MISMATCH] },
      values: {},
    });
    expect(Object.keys(result.fieldErrors ?? {})).toEqual(["confirmPassword"]);
    expect(JSON.stringify(result)).not.toContain("brand-new-pass");
    // Nothing changed, and the mistake didn't use up an attempt.
    expect(await hasPassword(user.id, user.password)).toBe(true);
    expect(await attemptsFor(`password:user:${user.id}`)).toBe(0);
  });

  it("rejects a missing confirmation (a tampered form)", async () => {
    const user = await createUser();
    await logInAs(user);
    const result = await changePassword(
      idleFormState,
      form({ currentPassword: user.password, newPassword: "brand-new-password" }),
    );
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.confirmPassword).toBeDefined();
    expect(await hasPassword(user.id, user.password)).toBe(true);
  });

  it("rejects a wrong current password and keeps the old one", async () => {
    const user = await createUser();
    await logInAs(user);
    const result = await tryChangePassword("not-my-password", "brand-new-password");
    expect(result).toMatchObject({
      status: "error",
      fieldErrors: { currentPassword: [NOT_CURRENT] },
    });
    expect(await hasPassword(user.id, user.password)).toBe(true);
  });

  it("changes the password and signs out every other session, keeping this one", async () => {
    const user = await createUser();
    // Two other devices...
    await logInAs(user);
    newVisitor();
    await logInAs(user);
    // ...and this one.
    newVisitor();
    await logInAs(user);
    const thisDevice = new Map(browser.cookies);
    expect(await sessionCount(user.id)).toBe(3);

    const result = await tryChangePassword(user.password, "brand-new-password");
    expect(result).toEqual({
      status: "success",
      message: "Password changed. You've been signed out on your other devices.",
    });
    expect(await sessionCount(user.id)).toBe(1);
    expect(browser.cookies).toEqual(thisDevice);

    newVisitor();
    expect(await tryLogin(user.email, user.password)).toMatchObject({ message: NO_MATCH });
    expect(await tryLogin(user.email, "brand-new-password")).toEqual({ redirect: "/dashboard" });
  });

  it("is rate limited per user: 10 wrong guesses block even the right password", async () => {
    const user = await createUser();
    await logInAs(user);
    for (let i = 0; i < 10; i++) {
      expect((await tryChangePassword(`guess-${i}`, "brand-new-password")).fieldErrors?.currentPassword).toEqual([
        NOT_CURRENT,
      ]);
    }
    expect(await tryChangePassword(user.password, "brand-new-password")).toEqual({ status: "error", message: TOO_MANY });

    // Still the old password.
    newVisitor();
    expect(await tryLogin(user.email, user.password)).toEqual({ redirect: "/dashboard" });

    // Other users aren't affected.
    const other = await createUser();
    newVisitor();
    await logInAs(other);
    expect((await tryChangePassword(other.password, "another-new-password")).status).toBe("success");
  }, 30_000);

  it("a successful change isn't counted against the limit", async () => {
    const user = await createUser();
    await logInAs(user);
    for (let i = 0; i < 9; i++) await tryChangePassword(`guess-${i}`, "brand-new-password");
    // Two successful changes in a row: the 10th and (had it been counted) 11th attempt.
    expect((await tryChangePassword(user.password, "second-password")).status).toBe("success");
    expect((await tryChangePassword("second-password", "third-password")).status).toBe("success");
    expect(await attemptsFor(`password:user:${user.id}`)).toBe(9);
    // One more wrong guess is the 10th counted attempt; the next is refused.
    expect((await tryChangePassword("guess-x", "fourth-password")).fieldErrors?.currentPassword).toEqual([NOT_CURRENT]);
    expect(await tryChangePassword("third-password", "fourth-password")).toEqual({ status: "error", message: TOO_MANY });
    expect(await hasPassword(user.id, "third-password")).toBe(true);
  }, 30_000);

  it("invalid input (e.g. mismatched confirmations) doesn't use up attempts", async () => {
    const user = await createUser();
    await logInAs(user);
    for (let i = 0; i < 15; i++) {
      expect((await tryChangePassword(user.password, "brand-new-password", `typo-${i}`)).fieldErrors).toEqual({
        confirmPassword: [MISMATCH],
      });
    }
    expect((await tryChangePassword(user.password, "brand-new-password")).status).toBe("success");
  }, 30_000);

  it("parallel guesses can't exceed the per-user limit", async () => {
    const user = await createUser();
    await logInAs(user);
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => tryChangePassword(`guess-${i}`, "brand-new-password")),
    );
    const checked = results.filter((r) => r.fieldErrors?.currentPassword?.[0] === NOT_CURRENT).length;
    const blocked = results.filter((r) => r.message === TOO_MANY).length;
    expect(checked + blocked).toBe(30);
    expect(checked).toBeLessThanOrEqual(10);
    expect(await attemptsFor(`password:user:${user.id}`)).toBe(checked);
  }, 30_000);
});

describe("signOutOtherDevices", () => {
  it("deletes the user's other sessions, keeps this one, and says so", async () => {
    const user = await createUser();
    const bystander = await createUser();
    await logInAs(bystander);
    newVisitor();
    await logInAs(user);
    newVisitor();
    await logInAs(user);
    expect(await sessionCount(user.id)).toBe(2);

    expect(await signOutOtherDevices()).toEqual({
      status: "success",
      message: "You've been signed out on all your other devices.",
    });
    expect(await sessionCount(user.id)).toBe(1);
    expect(browser.cookies.get(SESSION_COOKIE)).toBeTruthy();
    // Someone else's session is untouched.
    expect(await sessionCount(bystander.id)).toBe(1);
  });

  it("works as a useActionState action (called with the previous state and form data)", async () => {
    const user = await createUser();
    await logInAs(user);
    const action = signOutOtherDevices as unknown as (prev: FormState, data: FormData) => Promise<FormState>;
    expect(await action({ status: "success", message: "earlier" }, new FormData())).toMatchObject({
      status: "success",
    });
    expect(await sessionCount(user.id)).toBe(1);
  });

  it("asks signed-out visitors to log in again (no redirect)", async () => {
    expect(await outcome(signOutOtherDevices())).toEqual({ status: "error", message: LOG_IN_AGAIN });
  });
});

// ---------------------------------------------------------------------------
// Closing an account
// ---------------------------------------------------------------------------

async function closeAccount(confirm = "delete"): Promise<string | undefined> {
  try {
    await deleteAccount(form({ confirm }));
    return undefined;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.url;
    throw error;
  }
}

async function userRow(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row;
}

describe("deleteAccount", () => {
  it("does nothing without the confirmation field", async () => {
    const user = await createUser();
    await logInAs(user);
    expect(await closeAccount("yes")).toBeUndefined();
    expect((await userRow(user.id)).deletedAt).toBeNull();
    expect(await sessionCount(user.id)).toBe(1);
  });

  it("deletes an account nobody reviewed outright, along with the reviews it wrote", async () => {
    const renter = await createUser("renter");
    const landlord = await createUser("landlord");
    const propertyId = await insertProperty(landlord.id, renter.id);
    const written = await insertReview({ kind: "landlord", authorId: renter.id, subjectUserId: landlord.id });
    await insertReview({ kind: "property", authorId: renter.id, propertyId });
    await logInAs(renter);

    expect(await closeAccount()).toBe("/?account=deleted");
    expect(await userRow(renter.id)).toBeUndefined();
    expect(browser.cookies.get(SESSION_COOKIE)).toBeUndefined();
    const db = await getDb();
    expect(await db.select().from(reviews).where(eq(reviews.authorId, renter.id))).toEqual([]);
    expect(await db.select().from(reviews).where(eq(reviews.id, written))).toEqual([]);
    // The property the renter added stays listed.
    expect(await landlordOf(propertyId)).toBe(landlord.id);
  });

  it("keeps a reviewed account as a closed profile with its login wiped", async () => {
    const renter = await createUser("renter");
    const landlord = await createUser("landlord");
    const about = await insertReview({ kind: "renter", authorId: landlord.id, subjectUserId: renter.id });
    await insertReview({ kind: "landlord", authorId: renter.id, subjectUserId: landlord.id });
    const db = await getDb();
    await db.update(users).set({ bio: "Something personal" }).where(eq(users.id, renter.id));
    await logInAs(renter);
    newVisitor();
    await logInAs(renter); // a second device

    newVisitor();
    await logInAs(renter);
    expect(await closeAccount()).toBe("/?account=deleted");

    const row = await userRow(renter.id);
    expect(row.deletedAt).toBeInstanceOf(Date);
    expect(row.email).toBe(`deleted-${renter.id}@deleted.invalid`);
    expect(row.passwordHash).toBe("deleted");
    expect(row.bio).toBeNull();
    // Name and roles stay so the profile and the reviews about them still make sense.
    expect(row.name).toBe(renter.name);
    expect(row).toMatchObject({ isRenter: true, isLandlord: false });
    // Every session is gone, on all devices.
    expect(await sessionCount(renter.id)).toBe(0);
    // The review about them stays; the one they wrote is gone.
    expect(await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.subjectUserId, renter.id))).toEqual([
      { id: about },
    ]);
    expect(await db.select().from(reviews).where(eq(reviews.authorId, renter.id))).toEqual([]);

    // The old credentials no longer work, not even with the "deleted" placeholder.
    newVisitor();
    expect(await tryLogin(renter.email, renter.password)).toMatchObject({ message: NO_MATCH });
    expect(await tryLogin(`deleted-${renter.id}@deleted.invalid`, "deleted")).toMatchObject({ message: NO_MATCH });

    // The email address is free for a brand-new account.
    expect(
      await redirectOf(signup(idleFormState, signupForm({ email: renter.email, name: "Fresh Start" }))),
    ).toBe("/dashboard");
    const [fresh] = await db.select().from(users).where(eq(users.email, renter.email));
    expect(fresh.id).not.toBe(renter.id);
    expect(fresh.deletedAt).toBeNull();
  });

  it("a closed (reviewed) landlord's properties lose their landlord and can be claimed", async () => {
    const landlord = await createUser("landlord");
    const renter = await createUser("renter");
    const otherLandlord = await createUser("landlord");
    await insertReview({ kind: "landlord", authorId: renter.id, subjectUserId: landlord.id });
    const addedByThem = await insertProperty(landlord.id, landlord.id);
    const addedByRenter = await insertProperty(landlord.id, renter.id);
    const someoneElses = await insertProperty(otherLandlord.id, renter.id);
    const propertyReview = await insertReview({ kind: "property", authorId: renter.id, propertyId: addedByRenter });
    await logInAs(landlord);

    expect(await closeAccount()).toBe("/?account=deleted");
    // Kept as a closed profile (reviewed), not deleted outright...
    expect((await userRow(landlord.id)).deletedAt).toBeInstanceOf(Date);
    // ...but no longer listed as anyone's landlord.
    expect(await landlordOf(addedByThem)).toBeNull();
    expect(await landlordOf(addedByRenter)).toBeNull();
    expect(await landlordOf(someoneElses)).toBe(otherLandlord.id);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    // The listings and their reviews stay.
    const db = await getDb();
    expect(await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.propertyId, addedByRenter))).toEqual([
      { id: propertyReview },
    ]);

    // Whoever manages them now can claim them.
    const newManager = await createUser("landlord");
    newVisitor();
    await logInAs(newManager);
    expect(await claimProperty(idleFormState, form({ propertyId: addedByThem }))).toEqual({
      status: "success",
      message: CLAIMED,
    });
    expect(await claimProperty(idleFormState, form({ propertyId: addedByRenter }))).toEqual({
      status: "success",
      message: CLAIMED,
    });
    expect(await landlordOf(addedByThem)).toBe(newManager.id);
    expect(await landlordOf(addedByRenter)).toBe(newManager.id);
  });

  it("an unreviewed landlord is deleted outright; their properties stay, claimable", async () => {
    const landlord = await createUser("landlord");
    const propertyId = await insertProperty(landlord.id, landlord.id);
    await logInAs(landlord);
    expect(await closeAccount()).toBe("/?account=deleted");
    expect(await userRow(landlord.id)).toBeUndefined();
    expect(await landlordOf(propertyId)).toBeNull();

    const newManager = await createUser("landlord");
    newVisitor();
    await logInAs(newManager);
    expect(await claimProperty(idleFormState, form({ propertyId }))).toMatchObject({ status: "success" });
    expect(await landlordOf(propertyId)).toBe(newManager.id);
  });

  it("a closed account's old session cookie stops working", async () => {
    const renter = await createUser("renter");
    const landlord = await createUser("landlord");
    await insertReview({ kind: "renter", authorId: landlord.id, subjectUserId: renter.id });
    await logInAs(renter);
    const stolenCookie = browser.cookies.get(SESSION_COOKIE)!;

    newVisitor();
    await logInAs(renter);
    await closeAccount();

    // Replaying the first device's cookie: no user, so actions refuse.
    browser.cookies = new Map([[SESSION_COOKIE, stolenCookie]]);
    expect(await tryChangePassword(renter.password, "a-new-password")).toEqual({
      status: "error",
      message: LOG_IN_AGAIN,
    });
    expect(await signOutOtherDevices()).toEqual({ status: "error", message: LOG_IN_AGAIN });
  });

  it("a session row left behind for a closed account isn't accepted", async () => {
    // Defence in depth: even if a session survived, deletedAt users are never signed in.
    const renter = await createUser("renter");
    await logInAs(renter);
    const db = await getDb();
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, renter.id));
    expect(await sessionCount(renter.id)).toBe(1);
    expect(await tryChangePassword(renter.password, "a-new-password")).toMatchObject({ message: LOG_IN_AGAIN });
    newVisitor();
    expect(await tryLogin(renter.email, renter.password)).toMatchObject({ message: NO_MATCH });
  });

  it("signed-out visitors are sent to log in", async () => {
    expect(await closeAccount()).toBe("/login");
  });
});

// ---------------------------------------------------------------------------
// Claiming and unlinking properties
// ---------------------------------------------------------------------------

describe("claimProperty", () => {
  it("lets a landlord claim a property without a landlord, and says so", async () => {
    const landlord = await createUser("landlord");
    const renter = await createUser("renter");
    const propertyId = await insertProperty(null, renter.id);
    await logInAs(landlord);
    expect(await claimProperty(idleFormState, form({ propertyId }))).toEqual({ status: "success", message: CLAIMED });
    expect(await landlordOf(propertyId)).toBe(landlord.id);
    expect(revalidatePath).toHaveBeenCalledWith(`/properties/${propertyId}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/landlords/${landlord.id}`);
  });

  it("never takes over a property that already has a landlord", async () => {
    const owner = await createUser("landlord");
    const intruder = await createUser("landlord");
    const propertyId = await insertProperty(owner.id, owner.id);
    await logInAs(intruder);
    expect(await claimProperty(idleFormState, form({ propertyId }))).toEqual({
      status: "error",
      message: ALREADY_MANAGED,
    });
    expect(await landlordOf(propertyId)).toBe(owner.id);
  });

  it("only the first of two landlords claiming at once wins", async () => {
    const first = await createUser("landlord");
    const second = await createUser("landlord");
    const propertyId = await insertProperty(null, null);
    await logInAs(first);
    const firstCookies = new Map(browser.cookies);
    newVisitor();
    await logInAs(second);
    const secondCookies = new Map(browser.cookies);

    browser.cookies = firstCookies;
    const a = claimProperty(idleFormState, form({ propertyId }));
    browser.cookies = secondCookies;
    const b = claimProperty(idleFormState, form({ propertyId }));
    const results = await Promise.all([a, b]);
    expect(results.map((r) => r.message).sort()).toEqual([ALREADY_MANAGED, CLAIMED].sort());
    const winner = results[0].status === "success" ? first : second;
    expect(await landlordOf(propertyId)).toBe(winner.id);
  });

  it("renters and signed-out visitors can't claim", async () => {
    const renter = await createUser("renter");
    const propertyId = await insertProperty(null, renter.id);
    expect(await claimProperty(idleFormState, form({ propertyId }))).toEqual({
      status: "error",
      message: LOG_IN_AGAIN,
    });
    expect(await landlordOf(propertyId)).toBeNull();
    await logInAs(renter);
    expect(await claimProperty(idleFormState, form({ propertyId }))).toEqual({
      status: "error",
      message: "Only landlords can claim a property.",
    });
    expect(await landlordOf(propertyId)).toBeNull();
  });

  it("rejects a missing or malformed property id", async () => {
    const landlord = await createUser("landlord");
    await logInAs(landlord);
    const doesNotExist = { status: "error", message: "That property doesn't exist." };
    expect(await claimProperty(idleFormState, form({}))).toEqual(doesNotExist);
    expect(await claimProperty(idleFormState, form({ propertyId: "not-a-uuid" }))).toEqual(doesNotExist);
    // A well-formed id that matches nothing changes nothing.
    const unknown = await claimProperty(idleFormState, form({ propertyId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" }));
    expect(unknown.status).toBe("error");
  });
});

describe("unlinkProperty", () => {
  it("lets the linked landlord remove themselves; the listing and its reviews stay", async () => {
    const landlord = await createUser("landlord");
    const renter = await createUser("renter");
    const propertyId = await insertProperty(landlord.id, renter.id);
    const reviewId = await insertReview({ kind: "property", authorId: renter.id, propertyId });
    await logInAs(landlord);
    expect(await unlinkProperty(idleFormState, form({ propertyId }))).toEqual({ status: "success", message: UNLINKED });
    expect(await landlordOf(propertyId)).toBeNull();
    const db = await getDb();
    expect(await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.propertyId, propertyId))).toEqual([
      { id: reviewId },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith(`/properties/${propertyId}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/landlords/${landlord.id}`);
  });

  it("can't unlink someone else's property", async () => {
    const owner = await createUser("landlord");
    const other = await createUser("landlord");
    const renter = await createUser("renter");
    const propertyId = await insertProperty(owner.id, renter.id);
    await logInAs(other);
    expect(await unlinkProperty(idleFormState, form({ propertyId }))).toEqual({ status: "error", message: NOT_LISTED });
    expect(await landlordOf(propertyId)).toBe(owner.id);
    // Not even the renter who added it.
    newVisitor();
    await logInAs(renter);
    expect(await unlinkProperty(idleFormState, form({ propertyId }))).toEqual({ status: "error", message: NOT_LISTED });
    expect(await landlordOf(propertyId)).toBe(owner.id);
    // Nor a signed-out visitor.
    newVisitor();
    expect(await unlinkProperty(idleFormState, form({ propertyId }))).toEqual({ status: "error", message: LOG_IN_AGAIN });
    expect(await landlordOf(propertyId)).toBe(owner.id);
  });

  it("unlinking twice: the second time says you aren't listed", async () => {
    const landlord = await createUser("landlord");
    const propertyId = await insertProperty(landlord.id, landlord.id);
    await logInAs(landlord);
    expect((await unlinkProperty(idleFormState, form({ propertyId }))).message).toBe(UNLINKED);
    expect(await unlinkProperty(idleFormState, form({ propertyId }))).toEqual({ status: "error", message: NOT_LISTED });
  });

  it("rejects a missing or malformed property id", async () => {
    const landlord = await createUser("landlord");
    await logInAs(landlord);
    const doesNotExist = { status: "error", message: "That property doesn't exist." };
    expect(await unlinkProperty(idleFormState, form({}))).toEqual(doesNotExist);
    expect(await unlinkProperty(idleFormState, form({ propertyId: "not-a-uuid" }))).toEqual(doesNotExist);
  });

  it("after unlinking, another landlord can claim it", async () => {
    const wrong = await createUser("landlord");
    const right = await createUser("landlord");
    const propertyId = await insertProperty(wrong.id, null);
    await logInAs(wrong);
    await unlinkProperty(idleFormState, form({ propertyId }));
    newVisitor();
    await logInAs(right);
    expect(await claimProperty(idleFormState, form({ propertyId }))).toEqual({ status: "success", message: CLAIMED });
    expect(await landlordOf(propertyId)).toBe(right.id);
  });
});
