/**
 * Accounts: signing up with a kennitala (including taking over a profile that
 * someone's review created), logging in, the rate limits on both, passwords and
 * sessions, profile edits (the name lock), roles, and closing an account.
 *
 * Server Actions run against a real database with Next's request APIs faked
 * (support/harness.ts). The race tests need a real Postgres: run with
 * UNIT_DATABASE_URL (see the harness); the embedded database runs one
 * transaction at a time.
 */
import { describe, expect, it, vi } from "vitest";
vi.mock("next/headers", async () => (await import("./support/next-mocks")).nextHeadersMock);
vi.mock("next/navigation", async () => (await import("./support/next-mocks")).nextNavigationMock);
vi.mock("next/cache", async () => (await import("./support/next-mocks")).nextCacheMock);
import { eq, like } from "drizzle-orm";
import {
  changePassword,
  changeRole,
  deleteAccount,
  signOutOtherDevices,
  updateProfile,
} from "@/app/actions/account";
import { login, signup } from "@/app/actions/auth";
import { authAttempts, properties, reviews, sessions, users, type UserRole } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { idleFormState, type FormState } from "@/lib/form-state";
import { formatKennitala } from "@/lib/kennitala";
import { ensurePerson, grantRoleByKennitala, personNameKeys, propertyAddressKeys } from "@/lib/people";
import {
  asVisitor,
  atOnce,
  attemptsFor,
  createUser,
  currentVisitor,
  form,
  freshIp,
  freshKennitala,
  getDb,
  insertProperty,
  insertReview,
  logInAs,
  newVisitor,
  nextCacheMock,
  outcome,
  seedAttempts,
  unique,
  userRow,
  usingPostgres,
  type TestUser,
} from "./support/harness";

const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";
const NO_MATCH = "That email and password don't match an account.";
const NOT_CURRENT = "That isn't your current password.";
const MISMATCH = "The new passwords don't match.";
const LOG_IN_AGAIN = "Please log in again.";
const FIX = "Please fix the highlighted fields.";
const EMAIL_TAKEN = "An account with this email already exists. Try logging in instead.";
const KENNITALA_TAKEN = "This kennitala already has an account.";
const NOT_YOU = { href: "/report?target=account", label: "Not you? Report it" };
const COMPANY = "Company accounts aren't available yet.";
const UNDERAGE = "You must be 18 or older to sign up.";
const NAME_LOCKED = "Your name can't be changed after people have reviewed you. If it's wrong, report it.";
const PROFILE_SAVED = "Profile saved.";
const NEED_ONE_ROLE = "You need at least one role. Add the other one first.";
const MALFORMED = "Something went wrong. Please try again.";
const reviewedAs = (role: UserRole) => `People have reviewed you as a ${role}, so you can't remove that role.`;
const added = (role: UserRole) => `Done. You're now listed as a ${role} too.`;
const removed = (role: UserRole) => `Done. You're no longer listed as a ${role}.`;
const BACK = "Back to write your review";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** unique(), letters only, for names (which can't contain digits). */
function uniqueWord(): string {
  return unique().replace(/\d/g, (digit) => "abcdefghij"[Number(digit)]);
}

/** A name that passes the person-name rules. */
function letterName(prefix = "Nafn"): string {
  return `${prefix} ${uniqueWord()}`;
}

function tryLogin(email: string, password: string, next?: string) {
  return outcome(login(idleFormState, form({ email, password, next })));
}

/** Log in through the login form as the current visitor (which counts as a login attempt). */
async function logInWithPassword(user: TestUser): Promise<void> {
  expect(await tryLogin(user.email!, user.password!)).toEqual({ redirect: "/dashboard" });
  expect(currentVisitor().cookies.get(SESSION_COOKIE)).toBeTruthy();
}

/** Forget this visitor's session cookie (same network, same language). */
function dropSessionCookie(): void {
  currentVisitor().cookies.delete(SESSION_COOKIE);
}

function signupForm(overrides: Record<string, string | undefined> = {}): FormData {
  const id = unique();
  return form({
    kennitala: freshKennitala(),
    name: letterName("Signup"),
    email: `signup-${id}@example.com`,
    password: "long-enough-password",
    isRenter: "on",
    city: "",
    ...overrides,
  });
}

function trySignup(overrides: Record<string, string | undefined> = {}) {
  return outcome(signup(idleFormState, signupForm(overrides)));
}

async function sessionCount(userId: string): Promise<number> {
  const db = await getDb();
  return (await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId))).length;
}

async function attemptsStartingWith(prefix: string): Promise<number> {
  const db = await getDb();
  return (await db.select({ id: authAttempts.id }).from(authAttempts).where(like(authAttempts.key, `${prefix}%`)))
    .length;
}

const accountKey = (email: string) => `login:account:${email}`;
const accountAndIpKey = (email: string, ip: string) => `login:account-ip:${email}|${ip}`;
const ipKey = (ip: string) => `login:ip:${ip}`;

async function rowByKennitala(kennitala: string) {
  const db = await getDb();
  const [row] = await db.select().from(users).where(eq(users.kennitala, kennitala));
  return row ?? null;
}

async function flags(userId: string): Promise<{ isLandlord: boolean; isRenter: boolean }> {
  const row = await userRow(userId);
  return { isLandlord: row!.isLandlord, isRenter: row!.isRenter };
}

async function landlordOf(propertyId: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db
    .select({ landlordId: properties.landlordId })
    .from(properties)
    .where(eq(properties.id, propertyId));
  return row.landlordId;
}

async function reviewIdsAbout(userId: string): Promise<string[]> {
  const db = await getDb();
  return (await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.subjectUserId, userId)))
    .map((row) => row.id)
    .sort();
}

async function reviewsBy(authorId: string) {
  const db = await getDb();
  return db.select({ id: reviews.id }).from(reviews).where(eq(reviews.authorId, authorId));
}

/** Every review about `userId` in a role they don't have (should never exist). */
async function hiddenReviewsAbout(userId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ kind: reviews.kind, isLandlord: users.isLandlord, isRenter: users.isRenter })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.subjectUserId))
    .where(eq(reviews.subjectUserId, userId));
  return rows.filter((row) => (row.kind === "landlord" ? !row.isLandlord : !row.isRenter)).map((row) => row.kind);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * What the review actions do to the person reviewed, in one transaction: give
 * them the role (creating a profile without an account for a new kennitala),
 * which locks their row, then insert the review a moment later.
 */
async function reviewByKennitala(authorId: string, kennitala: string, kind: UserRole): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { id } = await ensurePerson(tx, { kennitala, name: "Nafn Úr Umsögn", isCompany: false, role: kind });
    await pause(15);
    const [row] = await tx
      .insert(reviews)
      .values({
        kind,
        authorId,
        subjectUserId: id,
        rating: 3,
        title: `Title ${unique()}`,
        body: "A review body that is long enough to be valid.",
      })
      .returning({ id: reviews.id });
    return row.id;
  });
}

/** What adding a property with a landlord's kennitala does: link (or create) them as its landlord. */
async function linkByKennitala(creatorId: string, kennitala: string): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const found = await grantRoleByKennitala(tx, kennitala, "landlord");
    const landlordId =
      found?.id ??
      (await ensurePerson(tx, { kennitala, name: "Leigusali Úr Skráningu", isCompany: false, role: "landlord" })).id;
    await pause(15);
    const [row] = await tx
      .insert(properties)
      .values({
        ...propertyAddressKeys(`Kapphlaupsgata ${unique()}`, null),
        postalCode: 101,
        landlordId,
        createdById: creatorId,
      })
      .returning({ id: properties.id });
    return row.id;
  });
}

function closeAccount(confirm = "delete") {
  return outcome(deleteAccount(form({ confirm })));
}

function changeRoleTo(role: UserRole, change: "add" | "remove", next?: string): Promise<FormState> {
  return changeRole(idleFormState, form({ role, change, next }));
}

function saveProfile(fields: { name: string; city?: string; bio?: string }): Promise<FormState> {
  return updateProfile(idleFormState, form({ city: "", bio: "", ...fields }));
}

function tryChangePassword(currentPassword: string, newPassword: string, confirmPassword = newPassword) {
  return changePassword(idleFormState, form({ currentPassword, newPassword, confirmPassword }));
}

async function hasPassword(userId: string, password: string): Promise<boolean> {
  const row = await userRow(userId);
  return row?.passwordHash ? verifyPassword(password, row.passwordHash) : false;
}

// ---------------------------------------------------------------------------
// Signing up
// ---------------------------------------------------------------------------

describe("signup", () => {
  it.each([
    ["a renter", { isRenter: "on" }, { isRenter: true, isLandlord: false }],
    ["a landlord", { isLandlord: "on" }, { isRenter: false, isLandlord: true }],
    ["both", { isRenter: "on", isLandlord: "on" }, { isRenter: true, isLandlord: true }],
  ])("signs up as %s with a kennitala, and the session knows the roles", async (_label, roles, expected) => {
    const kennitala = freshKennitala();
    const email = `roles-${unique()}@example.com`;
    const name = letterName("Ný");
    const result = await trySignup({ kennitala, email, name, isRenter: undefined, ...roles, city: "Akureyri" });
    expect(result).toEqual({ redirect: "/dashboard" });

    const row = await rowByKennitala(kennitala);
    expect(row).toMatchObject({
      ...expected,
      email,
      ...personNameKeys(name),
      city: "Akureyri",
      bio: null,
      isCompany: false,
      joinedAt: expect.any(Date),
    });
    expect(await verifyPassword("long-enough-password", row!.passwordHash!)).toBe(true);
    // The signed-in user (from the session cookie) carries the same flags, never the kennitala.
    const current = await getCurrentUser();
    expect(current).toMatchObject({ id: row!.id, ...expected });
    expect(JSON.stringify(current)).not.toContain(kennitala);
  });

  it("accepts the kennitala typed with a hyphen or spaces", async () => {
    const kennitala = freshKennitala();
    expect(await trySignup({ kennitala: ` ${formatKennitala(kennitala)} ` })).toEqual({ redirect: "/dashboard" });
    expect(await rowByKennitala(kennitala)).not.toBeNull();
  });

  it("goes back to ?next= (a path on this site only)", async () => {
    expect(await trySignup({ next: "/reviews/new?kind=landlord" })).toEqual({ redirect: "/reviews/new?kind=landlord" });
    newVisitor();
    expect(await trySignup({ next: "https://evil.example/" })).toEqual({ redirect: "/dashboard" });
  });

  it("refuses a sign-up with no role ticked, keeping what was typed", async () => {
    const kennitala = freshKennitala();
    const email = `norole-${unique()}@example.com`;
    const result = await trySignup({ kennitala, email, isRenter: undefined });
    expect(result).toMatchObject({
      status: "error",
      message: FIX,
      fieldErrors: { roles: ["Choose at least one: renter, landlord, or both."] },
      values: { email, kennitala },
    });
    expect((result as FormState).values).not.toHaveProperty("password");
    expect(await rowByKennitala(kennitala)).toBeNull();
  });

  it("validates the kennitala", async () => {
    expect(await trySignup({ kennitala: "" })).toMatchObject({ fieldErrors: { kennitala: ["Enter a kennitala."] } });
    for (const kennitala of ["123", "1234567890123", "321399-2959", "abcdefghij"]) {
      expect(await trySignup({ kennitala }), kennitala).toMatchObject({
        fieldErrors: { kennitala: ["That isn't a valid kennitala. Enter 10 digits, e.g. 123456-7890."] },
      });
    }
  });

  it("refuses a company's kennitala and a minor's, without using up the allowance", async () => {
    const ip = newVisitor().ip!;
    const company = freshKennitala("company");
    expect(await trySignup({ kennitala: company })).toMatchObject({
      status: "error",
      message: FIX,
      fieldErrors: { kennitala: [COMPANY] },
    });
    const minor = freshKennitala("minor");
    expect(await trySignup({ kennitala: minor })).toMatchObject({
      status: "error",
      message: FIX,
      fieldErrors: { kennitala: [UNDERAGE] },
    });
    expect(await rowByKennitala(company)).toBeNull();
    expect(await rowByKennitala(minor)).toBeNull();
    expect(await attemptsFor(`signup:ip:${ip}`)).toBe(0);
  });

  it("refuses a kennitala that already has an account, with a link to report it", async () => {
    const existing = await createUser({ roles: "renter", name: letterName() });
    const before = await userRow(existing.id);
    const email = `second-${unique()}@example.com`;
    const result = await trySignup({ kennitala: formatKennitala(existing.kennitala), email, isLandlord: "on" });
    expect(result).toEqual({
      status: "error",
      message: FIX,
      fieldErrors: { kennitala: [KENNITALA_TAKEN] },
      values: expect.objectContaining({ email }),
      link: NOT_YOU,
    });
    // Nothing about the account holder is revealed, and nothing changed.
    expect(JSON.stringify(result)).not.toContain(existing.name);
    expect(JSON.stringify(result)).not.toContain(existing.email!);
    expect(await userRow(existing.id)).toEqual(before);
    expect(currentVisitor().cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("refuses an email that already has an account (another kennitala)", async () => {
    const existing = await createUser({ roles: "renter" });
    const kennitala = freshKennitala();
    const result = await trySignup({ kennitala, email: existing.email!.toUpperCase() });
    expect(result).toMatchObject({ status: "error", message: FIX, fieldErrors: { email: [EMAIL_TAKEN] } });
    expect(await rowByKennitala(kennitala)).toBeNull();
  });

  it("an email taken while claiming a profile is refused, and the profile stays as it was", async () => {
    const existing = await createUser({ roles: "renter" });
    const profile = await createUser({ roles: "landlord", account: false });
    const result = await trySignup({ kennitala: profile.kennitala, email: existing.email! });
    expect(result).toMatchObject({ fieldErrors: { email: [EMAIL_TAKEN] } });
    expect(await userRow(profile.id)).toMatchObject({ email: null, passwordHash: null, isRenter: false });
  });

  it("never puts the kennitala in a rate-limit key", async () => {
    const kennitala = freshKennitala();
    await trySignup({ kennitala });
    const db = await getDb();
    expect(await db.select().from(authAttempts).where(like(authAttempts.key, `%${kennitala}%`))).toEqual([]);
  });
});

describe("signup takes over a profile without an account", () => {
  it("keeps the reviewed profile's id, reviews and name, and adds the roles ticked", async () => {
    const author = await createUser({ roles: "renter" });
    const profile = await createUser({ roles: "landlord", account: false, name: "Gunnar Már Pétursson" });
    const review = await insertReview({ kind: "landlord", authorId: author.id, subjectUserId: profile.id });
    const email = `claim-${unique()}@example.com`;

    const result = await trySignup({ kennitala: profile.kennitala, name: "Gunni Pé", email, city: "Kópavogur" });
    // The dashboard explains why the page kept the reviewers' name.
    expect(result).toEqual({ redirect: "/dashboard?name=kept" });

    const row = await userRow(profile.id);
    expect(row).toMatchObject({
      id: profile.id,
      ...personNameKeys("Gunnar Már Pétursson"),
      email,
      city: "Kópavogur",
      bio: null,
      joinedAt: expect.any(Date),
      // Reviewed as a landlord, and ticked "renter".
      isLandlord: true,
      isRenter: true,
    });
    expect(await reviewIdsAbout(profile.id)).toEqual([review]);
    expect(await getCurrentUser()).toMatchObject({ id: profile.id, name: "Gunnar Már Pétursson" });
  });

  it("keeps the name of a profile someone else linked to a property", async () => {
    const creator = await createUser({ roles: "renter" });
    const profile = await createUser({ roles: "landlord", account: false, name: "Gamalt Nafn" });
    await insertProperty({ landlordId: profile.id, createdById: creator.id });
    expect(await trySignup({ kennitala: profile.kennitala, name: "Nýtt Nafn", isLandlord: "on" })).toEqual({
      redirect: "/dashboard?name=kept",
    });
    expect(await userRow(profile.id)).toMatchObject({ name: "Gamalt Nafn", isLandlord: true, isRenter: true });
  });

  it("takes the typed name when nobody has described the person, and keeps ?next=", async () => {
    const profile = await createUser({ roles: "renter", account: false, name: "Gamalt Nafn" });
    expect(await trySignup({ kennitala: profile.kennitala, name: "Nýtt Nafn", next: "/landlords" })).toEqual({
      redirect: "/landlords",
    });
    expect(await userRow(profile.id)).toMatchObject({ ...personNameKeys("Nýtt Nafn"), isRenter: true });
  });

  it("only adds roles: a renter profile signing up as a renter stays renter-only", async () => {
    const author = await createUser({ roles: "landlord" });
    const profile = await createUser({ roles: "renter", account: false, name: letterName() });
    await insertReview({ kind: "renter", authorId: author.id, subjectUserId: profile.id });
    expect(await trySignup({ kennitala: profile.kennitala, name: profile.name })).toEqual({ redirect: "/dashboard" });
    expect(await flags(profile.id)).toEqual({ isLandlord: false, isRenter: true });
  });

  it("a second sign-up with the same kennitala is refused once the profile is taken", async () => {
    const profile = await createUser({ roles: "landlord", account: false });
    expect(await trySignup({ kennitala: profile.kennitala })).toMatchObject({ redirect: expect.any(String) });
    newVisitor();
    expect(await trySignup({ kennitala: profile.kennitala })).toMatchObject({
      fieldErrors: { kennitala: [KENNITALA_TAKEN] },
      link: NOT_YOU,
    });
  });

  it.skipIf(!usingPostgres)(
    "a review being written about the kennitala at the same moment keeps both role flags",
    async () => {
      for (let i = 0; i < 8; i++) {
        const author = await createUser({ roles: "renter" });
        const kennitala = freshKennitala();
        // Half the runs: someone already reviewed them as a renter (a profile exists).
        if (i % 4 < 2) {
          const landlord = await createUser({ roles: "landlord" });
          const profile = await createUser({ roles: "renter", account: false, kennitala });
          await insertReview({ kind: "renter", authorId: landlord.id, subjectUserId: profile.id });
        }
        const email = `race-${unique()}@example.com`;
        const visitor = newVisitor();
        const [signedUp, reviewId] = await atOnce(
          () => asVisitor(visitor, () => trySignup({ kennitala, email, isRenter: "on" })),
          () => reviewByKennitala(author.id, kennitala, "landlord"),
          i,
        );
        const detail = `run ${i}: signup → ${JSON.stringify(signedUp)}`;
        expect(signedUp, detail).toMatchObject({ redirect: expect.stringMatching(/^\/dashboard/) });
        const row = await rowByKennitala(kennitala);
        expect(row, detail).toMatchObject({ email, isLandlord: true, isRenter: true });
        const db = await getDb();
        const [review] = await db.select().from(reviews).where(eq(reviews.id, reviewId));
        expect(review.subjectUserId, detail).toBe(row!.id);
      }
    },
    60_000,
  );
});

describe("sign-up rate limiting", () => {
  it("allows 20 sign-ups per IP per hour, then refuses", async () => {
    const ip = newVisitor().ip!;
    await seedAttempts(`signup:ip:${ip}`, 19);
    // The 20th sign-up goes through.
    expect(await trySignup()).toEqual({ redirect: "/dashboard" });

    dropSessionCookie();
    const name = letterName("Blocked");
    const email = `blocked-${unique()}@example.com`;
    const kennitala = freshKennitala();
    const blocked = await trySignup({ name, email, kennitala });
    expect(blocked).toMatchObject({
      status: "error",
      message: TOO_MANY,
      values: { name, email, isRenter: "on" },
    });
    expect((blocked as FormState).values).not.toHaveProperty("password");
    expect(await rowByKennitala(kennitala)).toBeNull();
    // The refused sign-up isn't counted.
    expect(await attemptsFor(`signup:ip:${ip}`)).toBe(20);

    // Another IP can still sign up.
    newVisitor();
    expect(await trySignup()).toEqual({ redirect: "/dashboard" });
  });

  it("invalid sign-ups don't use up the allowance", async () => {
    const ip = newVisitor().ip!;
    await seedAttempts(`signup:ip:${ip}`, 19);
    for (let i = 0; i < 5; i++) {
      const result = await trySignup({ password: "short" });
      expect(result).toMatchObject({
        status: "error",
        fieldErrors: { password: ["Password must be at least 8 characters."] },
      });
    }
    expect(await trySignup()).toEqual({ redirect: "/dashboard" });
  });

  it("a duplicate email or kennitala still counts as an attempt (so they can't be probed for free)", async () => {
    const existing = await createUser({ roles: "renter" });
    const ip = newVisitor().ip!;
    await seedAttempts(`signup:ip:${ip}`, 18);
    expect(await trySignup({ email: existing.email! })).toMatchObject({ fieldErrors: { email: [EMAIL_TAKEN] } });
    expect(await trySignup({ kennitala: existing.kennitala })).toMatchObject({
      fieldErrors: { kennitala: [KENNITALA_TAKEN] },
    });
    expect(await trySignup()).toMatchObject({ message: TOO_MANY });
  });

  it("is switched off by AUTH_RATE_LIMIT=off", async () => {
    vi.stubEnv("AUTH_RATE_LIMIT", "off");
    const ip = newVisitor().ip!;
    await seedAttempts(`signup:ip:${ip}`, 25);
    expect(await trySignup()).toEqual({ redirect: "/dashboard" });
  });

  it("isn't limited per IP when the IP address is unknown", async () => {
    newVisitor(null);
    for (const key of ["signup:ip:unknown", "signup:ip:null", "signup:ip:"]) await seedAttempts(key, 25);
    const before = await attemptsStartingWith("signup:ip:");
    for (let i = 0; i < 3; i++) {
      dropSessionCookie();
      expect(await trySignup()).toEqual({ redirect: "/dashboard" });
    }
    expect(await attemptsStartingWith("signup:ip:")).toBe(before);
  });

  it("parallel sign-ups from one IP can't exceed the limit", async () => {
    const ip = newVisitor().ip!;
    await seedAttempts(`signup:ip:${ip}`, 15);
    const results = await Promise.all(Array.from({ length: 15 }, () => trySignup()));
    const created = results.filter((r) => "redirect" in r).length;
    const blocked = results.filter((r) => "message" in r && r.message === TOO_MANY).length;
    expect(created + blocked).toBe(15);
    // Only 5 of the 20 per hour were left.
    expect(created).toBeLessThanOrEqual(5);
    expect(await attemptsFor(`signup:ip:${ip}`)).toBe(15 + created);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Logging in
// ---------------------------------------------------------------------------

describe("login", () => {
  it("logs an account in and goes to ?next=, or the dashboard", async () => {
    const user = await createUser({ roles: "renter" });
    expect(await tryLogin(user.email!, user.password!, "/landlords?page=2")).toEqual({ redirect: "/landlords?page=2" });
    expect(await getCurrentUser()).toMatchObject({ id: user.id });
    newVisitor();
    expect(await tryLogin(user.email!, user.password!, "//evil.example")).toEqual({ redirect: "/dashboard" });
  });

  it("refuses a wrong password, keeping the email but never the password", async () => {
    const user = await createUser({ roles: "renter" });
    const result = await tryLogin(user.email!, "wrong-password");
    expect(result).toEqual({ status: "error", message: NO_MATCH, values: { email: user.email } });
    expect(currentVisitor().cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("validates the fields", async () => {
    expect(await tryLogin("not-an-email", "")).toMatchObject({
      status: "error",
      message: FIX,
      fieldErrors: { email: ["Enter a valid email address."], password: ["Enter your password."] },
    });
  });
});

describe("login rate limiting", () => {
  it("blocks an account on one network after 10 failed attempts, even with the right password", async () => {
    const user = await createUser({ roles: "renter" });
    for (let i = 0; i < 10; i++) {
      expect(await tryLogin(user.email!, "wrong-password")).toMatchObject({ status: "error", message: NO_MATCH });
    }
    const blocked = await tryLogin(user.email!, user.password!);
    expect(blocked).toMatchObject({ status: "error", message: TOO_MANY, values: { email: user.email } });
    // The password is never echoed back.
    expect(JSON.stringify(blocked)).not.toContain(user.password!);
    expect(currentVisitor().cookies.get(SESSION_COOKIE)).toBeUndefined();
  }, 30_000);

  it("a stranger's failed guesses from another network don't lock the owner out", async () => {
    const owner = await createUser({ roles: "renter" });
    const ownerIp = freshIp();

    // A stranger guesses from their own network until they're blocked.
    const strangerIp = newVisitor().ip;
    for (let i = 0; i < 10; i++) {
      expect(await tryLogin(owner.email!, "wrong-password")).toMatchObject({ message: NO_MATCH });
    }
    for (let i = 0; i < 5; i++) {
      expect(await tryLogin(owner.email!, "wrong-password")).toMatchObject({ message: TOO_MANY });
    }
    // Even with the right password, they stay blocked on that network.
    expect(await tryLogin(owner.email!, owner.password!)).toMatchObject({ message: TOO_MANY });

    // The owner, on their own network, logs in fine...
    newVisitor(ownerIp);
    await logInWithPassword(owner);

    // ...which doesn't unblock the stranger's network.
    newVisitor(strangerIp);
    expect(await tryLogin(owner.email!, owner.password!)).toMatchObject({ message: TOO_MANY });
  }, 30_000);

  it("strangers on several networks still can't lock the owner out", async () => {
    const owner = await createUser({ roles: "renter" });
    // 9 networks x 10 failures = 90, under the per-account backstop of 100.
    for (let n = 0; n < 9; n++) {
      newVisitor();
      for (let i = 0; i < 10; i++) {
        expect(await tryLogin(owner.email!, "wrong-password")).toMatchObject({ message: NO_MATCH });
      }
      expect(await tryLogin(owner.email!, "wrong-password")).toMatchObject({ message: TOO_MANY });
    }
    expect(await attemptsFor(accountKey(owner.email!))).toBe(90);
    newVisitor();
    await logInWithPassword(owner);
  }, 60_000);

  it("more than 100 failures across networks block the account everywhere", async () => {
    const user = await createUser({ roles: "renter" });
    // 10 networks x 10 failures, each network staying within its own limit.
    for (let n = 0; n < 10; n++) {
      newVisitor();
      for (let i = 0; i < 10; i++) {
        expect(await tryLogin(user.email!, "wrong-password")).toMatchObject({ message: NO_MATCH });
      }
    }
    // The 101st attempt is refused from any network, even with the right password.
    newVisitor();
    expect(await tryLogin(user.email!, user.password!)).toMatchObject({ message: TOO_MANY });
    expect(currentVisitor().cookies.get(SESSION_COOKIE)).toBeUndefined();
    newVisitor();
    expect(await tryLogin(user.email!, user.password!)).toMatchObject({ message: TOO_MANY });
    // Blocked attempts aren't counted, so the block doesn't grow.
    expect(await attemptsFor(accountKey(user.email!))).toBe(100);
  }, 60_000);

  it("99 recent failures for an account still allow a login (the 100th attempt)", async () => {
    const user = await createUser({ roles: "renter" });
    await seedAttempts(accountKey(user.email!), 99);
    await logInWithPassword(user);
    await seedAttempts(accountKey(user.email!), 1);
    newVisitor();
    expect(await tryLogin(user.email!, user.password!)).toMatchObject({ message: TOO_MANY });
  });

  it("treats different casing and spacing of the email as the same account", async () => {
    const user = await createUser({ roles: "renter" });
    const email = user.email!;
    const variants = [email.toUpperCase(), `  ${email}  `, email.replace("unit", "UNIT")];
    for (let i = 0; i < 10; i++) await tryLogin(variants[i % variants.length], "wrong-password");
    expect(await tryLogin(email, user.password!)).toMatchObject({ message: TOO_MANY });
  }, 30_000);

  it("doesn't block other accounts from the same network", async () => {
    const victim = await createUser({ roles: "renter" });
    const other = await createUser({ roles: "landlord" });
    for (let i = 0; i < 10; i++) await tryLogin(victim.email!, "wrong-password");
    expect(await tryLogin(victim.email!, victim.password!)).toMatchObject({ message: TOO_MANY });
    expect(await tryLogin(other.email!, other.password!)).toEqual({ redirect: "/dashboard" });
  }, 30_000);

  it("a successful login isn't counted and forgets this network's misses for the account", async () => {
    const user = await createUser({ roles: "renter" });
    const ip = newVisitor().ip!;
    for (let i = 0; i < 9; i++) await tryLogin(user.email!, "wrong-password");
    await logInWithPassword(user);

    expect(await attemptsFor(accountAndIpKey(user.email!, ip))).toBe(0);
    // The misses still count toward the per-account and per-network limits; the success doesn't.
    expect(await attemptsFor(accountKey(user.email!))).toBe(9);
    expect(await attemptsFor(ipKey(ip))).toBe(9);

    dropSessionCookie();
    for (let i = 0; i < 10; i++) {
      expect(await tryLogin(user.email!, "wrong-password")).toMatchObject({ message: NO_MATCH });
    }
    // 19 failures from this network in total, but only 10 since the last success.
    expect(await tryLogin(user.email!, user.password!)).toMatchObject({ message: TOO_MANY });
  }, 30_000);

  it("release() un-counts successful logins, so they never add up to a block", async () => {
    const user = await createUser({ roles: "renter" });
    const ip = newVisitor().ip!;
    // One short of the per-network limit (50).
    await seedAttempts(ipKey(ip), 49);
    // More successful logins than any limit allows attempts.
    for (let i = 0; i < 12; i++) {
      dropSessionCookie();
      expect(await tryLogin(user.email!, user.password!), `login ${i + 1}`).toEqual({ redirect: "/dashboard" });
    }
    expect(await attemptsFor(ipKey(ip))).toBe(49);
    expect(await attemptsFor(accountKey(user.email!))).toBe(0);
    expect(await attemptsFor(accountAndIpKey(user.email!, ip))).toBe(0);
  }, 30_000);

  it("failed attempts for unknown emails count too", async () => {
    const email = `nobody-${unique()}@example.com`;
    for (let i = 0; i < 10; i++) {
      expect(await tryLogin(email, "whatever-password")).toMatchObject({ message: NO_MATCH });
    }
    expect(await tryLogin(email, "whatever-password")).toMatchObject({ message: TOO_MANY });
  }, 30_000);

  it("blocks a network after 50 failed attempts across accounts", async () => {
    const ip = newVisitor().ip!;
    // 50 recent failures from this network (recorded directly, to keep the test fast).
    await seedAttempts(ipKey(ip), 50);
    const user = await createUser({ roles: "renter" });
    expect(await tryLogin(user.email!, user.password!)).toMatchObject({ message: TOO_MANY });
    // Not counted against the account.
    expect(await attemptsFor(accountKey(user.email!))).toBe(0);

    // Same account, different network: fine.
    newVisitor();
    expect(await tryLogin(user.email!, user.password!)).toEqual({ redirect: "/dashboard" });
  });

  it("49 failures from a network are still allowed", async () => {
    const ip = newVisitor().ip!;
    await seedAttempts(ipKey(ip), 49);
    const user = await createUser({ roles: "renter" });
    expect(await tryLogin(user.email!, user.password!)).toEqual({ redirect: "/dashboard" });
  });

  it("reads the IP from x-forwarded-for when x-real-ip is missing", async () => {
    const ip = freshIp();
    await seedAttempts(ipKey(ip), 50);
    const user = await createUser({ roles: "renter" });
    newVisitor(null).headers.set("x-forwarded-for", `${ip}, 10.0.0.1`);
    expect(await tryLogin(user.email!, user.password!)).toMatchObject({ message: TOO_MANY });
    newVisitor(null).headers.set("x-forwarded-for", `${freshIp()}, ${ip}`);
    expect(await tryLogin(user.email!, user.password!)).toEqual({ redirect: "/dashboard" });
  });

  it("without a known IP address, the per-network limit is skipped (no shared bucket)", async () => {
    newVisitor(null);
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
    const user = await createUser({ roles: "renter" });
    await logInWithPassword(user);
    // ...nor is anything recorded under a per-network key.
    expect(await attemptsStartingWith("login:ip:")).toBe(before);
  }, 60_000);

  it("without a known IP address, the per-account limits still apply", async () => {
    const user = await createUser({ roles: "renter" });
    newVisitor(null);
    for (let i = 0; i < 10; i++) {
      expect(await tryLogin(user.email!, "wrong-password")).toMatchObject({ message: NO_MATCH });
    }
    expect(await tryLogin(user.email!, user.password!)).toMatchObject({ message: TOO_MANY });
    expect(await attemptsFor(accountAndIpKey(user.email!, "unknown"))).toBe(10);
    // A visitor whose IP is known has their own per-network allowance.
    newVisitor();
    await logInWithPassword(user);
  }, 30_000);

  it("self-hosted without TRUST_PROXY_HEADERS, a faked IP header doesn't buy fresh attempts", async () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "");
    const user = await createUser({ roles: "renter" });
    // A new made-up X-Real-IP / X-Forwarded-For on every guess...
    for (let i = 0; i < 10; i++) {
      newVisitor().headers.set("x-forwarded-for", freshIp());
      expect(await tryLogin(user.email!, "wrong-password")).toMatchObject({ message: NO_MATCH });
    }
    // ...all counted as one unknown network, so the per-account limit kicks in.
    newVisitor();
    expect(await tryLogin(user.email!, user.password!)).toMatchObject({ message: TOO_MANY });
    expect(await attemptsFor(accountAndIpKey(user.email!, "unknown"))).toBe(10);
  }, 30_000);

  it("invalid form input doesn't count as an attempt", async () => {
    const user = await createUser({ roles: "renter" });
    for (let i = 0; i < 15; i++) {
      expect(await tryLogin(user.email!, "")).toMatchObject({
        status: "error",
        fieldErrors: { password: ["Enter your password."] },
      });
    }
    expect(await attemptsFor(accountKey(user.email!))).toBe(0);
    expect(await tryLogin(user.email!, user.password!)).toEqual({ redirect: "/dashboard" });
  }, 30_000);

  it("is switched off by AUTH_RATE_LIMIT=off", async () => {
    vi.stubEnv("AUTH_RATE_LIMIT", "off");
    const user = await createUser({ roles: "renter" });
    for (let i = 0; i < 12; i++) await tryLogin(user.email!, "wrong-password");
    expect(await tryLogin(user.email!, user.password!)).toEqual({ redirect: "/dashboard" });
    expect(await attemptsFor(accountKey(user.email!))).toBe(0);
  }, 30_000);

  it("parallel guesses from one network can't exceed the per-account-and-network limit", async () => {
    const user = await createUser({ roles: "renter" });
    const results = await Promise.all(
      Array.from({ length: 30 }, () => login(idleFormState, form({ email: user.email!, password: "wrong-password" }))),
    );
    const checked = results.filter((r) => r.message === NO_MATCH).length;
    const blocked = results.filter((r) => r.message === TOO_MANY).length;
    expect(checked + blocked).toBe(30);
    // At most 10 guesses may actually be checked against the password.
    expect(checked).toBeLessThanOrEqual(10);
    expect(await attemptsFor(accountKey(user.email!))).toBe(checked);
  }, 30_000);

  it("a parallel burst of exactly 10 guesses is all checked, and the next one is refused", async () => {
    const user = await createUser({ roles: "renter" });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => login(idleFormState, form({ email: user.email!, password: "wrong-password" }))),
    );
    expect(results.map((r) => r.message)).toEqual(Array.from({ length: 10 }, () => NO_MATCH));
    expect(await tryLogin(user.email!, user.password!)).toMatchObject({ message: TOO_MANY });
  }, 30_000);

  it("parallel guesses from many networks can't exceed the per-account limit", async () => {
    const user = await createUser({ roles: "renter" });
    const results = await Promise.all(
      Array.from({ length: 130 }, () =>
        asVisitor(newVisitor(), () => login(idleFormState, form({ email: user.email!, password: "wrong-password" }))),
      ),
    );
    const checked = results.filter((r) => r.message === NO_MATCH).length;
    const blocked = results.filter((r) => r.message === TOO_MANY).length;
    expect(checked + blocked).toBe(130);
    expect(checked).toBeLessThanOrEqual(100);
    expect(await attemptsFor(accountKey(user.email!))).toBe(checked);
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
// Password change and sessions
// ---------------------------------------------------------------------------

describe("changePassword", () => {
  it("requires a signed-in user", async () => {
    expect(await tryChangePassword("anything", "new-password-1")).toEqual({ status: "error", message: LOG_IN_AGAIN });
  });

  it("validates the fields", async () => {
    await logInAs(await createUser({ roles: "renter" }));
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
    const user = await createUser({ roles: "renter" });
    await logInAs(user);
    const result = await tryChangePassword(user.password!, "brand-new-password", "brand-new-passwrod");
    expect(result).toMatchObject({
      status: "error",
      message: FIX,
      fieldErrors: { confirmPassword: [MISMATCH] },
      values: {},
    });
    expect(Object.keys(result.fieldErrors ?? {})).toEqual(["confirmPassword"]);
    expect(JSON.stringify(result)).not.toContain("brand-new-pass");
    // Nothing changed, and the mistake didn't use up an attempt.
    expect(await hasPassword(user.id, user.password!)).toBe(true);
    expect(await attemptsFor(`password:user:${user.id}`)).toBe(0);
  });

  it("rejects a missing confirmation (a tampered form)", async () => {
    const user = await createUser({ roles: "renter" });
    await logInAs(user);
    const result = await changePassword(
      idleFormState,
      form({ currentPassword: user.password!, newPassword: "brand-new-password" }),
    );
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.confirmPassword).toBeDefined();
    expect(await hasPassword(user.id, user.password!)).toBe(true);
  });

  it("rejects a wrong current password and keeps the old one", async () => {
    const user = await createUser({ roles: "renter" });
    await logInAs(user);
    expect(await tryChangePassword("not-my-password", "brand-new-password")).toEqual({
      status: "error",
      message: FIX,
      fieldErrors: { currentPassword: [NOT_CURRENT] },
    });
    expect(await hasPassword(user.id, user.password!)).toBe(true);
  });

  it("changes the password and signs out every other session, keeping this one", async () => {
    const user = await createUser({ roles: "renter" });
    // Two other devices, and this one.
    await logInAs(user);
    await logInAs(user);
    await logInAs(user);
    const thisDevice = new Map(currentVisitor().cookies);
    expect(await sessionCount(user.id)).toBe(3);

    expect(await tryChangePassword(user.password!, "brand-new-password")).toEqual({
      status: "success",
      message: "Password changed. You've been signed out on your other devices.",
    });
    expect(await sessionCount(user.id)).toBe(1);
    expect(currentVisitor().cookies).toEqual(thisDevice);
    expect(await getCurrentUser()).toMatchObject({ id: user.id });

    newVisitor();
    expect(await tryLogin(user.email!, user.password!)).toMatchObject({ message: NO_MATCH });
    expect(await tryLogin(user.email!, "brand-new-password")).toEqual({ redirect: "/dashboard" });
  });

  it("is rate limited per user: 10 wrong guesses block even the right password", async () => {
    const user = await createUser({ roles: "renter" });
    await logInAs(user);
    for (let i = 0; i < 10; i++) {
      expect((await tryChangePassword(`guess-${i}-wrong`, "brand-new-password")).fieldErrors?.currentPassword).toEqual([
        NOT_CURRENT,
      ]);
    }
    expect(await tryChangePassword(user.password!, "brand-new-password")).toEqual({
      status: "error",
      message: TOO_MANY,
    });

    // Still the old password.
    newVisitor();
    expect(await tryLogin(user.email!, user.password!)).toEqual({ redirect: "/dashboard" });

    // Other users aren't affected.
    const other = await createUser({ roles: "renter" });
    await logInAs(other);
    expect((await tryChangePassword(other.password!, "another-new-password")).status).toBe("success");
  }, 30_000);

  it("a successful change isn't counted against the limit", async () => {
    const user = await createUser({ roles: "renter" });
    await logInAs(user);
    for (let i = 0; i < 9; i++) await tryChangePassword(`guess-${i}-wrong`, "brand-new-password");
    // Two successful changes in a row: the 10th and (had it been counted) 11th attempt.
    expect((await tryChangePassword(user.password!, "second-password")).status).toBe("success");
    expect((await tryChangePassword("second-password", "third-password")).status).toBe("success");
    expect(await attemptsFor(`password:user:${user.id}`)).toBe(9);
    // One more wrong guess is the 10th counted attempt; the next is refused.
    expect((await tryChangePassword("guess-x-wrong", "fourth-password")).fieldErrors?.currentPassword).toEqual([
      NOT_CURRENT,
    ]);
    expect(await tryChangePassword("third-password", "fourth-password")).toEqual({
      status: "error",
      message: TOO_MANY,
    });
    expect(await hasPassword(user.id, "third-password")).toBe(true);
  }, 30_000);

  it("invalid input (e.g. mismatched confirmations) doesn't use up attempts", async () => {
    const user = await createUser({ roles: "renter" });
    await logInAs(user);
    for (let i = 0; i < 15; i++) {
      expect((await tryChangePassword(user.password!, "brand-new-password", `typo-${i}-typo`)).fieldErrors).toEqual({
        confirmPassword: [MISMATCH],
      });
    }
    expect((await tryChangePassword(user.password!, "brand-new-password")).status).toBe("success");
  }, 30_000);

  it("parallel guesses can't exceed the per-user limit", async () => {
    const user = await createUser({ roles: "renter" });
    await logInAs(user);
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => tryChangePassword(`guess-${i}-wrong`, "brand-new-password")),
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
    const user = await createUser({ roles: "renter" });
    const bystander = await createUser({ roles: "landlord" });
    await logInAs(bystander);
    await logInAs(user);
    await logInAs(user);
    expect(await sessionCount(user.id)).toBe(2);

    expect(await signOutOtherDevices()).toEqual({
      status: "success",
      message: "You've been signed out on all your other devices.",
    });
    expect(await sessionCount(user.id)).toBe(1);
    expect(currentVisitor().cookies.get(SESSION_COOKIE)).toBeTruthy();
    // Someone else's session is untouched.
    expect(await sessionCount(bystander.id)).toBe(1);
  });

  it("works as a useActionState action (called with the previous state and form data)", async () => {
    const user = await createUser({ roles: "renter" });
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
// Profile
// ---------------------------------------------------------------------------

describe("updateProfile", () => {
  it("requires a signed-in user", async () => {
    expect(await saveProfile({ name: "Einhver Nafn" })).toEqual({ status: "error", message: LOG_IN_AGAIN });
  });

  it("saves the name (with its sort and search keys), city and bio", async () => {
    const user = await createUser({ roles: "renter", name: letterName() });
    await logInAs(user);
    const result = await saveProfile({ name: "  Þórdís   Jónsdóttir ", city: "Reykjavík", bio: "Róleg og snyrtileg." });
    expect(result).toEqual({
      status: "success",
      message: PROFILE_SAVED,
      values: { name: "Þórdís Jónsdóttir", city: "Reykjavík", bio: "Róleg og snyrtileg." },
    });
    expect(await userRow(user.id)).toMatchObject({
      ...personNameKeys("Þórdís Jónsdóttir"),
      city: "Reykjavík",
      bio: "Róleg og snyrtileg.",
    });
    expect(nextCacheMock.revalidatePath).toHaveBeenCalledWith("/", "layout");

    // Blank city and bio clear them.
    expect((await saveProfile({ name: "Þórdís Jónsdóttir" })).status).toBe("success");
    expect(await userRow(user.id)).toMatchObject({ city: null, bio: null });
  });

  it("validates the fields, keeping what was typed", async () => {
    const user = await createUser({ roles: "renter", name: letterName() });
    await logInAs(user);
    const result = await saveProfile({ name: "J", city: "Typed City", bio: "kt. 010130-2989 is mine" });
    expect(result).toMatchObject({
      status: "error",
      message: FIX,
      fieldErrors: {
        name: ["Name must be at least 2 characters."],
        bio: ["Don't include a kennitala here. ID numbers are never shown on GossipRent."],
      },
      values: { name: "J", city: "Typed City" },
    });
    expect(await saveProfile({ name: "R2 D2" })).toMatchObject({
      fieldErrors: { name: ["Use only letters, spaces, hyphens, apostrophes and periods in a name."] },
    });
    expect(await userRow(user.id)).toMatchObject({ name: user.name, city: null });
  });

  it("refuses a new name once someone has reviewed you, but saves the rest when the name is unchanged", async () => {
    const user = await createUser({ roles: "renter", name: letterName() });
    const landlord = await createUser({ roles: "landlord" });
    await insertReview({ kind: "renter", authorId: landlord.id, subjectUserId: user.id });
    await logInAs(user);

    expect(await saveProfile({ name: "Annað Nafn", city: "Selfoss" })).toEqual({
      status: "error",
      message: FIX,
      fieldErrors: { name: [NAME_LOCKED] },
      values: { name: "Annað Nafn", city: "Selfoss", bio: "" },
    });
    expect(await userRow(user.id)).toMatchObject({ name: user.name, city: null });

    // The same name (spaced differently) with a new city is fine.
    expect(await saveProfile({ name: ` ${user.name.replace(" ", "  ")} `, city: "Selfoss" })).toMatchObject({
      status: "success",
      message: PROFILE_SAVED,
    });
    expect(await userRow(user.id)).toMatchObject({ name: user.name, city: "Selfoss" });
  });

  it("refuses a new name for the landlord of a property someone else added, not one they added", async () => {
    const landlord = await createUser({ roles: "landlord", name: letterName() });
    await insertProperty({ landlordId: landlord.id, createdById: landlord.id });
    await logInAs(landlord);
    const ownName = letterName("Eigið");
    expect(await saveProfile({ name: ownName })).toMatchObject({ status: "success" });

    const renter = await createUser({ roles: "renter" });
    await insertProperty({ landlordId: landlord.id, createdById: renter.id });
    expect(await saveProfile({ name: letterName("Nýtt") })).toMatchObject({ fieldErrors: { name: [NAME_LOCKED] } });
    expect((await userRow(landlord.id))!.name).toBe(ownName);
  });

  it("a session left behind for a closed account can't edit the profile", async () => {
    const user = await createUser({ roles: "renter", name: letterName() });
    await logInAs(user);
    const db = await getDb();
    await db
      .update(users)
      .set({ email: null, passwordHash: null, joinedAt: null, city: null, bio: null })
      .where(eq(users.id, user.id));
    expect(await saveProfile({ name: user.name, city: "Vík" })).toEqual({ status: "error", message: LOG_IN_AGAIN });
    expect(await userRow(user.id)).toMatchObject({ city: null });
  });
});

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

describe("changeRole", () => {
  it("requires a signed-in user", async () => {
    expect(await changeRoleTo("landlord", "add")).toEqual({ status: "error", message: LOG_IN_AGAIN });
  });

  it.each([
    [{ role: "admin", change: "add" }],
    [{ role: "landlord", change: "toggle" }],
    [{ role: "renter" }],
    [{}],
  ])("rejects a malformed request %j", async (fields) => {
    const user = await createUser({ roles: "renter" });
    await logInAs(user);
    expect(await changeRole(idleFormState, form(fields as Record<string, string>))).toEqual({
      status: "error",
      message: MALFORMED,
    });
    expect(await flags(user.id)).toEqual({ isLandlord: false, isRenter: true });
  });

  it("a renter adds the landlord role, and the same session picks it up", async () => {
    const user = await createUser({ roles: "renter" });
    await logInAs(user);
    expect(await changeRoleTo("landlord", "add")).toEqual({ status: "success", message: added("landlord") });
    expect(await flags(user.id)).toEqual({ isLandlord: true, isRenter: true });
    expect(nextCacheMock.revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(await getCurrentUser()).toMatchObject({ isLandlord: true, isRenter: true });
  });

  it("a landlord adds the renter role", async () => {
    const user = await createUser({ roles: "landlord" });
    await logInAs(user);
    expect(await changeRoleTo("renter", "add")).toEqual({ status: "success", message: added("renter") });
    expect(await flags(user.id)).toEqual({ isLandlord: true, isRenter: true });
  });

  it("adding a role you already have changes nothing", async () => {
    const user = await createUser({ roles: "both" });
    await logInAs(user);
    expect((await changeRoleTo("renter", "add")).status).toBe("success");
    expect(await flags(user.id)).toEqual({ isLandlord: true, isRenter: true });
  });

  it.each([["renter" as const], ["landlord" as const]])("can't remove your only role (%s)", async (role) => {
    const user = await createUser({ roles: role });
    await logInAs(user);
    expect(await changeRoleTo(role, "remove")).toEqual({ status: "error", message: NEED_ONE_ROLE });
    expect(await flags(user.id)).toEqual({ isLandlord: role === "landlord", isRenter: role === "renter" });
  });

  it("removing the role you don't have leaves your account as it was", async () => {
    const user = await createUser({ roles: "renter" });
    await logInAs(user);
    await changeRoleTo("landlord", "remove");
    expect(await flags(user.id)).toEqual({ isLandlord: false, isRenter: true });
  });

  it("someone with both roles can remove one nobody reviewed them in", async () => {
    const user = await createUser({ roles: "both" });
    await logInAs(user);
    expect(await changeRoleTo("renter", "remove")).toEqual({ status: "success", message: removed("renter") });
    expect(await flags(user.id)).toEqual({ isLandlord: true, isRenter: false });
    expect(nextCacheMock.revalidatePath).toHaveBeenCalledWith("/", "layout");
    // ...and then can't remove the last one.
    expect(await changeRoleTo("landlord", "remove")).toEqual({ status: "error", message: NEED_ONE_ROLE });
    expect(await flags(user.id)).toEqual({ isLandlord: true, isRenter: false });
  });

  it("can't remove a role someone reviewed you in (so reviews can't be hidden)", async () => {
    const user = await createUser({ roles: "both" });
    const landlord = await createUser({ roles: "landlord" });
    const renter = await createUser({ roles: "renter" });
    await insertReview({ kind: "renter", authorId: landlord.id, subjectUserId: user.id });
    await logInAs(user);

    expect(await changeRoleTo("renter", "remove")).toEqual({ status: "error", message: reviewedAs("renter") });
    expect(await flags(user.id)).toEqual({ isLandlord: true, isRenter: true });

    // Once reviewed as a landlord too, neither can go.
    await insertReview({ kind: "landlord", authorId: renter.id, subjectUserId: user.id });
    expect(await changeRoleTo("landlord", "remove")).toEqual({ status: "error", message: reviewedAs("landlord") });
    expect(await changeRoleTo("renter", "remove")).toEqual({ status: "error", message: reviewedAs("renter") });
    expect(await flags(user.id)).toEqual({ isLandlord: true, isRenter: true });
  });

  it("reviews you wrote, or reviews of your properties, don't block removing a role", async () => {
    const user = await createUser({ roles: "both" });
    const renter = await createUser({ roles: "renter" });
    const landlord = await createUser({ roles: "landlord" });
    const managed = await insertProperty({ landlordId: user.id, createdById: user.id });
    await insertReview({ kind: "property", authorId: renter.id, propertyId: managed.id });
    await insertReview({ kind: "renter", authorId: user.id, subjectUserId: renter.id });
    await insertReview({ kind: "landlord", authorId: user.id, subjectUserId: landlord.id });
    await logInAs(user);
    expect((await changeRoleTo("landlord", "remove")).status).toBe("success");
    expect(await flags(user.id)).toEqual({ isLandlord: false, isRenter: true });
  });

  it("removing the landlord role unlinks only your properties; the listings and their reviews stay", async () => {
    const user = await createUser({ roles: "both" });
    const otherLandlord = await createUser({ roles: "landlord" });
    const renter = await createUser({ roles: "renter" });
    const listedByMe = await insertProperty({ landlordId: user.id, createdById: user.id });
    const linkedByRenter = await insertProperty({ landlordId: user.id, createdById: renter.id });
    const placeIRent = await insertProperty({ landlordId: otherLandlord.id, createdById: user.id });
    const unrelated = await insertProperty({ landlordId: otherLandlord.id, createdById: otherLandlord.id });
    const propertyReview = await insertReview({ kind: "property", authorId: renter.id, propertyId: linkedByRenter.id });
    await logInAs(user);

    expect((await changeRoleTo("landlord", "remove")).status).toBe("success");
    expect(await landlordOf(listedByMe.id)).toBeNull();
    expect(await landlordOf(linkedByRenter.id)).toBeNull();
    expect(await landlordOf(placeIRent.id)).toBe(otherLandlord.id);
    expect(await landlordOf(unrelated.id)).toBe(otherLandlord.id);
    const db = await getDb();
    expect(await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.propertyId, linkedByRenter.id))).toEqual([
      { id: propertyReview },
    ]);
  });

  it("removing the renter role keeps the properties you manage", async () => {
    const user = await createUser({ roles: "both" });
    const managed = await insertProperty({ landlordId: user.id, createdById: user.id });
    await logInAs(user);
    expect((await changeRoleTo("renter", "remove")).status).toBe("success");
    expect(await landlordOf(managed.id)).toBe(user.id);
  });

  it("a session left behind for a closed account can't change roles", async () => {
    const user = await createUser({ roles: "both" });
    await logInAs(user);
    const db = await getDb();
    await db
      .update(users)
      .set({ email: null, passwordHash: null, joinedAt: null, city: null, bio: null })
      .where(eq(users.id, user.id));
    expect(await changeRoleTo("renter", "remove")).toEqual({ status: "error", message: LOG_IN_AGAIN });
    expect(await flags(user.id)).toEqual({ isLandlord: true, isRenter: true });
  });

  describe("the way back after adding a role (next)", () => {
    it("offers a link back to the page that sent you, after adding a role", async () => {
      const user = await createUser({ roles: "renter" });
      const landlord = await createUser({ roles: "landlord" });
      await logInAs(user);
      expect(await changeRoleTo("landlord", "add", `/renters/${landlord.id}`)).toEqual({
        status: "success",
        message: added("landlord"),
        link: { href: `/renters/${landlord.id}`, label: BACK },
      });
    });

    it("keeps the query and normalizes the path it links to", async () => {
      const user = await createUser({ roles: "landlord" });
      await logInAs(user);
      const result = await changeRoleTo("renter", "add", "/properties/../landlords?page=2");
      expect(result.link).toEqual({ href: "/landlords?page=2", label: BACK });
    });

    it.each([
      ["another site", "https://evil.example/landlords"],
      ["a protocol-relative URL", "//evil.example/x"],
      ["a backslash trick", "/\\evil.example"],
      ["a dot-segment trick", "/.//evil.example"],
      ["a javascript: URL", "javascript:alert(1)"],
      ["a relative path", "landlords/1"],
      ["a blank value", ""],
    ])("never links to %s", async (_label, next) => {
      const user = await createUser({ roles: "renter" });
      await logInAs(user);
      const result = await changeRoleTo("landlord", "add", next);
      expect(result.status).toBe("success");
      expect(result.link).toBeUndefined();
      expect(await flags(user.id)).toEqual({ isLandlord: true, isRenter: true });
    });

    it("no link without next, or after removing a role", async () => {
      const user = await createUser({ roles: "renter" });
      await logInAs(user);
      expect((await changeRoleTo("landlord", "add")).link).toBeUndefined();
      expect(await changeRoleTo("landlord", "remove", "/renters")).toEqual({
        status: "success",
        message: removed("landlord"),
      });
    });

    it("an error doesn't offer the link either", async () => {
      const user = await createUser({ roles: "renter" });
      await logInAs(user);
      expect(await changeRoleTo("renter", "remove", "/landlords")).toEqual({ status: "error", message: NEED_ONE_ROLE });
    });
  });

  // changeRole locks the account's row while it checks for reviews; a review's
  // role grant locks the same row. Whichever goes first, no review is left about
  // a role its subject doesn't have.
  it.skipIf(!usingPostgres).each([["renter" as const], ["landlord" as const]])(
    "a %s review that arrives while that role is being removed is never left hidden",
    async (role) => {
      for (let i = 0; i < 10; i++) {
        const user = await createUser({ roles: "both" });
        const author = await createUser({ roles: role === "renter" ? "landlord" : "renter" });
        const visitor = await logInAs(user);
        const [removal, reviewId] = await atOnce(
          () => asVisitor(visitor, () => changeRoleTo(role, "remove")),
          () => reviewByKennitala(author.id, user.kennitala, role),
          i,
        );
        const detail = `run ${i}: remove → ${removal.message}`;
        expect(await reviewIdsAbout(user.id), detail).toEqual([reviewId]);
        expect(await hiddenReviewsAbout(user.id), detail).toEqual([]);
        if (removal.status === "error") expect(removal.message, detail).toBe(reviewedAs(role));
      }
    },
    60_000,
  );
});

// ---------------------------------------------------------------------------
// Closing an account
// ---------------------------------------------------------------------------

describe("deleteAccount", () => {
  it("does nothing without the confirmation field", async () => {
    const user = await createUser({ roles: "renter" });
    await logInAs(user);
    expect(await closeAccount("yes")).toBeUndefined();
    expect((await userRow(user.id))!.passwordHash).not.toBeNull();
    expect(await sessionCount(user.id)).toBe(1);
  });

  it("signed-out visitors are sent to log in", async () => {
    expect(await closeAccount()).toEqual({ redirect: "/login" });
  });

  it("deletes an account nobody refers to, along with the reviews it wrote", async () => {
    const renter = await createUser({ roles: "renter" });
    const landlord = await createUser({ roles: "landlord" });
    const property = await insertProperty({ landlordId: landlord.id, createdById: renter.id });
    const written = await insertReview({ kind: "landlord", authorId: renter.id, subjectUserId: landlord.id });
    await insertReview({ kind: "property", authorId: renter.id, propertyId: property.id });
    await logInAs(renter);

    expect(await closeAccount()).toEqual({ redirect: "/?account=deleted" });
    expect(await userRow(renter.id)).toBeNull();
    expect(currentVisitor().cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(await reviewsBy(renter.id)).toEqual([]);
    expect(await reviewIdsAbout(landlord.id)).not.toContain(written);
    expect(nextCacheMock.revalidatePath).toHaveBeenCalledWith("/", "layout");
    // The property the renter added stays listed, with its landlord.
    expect(await landlordOf(property.id)).toBe(landlord.id);
    // The landlord's account is untouched (accounts are never reconciled away).
    expect(await userRow(landlord.id)).toMatchObject({ isLandlord: true, passwordHash: expect.any(String) });
  });

  it("keeps a reviewed account as a profile without an account, its login wiped", async () => {
    const renter = await createUser({ roles: "renter", city: "Hafnarfjörður" });
    const landlord = await createUser({ roles: "landlord" });
    const about = await insertReview({ kind: "renter", authorId: landlord.id, subjectUserId: renter.id });
    await insertReview({ kind: "landlord", authorId: renter.id, subjectUserId: landlord.id });
    const db = await getDb();
    await db.update(users).set({ bio: "Something personal" }).where(eq(users.id, renter.id));
    await logInAs(renter); // another device
    await logInAs(renter);
    expect(await closeAccount()).toEqual({ redirect: "/?account=deleted" });

    expect(await userRow(renter.id)).toMatchObject({
      email: null,
      passwordHash: null,
      joinedAt: null,
      city: null,
      bio: null,
      // Name, kennitala and roles stay so the reviews about them still make sense.
      name: renter.name,
      kennitala: renter.kennitala,
      isRenter: true,
      isLandlord: false,
    });
    // Every session is gone, on all devices.
    expect(await sessionCount(renter.id)).toBe(0);
    // The review about them stays; the one they wrote is gone.
    expect(await reviewIdsAbout(renter.id)).toEqual([about]);
    expect(await reviewsBy(renter.id)).toEqual([]);

    // The old credentials no longer work.
    newVisitor();
    expect(await tryLogin(renter.email!, renter.password!)).toMatchObject({ message: NO_MATCH });
    // The email address is free for someone else's new account.
    expect(await trySignup({ email: renter.email! })).toEqual({ redirect: "/dashboard" });
    expect((await getCurrentUser())!.id).not.toBe(renter.id);
  });

  it("an account whose only reference is a property link stays as that property's landlord", async () => {
    const landlord = await createUser({ roles: "both" });
    const property = await insertProperty({ landlordId: landlord.id, createdById: landlord.id });
    await logInAs(landlord);
    expect(await closeAccount()).toEqual({ redirect: "/?account=deleted" });
    expect(await userRow(landlord.id)).toMatchObject({ passwordHash: null, isLandlord: true, isRenter: false });
    expect(await landlordOf(property.id)).toBe(landlord.id);
  });

  it("a reviewed landlord keeps every property link, whoever added the property", async () => {
    const landlord = await createUser({ roles: "landlord" });
    const renter = await createUser({ roles: "renter" });
    const otherLandlord = await createUser({ roles: "landlord" });
    await insertReview({ kind: "landlord", authorId: renter.id, subjectUserId: landlord.id });
    const addedByThem = await insertProperty({ landlordId: landlord.id, createdById: landlord.id });
    const addedByRenter = await insertProperty({ landlordId: landlord.id, createdById: renter.id });
    const someoneElses = await insertProperty({ landlordId: otherLandlord.id, createdById: renter.id });
    const propertyReview = await insertReview({ kind: "property", authorId: renter.id, propertyId: addedByRenter.id });
    await logInAs(landlord);

    expect(await closeAccount()).toEqual({ redirect: "/?account=deleted" });
    expect(await userRow(landlord.id)).toMatchObject({ passwordHash: null, isLandlord: true });
    expect(await landlordOf(addedByThem.id)).toBe(landlord.id);
    expect(await landlordOf(addedByRenter.id)).toBe(landlord.id);
    expect(await landlordOf(someoneElses.id)).toBe(otherLandlord.id);
    const db = await getDb();
    expect(await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.propertyId, addedByRenter.id))).toEqual([
      { id: propertyReview },
    ]);
  });

  it.each([
    ["reviewed only as a renter", ["renter"] as UserRole[], false, { isLandlord: false, isRenter: true }],
    ["reviewed only as a landlord", ["landlord"] as UserRole[], false, { isLandlord: true, isRenter: false }],
    ["reviewed in both roles", ["landlord", "renter"] as UserRole[], false, { isLandlord: true, isRenter: true }],
    ["reviewed as a renter and linked to a property", ["renter"] as UserRole[], true, { isLandlord: true, isRenter: true }],
  ])("%s: the profile keeps the roles that still show", async (_label, reviewedIn, linked, expected) => {
    const user = await createUser({ roles: "both" });
    for (const role of reviewedIn) {
      const author = await createUser({ roles: role === "renter" ? "landlord" : "renter" });
      await insertReview({ kind: role, authorId: author.id, subjectUserId: user.id });
    }
    if (linked) await insertProperty({ landlordId: user.id, createdById: user.id });
    await logInAs(user);
    expect(await closeAccount()).toEqual({ redirect: "/?account=deleted" });
    expect(await userRow(user.id)).toMatchObject({ ...expected, passwordHash: null });
    expect(await hiddenReviewsAbout(user.id)).toEqual([]);
  });

  it("only reviews they wrote, or reviews of a property they no longer manage: deleted outright", async () => {
    const user = await createUser({ roles: "both" });
    const renter = await createUser({ roles: "renter" });
    const landlord = await createUser({ roles: "landlord" });
    const theirs = await insertProperty({ landlordId: null, createdById: user.id });
    const propertyReview = await insertReview({ kind: "property", authorId: renter.id, propertyId: theirs.id });
    await insertReview({ kind: "renter", authorId: user.id, subjectUserId: renter.id });
    await insertReview({ kind: "landlord", authorId: user.id, subjectUserId: landlord.id });
    await logInAs(user);
    expect(await closeAccount()).toEqual({ redirect: "/?account=deleted" });
    expect(await userRow(user.id)).toBeNull();
    expect(await reviewsBy(user.id)).toEqual([]);
    const db = await getDb();
    const [property] = await db.select().from(properties).where(eq(properties.id, theirs.id));
    expect(property).toMatchObject({ createdById: null, landlordId: null });
    expect(await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.id, propertyReview))).toEqual([
      { id: propertyReview },
    ]);
  });

  it("profiles without an account that only their reviews kept are tidied up", async () => {
    const user = await createUser({ roles: "both" });
    const otherAuthor = await createUser({ roles: "landlord" });
    // Only this user reviewed them: deleted with the review.
    const onlyMine = await createUser({ roles: "landlord", account: false });
    await insertReview({ kind: "landlord", authorId: user.id, subjectUserId: onlyMine.id });
    // Someone else reviewed them too: kept.
    const shared = await createUser({ roles: "renter", account: false });
    await insertReview({ kind: "renter", authorId: user.id, subjectUserId: shared.id });
    await insertReview({ kind: "renter", authorId: otherAuthor.id, subjectUserId: shared.id });
    // Reviewed as a renter by this user, and a property's landlord: keeps only the landlord role.
    const linked = await createUser({ roles: "both", account: false });
    await insertReview({ kind: "renter", authorId: user.id, subjectUserId: linked.id });
    await insertProperty({ landlordId: linked.id, createdById: otherAuthor.id });
    await logInAs(user);

    expect(await closeAccount()).toEqual({ redirect: "/?account=deleted" });
    expect(await userRow(onlyMine.id)).toBeNull();
    expect(await flags(shared.id)).toEqual({ isLandlord: false, isRenter: true });
    expect(await flags(linked.id)).toEqual({ isLandlord: true, isRenter: false });
  });

  it("a closed account's old session cookie stops working", async () => {
    const renter = await createUser({ roles: "renter" });
    const landlord = await createUser({ roles: "landlord" });
    await insertReview({ kind: "renter", authorId: landlord.id, subjectUserId: renter.id });
    const firstDevice = await logInAs(renter);
    const stolenCookie = firstDevice.cookies.get(SESSION_COOKIE)!;

    await logInAs(renter);
    await closeAccount();

    // Replaying the first device's cookie: no user, so actions refuse.
    newVisitor().cookies.set(SESSION_COOKIE, stolenCookie);
    expect(await getCurrentUser()).toBeNull();
    expect(await tryChangePassword(renter.password!, "a-new-password")).toEqual({
      status: "error",
      message: LOG_IN_AGAIN,
    });
    expect(await signOutOtherDevices()).toEqual({ status: "error", message: LOG_IN_AGAIN });
  });

  it("a session row left behind for a closed account isn't accepted", async () => {
    // Defence in depth: even if a session survived, a profile without an account is never signed in.
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    const db = await getDb();
    await db
      .update(users)
      .set({ email: null, passwordHash: null, joinedAt: null, city: null, bio: null })
      .where(eq(users.id, renter.id));
    expect(await sessionCount(renter.id)).toBe(1);
    expect(await tryChangePassword(renter.password!, "a-new-password")).toMatchObject({ message: LOG_IN_AGAIN });
    expect(await closeAccount()).toEqual({ redirect: "/login" });
    // Nothing was done to the profile.
    expect(await userRow(renter.id)).toMatchObject({ isRenter: true });
    newVisitor();
    expect(await tryLogin(renter.email!, renter.password!)).toMatchObject({ message: NO_MATCH });
  });

  it("signing up again with the same kennitala takes the closed profile back, reviews intact", async () => {
    const user = await createUser({ roles: "renter", name: "Ásdís Halldórsdóttir" });
    const landlord = await createUser({ roles: "landlord" });
    const about = await insertReview({ kind: "renter", authorId: landlord.id, subjectUserId: user.id });
    await logInAs(user);
    await closeAccount();

    newVisitor();
    const email = `back-${unique()}@example.com`;
    expect(
      await trySignup({ kennitala: user.kennitala, name: "Ásdís H", email, isRenter: undefined, isLandlord: "on" }),
    ).toEqual({ redirect: "/dashboard?name=kept" });
    expect(await userRow(user.id)).toMatchObject({
      name: "Ásdís Halldórsdóttir",
      email,
      isRenter: true,
      isLandlord: true,
      joinedAt: expect.any(Date),
    });
    expect(await reviewIdsAbout(user.id)).toEqual([about]);
    expect(await getCurrentUser()).toMatchObject({ id: user.id });
  });

  it("after an account nobody referred to was deleted, the kennitala signs up as a new person", async () => {
    const user = await createUser({ roles: "renter" });
    await logInAs(user);
    await closeAccount();
    expect(await userRow(user.id)).toBeNull();
    newVisitor();
    expect(await trySignup({ kennitala: user.kennitala })).toEqual({ redirect: "/dashboard" });
    const row = await rowByKennitala(user.kennitala);
    expect(row!.id).not.toBe(user.id);
  });

  it.skipIf(!usingPostgres)(
    "a review about them that arrives while they close the account is never left hidden",
    async () => {
      for (let i = 0; i < 8; i++) {
        const user = await createUser({ roles: "both" });
        const landlord = await createUser({ roles: "landlord" });
        const renter = await createUser({ roles: "renter" });
        // Reviewed as a renter already, so the profile is kept either way.
        await insertReview({ kind: "renter", authorId: landlord.id, subjectUserId: user.id });
        const visitor = await logInAs(user);
        const [reviewId, closed] = await atOnce(
          () => reviewByKennitala(renter.id, user.kennitala, "landlord"),
          () => asVisitor(visitor, () => closeAccount()),
          i,
        );
        const detail = `run ${i}`;
        expect(closed, detail).toEqual({ redirect: "/?account=deleted" });
        expect(await hiddenReviewsAbout(user.id), detail).toEqual([]);
        expect(await reviewIdsAbout(user.id), detail).toContain(reviewId);
        expect(await userRow(user.id), detail).toMatchObject({ passwordHash: null, isLandlord: true, isRenter: true });
      }
    },
    60_000,
  );

  it.skipIf(!usingPostgres)(
    "a renter linking them as a landlord while they close the account always leaves a landlord profile",
    async () => {
      for (let i = 0; i < 12; i++) {
        // Nothing refers to them yet, so closing deletes the row unless the link lands first.
        const user = await createUser({ roles: "landlord" });
        const renter = await createUser({ roles: "renter" });
        const visitor = await logInAs(user);
        const [closed, propertyId] = await atOnce(
          () => asVisitor(visitor, () => closeAccount()),
          () => linkByKennitala(renter.id, user.kennitala),
          i,
        );
        const detail = `run ${i}`;
        expect(closed, detail).toEqual({ redirect: "/?account=deleted" });
        const landlordId = await landlordOf(propertyId);
        const landlord = await userRow(landlordId!);
        // Either the closed account's own row (the link came first) or a new profile for the same kennitala.
        expect(landlord, detail).toMatchObject({ kennitala: user.kennitala, isLandlord: true, passwordHash: null });
      }
    },
    60_000,
  );
});

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

describe("language", () => {
  it("answers in Icelandic when the visitor has no lang cookie", async () => {
    const user = await createUser({ roles: "renter" });
    currentVisitor().cookies.delete("lang");
    expect(await tryLogin(user.email!, "wrong-password")).toMatchObject({
      message: "Netfangið og lykilorðið passa ekki við neinn aðgang.",
    });
    expect(await trySignup({ kennitala: user.kennitala })).toMatchObject({
      message: "Lagaðu merktu reitina.",
      fieldErrors: { kennitala: ["Aðgangur er þegar til fyrir þessa kennitölu."] },
      link: { href: "/report?target=account", label: "Ekki þú? Tilkynna það" },
    });
    expect(await trySignup({ password: "short", kennitala: freshKennitala("company") })).toMatchObject({
      fieldErrors: { password: ["Lykilorð þarf að vera minnst 8 stafir."] },
    });
    expect(await trySignup({ kennitala: freshKennitala("minor") })).toMatchObject({
      fieldErrors: { kennitala: ["Þú þarft að hafa náð 18 ára aldri til að stofna aðgang."] },
    });
  });

  it("answers in Icelandic with lang=is, and in English with lang=en", async () => {
    const user = await createUser({ roles: "renter" });
    const visitor = await logInAs(user);
    visitor.cookies.set("lang", "is");
    expect(await changeRoleTo("renter", "remove")).toEqual({
      status: "error",
      message: "Þú þarft að hafa minnst eitt hlutverk. Bættu hinu við fyrst.",
    });
    expect(await changeRoleTo("landlord", "add")).toMatchObject({
      message: "Komið. Nú ert þú líka leigusali á GossipRent.",
    });
    visitor.cookies.set("lang", "en");
    expect(await signOutOtherDevices()).toMatchObject({ message: "You've been signed out on all your other devices." });
  });
});
