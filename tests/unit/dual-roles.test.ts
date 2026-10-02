/**
 * Accounts that are a renter, a landlord, or both: sign-up, adding and removing
 * a role, who may review whom, one review per author per person *per role*,
 * separate ratings for each role, and adding properties as "me".
 *
 * Like server-actions.test.ts, the Server Actions run against a throwaway
 * embedded database with Next's request APIs replaced by small fakes.
 *
 * The embedded database runs one query at a time, so the "at the same moment"
 * tests only really race on a real Postgres. Run this file on its own against
 * a freshly migrated one to exercise the locks:
 *
 *   createdb gossiprent_unit
 *   DATABASE_URL=postgres://…/gossiprent_unit npm run db:migrate
 *   UNIT_DATABASE_URL=postgres://…/gossiprent_unit npx vitest run tests/unit/dual-roles.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const testDb = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gossiprent-unit-roles-"));
  process.env.PGLITE_DATA_DIR = path.join(root, "pglite");
  process.env.SEED_DEMO_DATA = "false";
  process.env.DATABASE_URL = process.env.UNIT_DATABASE_URL ?? "";
  process.env.POSTGRES_URL = "";
  process.env.VERCEL = "";
  // Sign-ups here all come from fresh fake IPs, but don't let a slow machine
  // turn a rate limit into a confusing failure.
  process.env.AUTH_RATE_LIMIT = "off";
  return { root };
});

/** One fake "browser": its request headers and cookie jar. */
const browser = vi.hoisted(() => ({
  headers: new Headers(),
  cookies: new Map<string, string>(),
}));

/**
 * Lets two simulated requests run at the same time, each with its own
 * browser (see atOnce). Outside of it, `browser` is used.
 */
const requestScope = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  return new AsyncLocalStorage<{ headers: Headers; cookies: Map<string, string> }>();
});

vi.mock("next/headers", () => ({
  headers: async () => (requestScope.getStore() ?? browser).headers,
  cookies: async () => {
    const jar = (requestScope.getStore() ?? browser).cookies;
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
  notFound: () => {
    throw new Error("notFound()");
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import fs from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { changeRole, deleteAccount } from "@/app/actions/account";
import { login, signup } from "@/app/actions/auth";
import { claimProperty, createProperty, unlinkProperty } from "@/app/actions/properties";
import { deleteReview, saveReview } from "@/app/actions/reviews";
import { getDb, pgErrorCode } from "@/db";
import { closeDatabase } from "@/db/connect";
import { properties, reviews, users, type ReviewKind, type UserRole } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hashPassword } from "@/lib/auth/password";
import {
  getPublicUser,
  getRatingSummary,
  getReviewByAuthor,
  getSiteStats,
  listLandlordOptions,
  listPeople,
  listReviewsAbout,
  listReviewsByAuthor,
} from "@/lib/data";
import { idleFormState, type FormState } from "@/lib/validation";

let counter = 0;
function unique(): string {
  counter += 1;
  return `${counter}${Math.random().toString(36).slice(2, 8)}`;
}

const ipRun = Math.floor(Math.random() * 0xffff).toString(16);
let ipCounter = 0;

/** Act as a new visitor from a fresh IP address (empty cookie jar). */
function newVisitor(): void {
  ipCounter += 1;
  browser.headers = new Headers({ "x-real-ip": `2001:db8:${ipRun}::${ipCounter.toString(16)}` });
  browser.cookies = new Map();
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

type Roles = "landlord" | "renter" | "both";
type CreatedUser = { id: string; email: string; password: string; name: string };

/** Insert a user directly (fast; skips the signup action). */
async function createUser(roles: Roles): Promise<CreatedUser> {
  const db = await getDb();
  const id = unique();
  const email = `roles-${id}@example.com`;
  const password = `pw-${id}-secret`;
  const name = `Roles ${roles} ${id}`;
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

/** The action's result, or where it redirected to. */
async function outcome(promise: Promise<FormState>): Promise<FormState | { redirect: string }> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof RedirectSignal) return { redirect: error.url };
    throw error;
  }
}

/** Log `user` in on a fresh fake browser. */
async function logInAs(user: CreatedUser): Promise<void> {
  newVisitor();
  expect(await outcome(login(idleFormState, form({ email: user.email, password: user.password })))).toEqual({
    redirect: "/dashboard",
  });
}

async function flags(userId: string): Promise<{ isLandlord: boolean; isRenter: boolean }> {
  const db = await getDb();
  const [row] = await db
    .select({ isLandlord: users.isLandlord, isRenter: users.isRenter })
    .from(users)
    .where(eq(users.id, userId));
  return row;
}

async function insertProperty(landlordId: string | null, createdById: string | null): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .insert(properties)
    .values({ address: `${unique()} Roles Test Ave`, city: "Testville", region: "TS", landlordId, createdById })
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

/** Insert a review directly, skipping the permission checks. */
async function insertReview(values: {
  kind: ReviewKind;
  authorId: string;
  subjectUserId?: string;
  propertyId?: string;
  rating?: number;
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
      title: `Title ${unique()}`,
      body: "A review body that is long enough to be valid.",
    })
    .returning({ id: reviews.id });
  return row.id;
}

/** Submit the review form as the signed-in user. */
function review(
  kind: ReviewKind,
  subjectId: string,
  overrides: { rating?: number; title?: string; body?: string } = {},
): Promise<FormState> {
  return saveReview(
    idleFormState,
    form({
      kind,
      subjectId,
      rating: String(overrides.rating ?? 4),
      title: overrides.title ?? `Review ${unique()}`,
      body: overrides.body ?? "Long enough review text for the validation rules.",
    }),
  );
}

async function reviewsBy(authorId: string) {
  const db = await getDb();
  return db
    .select({ kind: reviews.kind, subjectUserId: reviews.subjectUserId, propertyId: reviews.propertyId, title: reviews.title })
    .from(reviews)
    .where(eq(reviews.authorId, authorId));
}

function changeRoleTo(role: UserRole, change: "add" | "remove"): Promise<FormState> {
  return changeRole(idleFormState, form({ role, change }));
}

const LIVE = "Thanks! Your review is live.";
const UPDATED = "Your review was updated.";
const ONLY_RENTERS_LANDLORDS = "Only renters can review landlords.";
const ONLY_LANDLORDS_RENTERS = "Only landlords can review renters.";
const ONLY_RENTERS_PROPERTIES = "Only renters can review properties.";
const NOT_YOURSELF = "You can't review yourself.";
const NOT_YOUR_PROPERTY = "You can't review a property you manage.";
const NEED_ONE_ROLE = "You need at least one role. Add the other one first.";
const reviewedAs = (role: UserRole) => `People have reviewed you as a ${role}, so you can't remove that role.`;
const CLAIMED = "Done. You're now listed as this property's landlord.";
const CLAIM_AFTER_REVIEW =
  "You've reviewed this property as a renter, so you can't also be its landlord. Delete your review first.";
const ONLY_LANDLORDS_ME = "Only landlords can list themselves as the landlord.";
const CHOOSE_RELATION = "Choose whether you own or rent this place.";

type Request<T> = { cookies: Map<string, string>; run: () => Promise<T> };

/**
 * Run `a` and `b` at the same time, each as its own browser. On run `i` of a
 * race loop, alternates which starts first and staggers the second by a few
 * milliseconds, so on a real Postgres (UNIT_DATABASE_URL) both orders happen.
 * Returns the results in the order [a, b].
 */
async function atOnce<A, B>(a: Request<A>, b: Request<B>, i = 0): Promise<[A, B]> {
  const start = <T,>(request: Request<T>) =>
    requestScope.run({ headers: browser.headers, cookies: request.cookies }, request.run);
  const delay = [0, 0, 1, 2, 3, 5, 8, 13][Math.floor(i / 2) % 8];
  const pause = () => new Promise((resolve) => setTimeout(resolve, delay));
  if (i % 2 === 0) {
    const first = start(a);
    await pause();
    return Promise.all([first, start(b)]);
  }
  const first = start(b);
  await pause();
  const second = start(a);
  const [bResult, aResult] = await Promise.all([first, second]);
  return [aResult, bResult];
}

/** Log in and return that browser's cookie jar. */
async function cookiesOf(user: CreatedUser): Promise<Map<string, string>> {
  await logInAs(user);
  return new Map(browser.cookies);
}

/** Every review about `userId` in a role they don't have (should never exist). */
async function hiddenReviewsAbout(userId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ kind: reviews.kind, isLandlord: users.isLandlord, isRenter: users.isRenter })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.subjectUserId))
    .where(eq(reviews.subjectUserId, userId));
  return rows
    .filter((row) => (row.kind === "landlord" ? !row.isLandlord : !row.isRenter))
    .map((row) => row.kind);
}

/** Reviews someone wrote of a property they're now the landlord of (should never exist). */
async function reviewsOfOwnProperties(userId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: reviews.id })
    .from(reviews)
    .innerJoin(properties, eq(properties.id, reviews.propertyId))
    .where(and(eq(reviews.authorId, userId), eq(properties.landlordId, userId)));
  return rows.map((row) => row.id);
}

/** Properties whose landlord isn't (any more) a landlord (should never exist). */
async function propertiesOfNonLandlord(userId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: properties.id })
    .from(properties)
    .innerJoin(users, eq(users.id, properties.landlordId))
    .where(and(eq(properties.landlordId, userId), eq(users.isLandlord, false)));
  return rows.map((row) => row.id);
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

// ---------------------------------------------------------------------------
// Sign-up
// ---------------------------------------------------------------------------

describe("signup with roles", () => {
  function signupForm(roles: Record<string, string>) {
    const id = unique();
    return {
      email: `signup-roles-${id}@example.com`,
      data: form({
        name: `Signup ${id}`,
        email: `signup-roles-${id}@example.com`,
        password: "long-enough-password",
        city: "",
        ...roles,
      }),
    };
  }

  it.each([
    ["a renter", { isRenter: "on" }, { isRenter: true, isLandlord: false }],
    ["a landlord", { isLandlord: "on" }, { isRenter: false, isLandlord: true }],
    ["both", { isRenter: "on", isLandlord: "on" }, { isRenter: true, isLandlord: true }],
  ])("signs up as %s, and the session knows the roles", async (_label, roles, expected) => {
    const { email, data } = signupForm(roles);
    expect(await outcome(signup(idleFormState, data))).toEqual({ redirect: "/dashboard" });
    const db = await getDb();
    const [row] = await db.select().from(users).where(eq(users.email, email));
    expect(row).toMatchObject(expected);
    // The signed-in user (from the session cookie) carries the same flags.
    expect(await getCurrentUser()).toMatchObject({ id: row.id, ...expected });
    expect(await getCurrentUser()).not.toHaveProperty("role");
  });

  it("refuses a sign-up with no role ticked, keeping what was typed", async () => {
    const { email, data } = signupForm({});
    const result = await signup(idleFormState, data);
    expect(result).toMatchObject({
      status: "error",
      fieldErrors: { roles: ["Choose at least one: renter, landlord, or both."] },
      values: { email },
    });
    const db = await getDb();
    expect(await db.select().from(users).where(eq(users.email, email))).toEqual([]);
  });

  it("the database also refuses an account with no role", async () => {
    const db = await getDb();
    const error = await db
      .insert(users)
      .values({ name: "Nobody", email: `norole-${unique()}@example.com`, passwordHash: "x" })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(pgErrorCode(error)).toBe("23514"); // check_violation (users_has_a_role)
  });
});

// ---------------------------------------------------------------------------
// Adding and removing a role
// ---------------------------------------------------------------------------

describe("changeRole", () => {
  it("requires a signed-in user", async () => {
    expect(await changeRoleTo("landlord", "add")).toEqual({ status: "error", message: "Please log in again." });
  });

  it.each([
    [{ role: "admin", change: "add" }],
    [{ role: "landlord", change: "toggle" }],
    [{ role: "renter" }],
    [{}],
  ])("rejects a malformed request %j", async (fields) => {
    const user = await createUser("renter");
    await logInAs(user);
    expect(await changeRole(idleFormState, form(fields as Record<string, string>))).toEqual({
      status: "error",
      message: "Something went wrong. Please try again.",
    });
    expect(await flags(user.id)).toEqual({ isLandlord: false, isRenter: true });
  });

  it("a renter adds the landlord role, and can then do landlord things", async () => {
    const user = await createUser("renter");
    const someRenter = await createUser("renter");
    const unclaimed = await insertProperty(null, someRenter.id);
    await logInAs(user);
    expect(await claimProperty(idleFormState, form({ propertyId: unclaimed }))).toMatchObject({
      message: "Only landlords can claim a property.",
    });

    expect(await changeRoleTo("landlord", "add")).toEqual({
      status: "success",
      message: "Done. You're now listed as a landlord too.",
    });
    expect(await flags(user.id)).toEqual({ isLandlord: true, isRenter: true });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    // The same session picks up the new role straight away.
    expect(await getCurrentUser()).toMatchObject({ isLandlord: true, isRenter: true });
    expect(await claimProperty(idleFormState, form({ propertyId: unclaimed }))).toMatchObject({ status: "success" });
    expect(await review("renter", someRenter.id)).toMatchObject({ status: "success", message: LIVE });
  });

  it("a landlord adds the renter role, and can then review a landlord and a property", async () => {
    const user = await createUser("landlord");
    const otherLandlord = await createUser("landlord");
    const propertyId = await insertProperty(otherLandlord.id, otherLandlord.id);
    await logInAs(user);
    expect(await review("landlord", otherLandlord.id)).toEqual({ status: "error", message: ONLY_RENTERS_LANDLORDS });
    expect(await review("property", propertyId)).toEqual({ status: "error", message: ONLY_RENTERS_PROPERTIES });

    expect(await changeRoleTo("renter", "add")).toEqual({
      status: "success",
      message: "Done. You're now listed as a renter too.",
    });
    expect(await flags(user.id)).toEqual({ isLandlord: true, isRenter: true });
    expect(await review("landlord", otherLandlord.id)).toMatchObject({ status: "success", message: LIVE });
    expect(await review("property", propertyId)).toMatchObject({ status: "success", message: LIVE });
  });

  it("adding a role you already have changes nothing", async () => {
    const user = await createUser("both");
    await logInAs(user);
    expect((await changeRoleTo("renter", "add")).status).toBe("success");
    expect(await flags(user.id)).toEqual({ isLandlord: true, isRenter: true });
  });

  it.each([
    ["renter", "renter" as const],
    ["landlord", "landlord" as const],
  ])("can't remove your only role (%s)", async (_label, role) => {
    const user = await createUser(role);
    await logInAs(user);
    expect(await changeRoleTo(role, "remove")).toEqual({ status: "error", message: NEED_ONE_ROLE });
    expect(await flags(user.id)).toEqual({ isLandlord: role === "landlord", isRenter: role === "renter" });
  });

  it("removing the role you don't have leaves your account as it was", async () => {
    const user = await createUser("renter");
    await logInAs(user);
    await changeRoleTo("landlord", "remove");
    expect(await flags(user.id)).toEqual({ isLandlord: false, isRenter: true });
  });

  it("someone with both roles can remove one nobody reviewed them in", async () => {
    const user = await createUser("both");
    await logInAs(user);
    expect(await changeRoleTo("renter", "remove")).toEqual({
      status: "success",
      message: "Done. You're no longer listed as a renter.",
    });
    expect(await flags(user.id)).toEqual({ isLandlord: true, isRenter: false });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    // ...and then can't remove the last one.
    expect(await changeRoleTo("landlord", "remove")).toEqual({ status: "error", message: NEED_ONE_ROLE });
    expect(await flags(user.id)).toEqual({ isLandlord: true, isRenter: false });
  });

  it("can't remove a role someone reviewed you in (so reviews can't be hidden)", async () => {
    const user = await createUser("both");
    const landlord = await createUser("landlord");
    const renter = await createUser("renter");
    // Reviewed as a renter only.
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

  // changeRole locks the user row while it checks for reviews and removes the
  // role; saveReview share-locks the subject's row while it checks the role
  // and writes. (With the embedded database these run one after the other;
  // run with UNIT_DATABASE_URL to race them on a real Postgres.)
  it("a review that arrives while the role is being removed is never left hidden", async () => {
    // Removing a role and being reviewed in it at the same moment: whichever
    // wins, nobody may end up with reviews about a role they no longer have.
    for (let i = 0; i < 10; i++) {
      const user = await createUser("both");
      const landlord = await createUser("landlord");
      const [removed, reviewed] = await atOnce(
        { cookies: await cookiesOf(user), run: () => changeRoleTo("renter", "remove") },
        { cookies: await cookiesOf(landlord), run: () => review("renter", user.id) },
        i,
      );

      const hidden = (await flags(user.id)).isRenter === false;
      const about = await listReviewsAbout({ userId: user.id, as: "renter" });
      expect(
        hidden && about.total > 0,
        `run ${i}: remove → ${removed.message}; review → ${reviewed.message}`,
      ).toBe(false);
    }
  }, 60_000);

  it("a landlord review that arrives while the landlord role is being removed is never left hidden", async () => {
    for (let i = 0; i < 10; i++) {
      const user = await createUser("both");
      const renter = await createUser("renter");
      const [removed, reviewed] = await atOnce(
        { cookies: await cookiesOf(user), run: () => changeRoleTo("landlord", "remove") },
        { cookies: await cookiesOf(renter), run: () => review("landlord", user.id) },
        i,
      );
      const detail = `run ${i}: remove → ${removed.message}; review → ${reviewed.message}`;
      expect(await hiddenReviewsAbout(user.id), detail).toEqual([]);
      // Exactly one of them wins.
      expect([removed.status, reviewed.status].sort(), detail).toEqual(["error", "success"]);
    }
  }, 60_000);

  it("a claim racing the landlord role's removal never leaves a non-landlord managing a property", async () => {
    for (let i = 0; i < 10; i++) {
      const user = await createUser("both");
      const propertyId = await insertProperty(null, null);
      const cookies = await cookiesOf(user);
      const [removed, claimed] = await atOnce(
        { cookies, run: () => changeRoleTo("landlord", "remove") },
        { cookies, run: () => claimProperty(idleFormState, form({ propertyId })) },
        i,
      );
      const detail = `run ${i}: remove → ${removed.message}; claim → ${claimed.message}`;
      expect(await propertiesOfNonLandlord(user.id), detail).toEqual([]);
      expect(removed.status, detail).toBe("success");
      // The claim either landed first (and was unlinked by the removal) or was refused.
      expect(await landlordOf(propertyId), detail).toBeNull();
    }
  }, 60_000);

  it("adding your own property while removing the landlord role never leaves you managing it", async () => {
    for (let i = 0; i < 10; i++) {
      const user = await createUser("both");
      const cookies = await cookiesOf(user);
      const address = `${unique()} Race Own St`;
      const [removed, added] = await atOnce(
        { cookies, run: () => changeRoleTo("landlord", "remove") },
        {
          cookies,
          run: () =>
            outcome(
              createProperty(
                idleFormState,
                form({ address, unit: "", city: "Testville", region: "TS", postalCode: "", description: "", relation: "own" }),
              ),
            ),
        },
        i,
      );
      const detail = `run ${i}: remove → ${removed.message}; add → ${JSON.stringify(added)}`;
      expect(removed.status, detail).toBe("success");
      expect(await propertiesOfNonLandlord(user.id), detail).toEqual([]);
      if (!("redirect" in added)) {
        expect(added, detail).toMatchObject({ status: "error", fieldErrors: { landlordId: [ONLY_LANDLORDS_ME] } });
      }
    }
  }, 60_000);

  it("a renter linking you as their landlord while you remove that role never leaves you managing it", async () => {
    for (let i = 0; i < 16; i++) {
      const user = await createUser("both");
      const renter = await createUser("renter");
      const address = `${unique()} Race Link St`;
      const [removed, added] = await atOnce(
        { cookies: await cookiesOf(user), run: () => changeRoleTo("landlord", "remove") },
        {
          cookies: await cookiesOf(renter),
          run: () =>
            outcome(
              createProperty(
                idleFormState,
                form({ address, unit: "", city: "Testville", region: "TS", postalCode: "", description: "", landlordId: user.id }),
              ),
            ),
        },
        i,
      );
      const detail = `run ${i}: remove → ${removed.message}; add → ${JSON.stringify(added)}`;
      expect(removed.status, detail).toBe("success");
      expect(await propertiesOfNonLandlord(user.id), detail).toEqual([]);
    }
  }, 60_000);

  describe("the way back after adding a role (next)", () => {
    it("offers a link back to the page that sent you, after adding a role", async () => {
      const user = await createUser("renter");
      const landlord = await createUser("landlord");
      await logInAs(user);
      const result = await changeRole(
        idleFormState,
        form({ role: "landlord", change: "add", next: `/renters/${landlord.id}` }),
      );
      expect(result).toEqual({
        status: "success",
        message: "Done. You're now listed as a landlord too.",
        link: { href: `/renters/${landlord.id}`, label: "Back to write your review" },
      });
    });

    it("keeps the query and normalizes the path it links to", async () => {
      const user = await createUser("landlord");
      await logInAs(user);
      const result = await changeRole(
        idleFormState,
        form({ role: "renter", change: "add", next: "/properties/../landlords?page=2" }),
      );
      expect(result.link).toEqual({ href: "/landlords?page=2", label: "Back to write your review" });
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
      const user = await createUser("renter");
      await logInAs(user);
      const result = await changeRole(idleFormState, form({ role: "landlord", change: "add", next }));
      expect(result.status).toBe("success");
      expect(result.link).toBeUndefined();
      expect(await flags(user.id)).toEqual({ isLandlord: true, isRenter: true });
    });

    it("no link without next, or after removing a role", async () => {
      const user = await createUser("renter");
      await logInAs(user);
      expect((await changeRoleTo("landlord", "add")).link).toBeUndefined();
      const removed = await changeRole(idleFormState, form({ role: "landlord", change: "remove", next: "/renters" }));
      expect(removed).toEqual({ status: "success", message: "Done. You're no longer listed as a landlord." });
    });

    it("an error doesn't offer the link either", async () => {
      const user = await createUser("renter");
      await logInAs(user);
      expect(
        await changeRole(idleFormState, form({ role: "renter", change: "remove", next: "/landlords" })),
      ).toEqual({ status: "error", message: NEED_ONE_ROLE });
    });
  });

  it("reviews you wrote, or reviews of your properties, don't block removing a role", async () => {
    const user = await createUser("both");
    const renter = await createUser("renter");
    const landlord = await createUser("landlord");
    const managed = await insertProperty(user.id, user.id);
    await insertReview({ kind: "property", authorId: renter.id, propertyId: managed });
    await insertReview({ kind: "renter", authorId: user.id, subjectUserId: renter.id });
    await insertReview({ kind: "landlord", authorId: user.id, subjectUserId: landlord.id });
    await logInAs(user);
    expect((await changeRoleTo("landlord", "remove")).status).toBe("success");
    expect(await flags(user.id)).toEqual({ isLandlord: false, isRenter: true });
  });

  it("removing the landlord role unlinks only your properties; the listings stay", async () => {
    const user = await createUser("both");
    const otherLandlord = await createUser("landlord");
    const renter = await createUser("renter");
    const listedByMe = await insertProperty(user.id, user.id);
    const linkedByRenter = await insertProperty(user.id, renter.id);
    const placeIRent = await insertProperty(otherLandlord.id, user.id);
    const unrelated = await insertProperty(otherLandlord.id, otherLandlord.id);
    const propertyReview = await insertReview({ kind: "property", authorId: renter.id, propertyId: linkedByRenter });
    await logInAs(user);

    expect((await changeRoleTo("landlord", "remove")).status).toBe("success");
    expect(await landlordOf(listedByMe)).toBeNull();
    expect(await landlordOf(linkedByRenter)).toBeNull();
    expect(await landlordOf(placeIRent)).toBe(otherLandlord.id);
    expect(await landlordOf(unrelated)).toBe(otherLandlord.id);
    const db = await getDb();
    expect(await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.propertyId, linkedByRenter))).toEqual([
      { id: propertyReview },
    ]);
    // No longer a landlord: can't claim or be picked as a landlord.
    expect(await claimProperty(idleFormState, form({ propertyId: listedByMe }))).toMatchObject({
      message: "Only landlords can claim a property.",
    });
    expect((await listLandlordOptions()).map((l) => l.id)).not.toContain(user.id);
    // Another landlord can claim the unlinked listings.
    await logInAs(otherLandlord);
    expect(await claimProperty(idleFormState, form({ propertyId: listedByMe }))).toMatchObject({ status: "success" });
  });

  it("removing the renter role keeps the properties you manage", async () => {
    const user = await createUser("both");
    const managed = await insertProperty(user.id, user.id);
    await logInAs(user);
    expect((await changeRoleTo("renter", "remove")).status).toBe("success");
    expect(await landlordOf(managed)).toBe(user.id);
  });

  it("after removing the renter role you can't review landlords or properties", async () => {
    const user = await createUser("both");
    const landlord = await createUser("landlord");
    const propertyId = await insertProperty(landlord.id, landlord.id);
    await logInAs(user);
    await changeRoleTo("renter", "remove");
    expect(await review("landlord", landlord.id)).toEqual({ status: "error", message: ONLY_RENTERS_LANDLORDS });
    expect(await review("property", propertyId)).toEqual({ status: "error", message: ONLY_RENTERS_PROPERTIES });
    // And nobody can review them as a renter any more.
    await logInAs(landlord);
    expect(await review("renter", user.id)).toEqual({ status: "error", message: "That renter no longer exists." });
  });
});

// ---------------------------------------------------------------------------
// Who may review whom
// ---------------------------------------------------------------------------

describe("saveReview permissions by role", () => {
  type Cast = {
    landlord: CreatedUser;
    renter: CreatedUser;
    both: CreatedUser;
    property: string;
  };
  let subjects: Cast;

  beforeAll(async () => {
    const landlord = await createUser("landlord");
    subjects = {
      landlord,
      renter: await createUser("renter"),
      both: await createUser("both"),
      property: await insertProperty(landlord.id, null),
    };
  });

  /** [kind, subject] → expected message for each kind of author. */
  const cases: [string, ReviewKind, (s: Cast) => string, Record<Roles, string>][] = [
    [
      "a landlord",
      "landlord",
      (s) => s.landlord.id,
      { renter: LIVE, landlord: ONLY_RENTERS_LANDLORDS, both: LIVE },
    ],
    [
      "a renter",
      "renter",
      (s) => s.renter.id,
      { renter: ONLY_LANDLORDS_RENTERS, landlord: LIVE, both: LIVE },
    ],
    [
      "a property",
      "property",
      (s) => s.property,
      { renter: LIVE, landlord: ONLY_RENTERS_PROPERTIES, both: LIVE },
    ],
    [
      "someone with both roles, as a landlord",
      "landlord",
      (s) => s.both.id,
      { renter: LIVE, landlord: ONLY_RENTERS_LANDLORDS, both: LIVE },
    ],
    [
      "someone with both roles, as a renter",
      "renter",
      (s) => s.both.id,
      { renter: ONLY_LANDLORDS_RENTERS, landlord: LIVE, both: LIVE },
    ],
  ];

  for (const author of ["renter", "landlord", "both"] as const) {
    for (const [label, kind, subjectOf, expected] of cases) {
      it(`a ${author === "both" ? "renter-and-landlord" : `${author}-only user`} reviewing ${label}: ${expected[author]}`, async () => {
        const user = await createUser(author);
        await logInAs(user);
        const result = await review(kind, subjectOf(subjects));
        if (expected[author] === LIVE) {
          expect(result).toMatchObject({ status: "success", message: LIVE });
          expect(await reviewsBy(user.id)).toHaveLength(1);
        } else {
          expect(result).toEqual({ status: "error", message: expected[author] });
          expect(await reviewsBy(user.id)).toEqual([]);
        }
      });
    }
  }

  it("nobody can review themselves, in either role", async () => {
    for (const roles of ["renter", "landlord", "both"] as const) {
      const user = await createUser(roles);
      await logInAs(user);
      for (const kind of ["landlord", "renter"] as const) {
        const result = await review(kind, user.id);
        expect(result.status, `${roles} reviewing themselves as a ${kind}`).toBe("error");
        // Someone with the right role to write it is told why.
        if (roles === "both") expect(result.message).toBe(NOT_YOURSELF);
      }
      expect(await reviewsBy(user.id)).toEqual([]);
    }
  });

  it("the database also refuses a self-review", async () => {
    const user = await createUser("both");
    const error = await insertReview({ kind: "landlord", authorId: user.id, subjectUserId: user.id }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(pgErrorCode(error)).toBe("23514");
  });

  it("can't review a property you manage, whoever added it", async () => {
    const user = await createUser("both");
    const renter = await createUser("renter");
    const listedByMe = await insertProperty(user.id, user.id);
    const linkedByRenter = await insertProperty(user.id, renter.id);
    await logInAs(user);
    expect(await review("property", listedByMe)).toEqual({ status: "error", message: NOT_YOUR_PROPERTY });
    expect(await review("property", linkedByRenter)).toEqual({ status: "error", message: NOT_YOUR_PROPERTY });
    expect(await reviewsBy(user.id)).toEqual([]);
    // A property you added as a renter (someone else manages it) is fine.
    const placeIRent = await insertProperty(subjects.landlord.id, user.id);
    expect(await review("property", placeIRent)).toMatchObject({ status: "success" });
    // So is one with no landlord yet.
    expect(await review("property", await insertProperty(null, user.id))).toMatchObject({ status: "success" });
  });

  // Someone with both roles reviews the place they rent as a renter, then
  // claims it as its landlord: they'd end up with a review of a property they
  // manage, which the rule above is meant to prevent. The claim is refused.
  it("claiming a property you reviewed doesn't leave you reviewing a property you manage", async () => {
    const user = await createUser("both");
    const propertyId = await insertProperty(null, user.id);
    await logInAs(user);
    expect(await review("property", propertyId)).toMatchObject({ status: "success" });
    expect(await claimProperty(idleFormState, form({ propertyId }))).toEqual({
      status: "error",
      message: CLAIM_AFTER_REVIEW,
    });
    const db = await getDb();
    const ownReviews = await db
      .select({ id: reviews.id })
      .from(reviews)
      .innerJoin(properties, eq(properties.id, reviews.propertyId))
      .where(and(eq(reviews.authorId, user.id), eq(properties.landlordId, user.id)));
    expect(ownReviews).toEqual([]);
  });

  it("after unlinking yourself from a property you may review it as a renter", async () => {
    const user = await createUser("both");
    const propertyId = await insertProperty(user.id, user.id);
    await logInAs(user);
    expect(await review("property", propertyId)).toEqual({ status: "error", message: NOT_YOUR_PROPERTY });
    expect((await unlinkProperty(idleFormState, form({ propertyId }))).status).toBe("success");
    expect(await review("property", propertyId)).toMatchObject({ status: "success" });
  });

  it("the person reviewed must have the role they're reviewed in", async () => {
    const renterOnly = await createUser("renter");
    const landlordOnly = await createUser("landlord");
    const reviewer = await createUser("both");
    await logInAs(reviewer);
    expect(await review("landlord", renterOnly.id)).toEqual({
      status: "error",
      message: "That landlord no longer exists.",
    });
    expect(await review("renter", landlordOnly.id)).toEqual({
      status: "error",
      message: "That renter no longer exists.",
    });
    expect(await reviewsBy(reviewer.id)).toEqual([]);
  });

  it("signed-out visitors can't review", async () => {
    expect(await review("landlord", subjects.both.id)).toEqual({
      status: "error",
      message: "Please log in to leave a review.",
    });
  });
});

// ---------------------------------------------------------------------------
// One review per author per person per role
// ---------------------------------------------------------------------------

describe("reviewing someone with both roles", () => {
  it("the same author reviews them once as a landlord and once as a renter; writing again edits", async () => {
    const subject = await createUser("both");
    const author = await createUser("both");
    await logInAs(author);

    expect(await review("landlord", subject.id, { title: "As landlord" })).toMatchObject({ message: LIVE });
    expect(await review("renter", subject.id, { title: "As renter" })).toMatchObject({ message: LIVE });
    expect((await reviewsBy(author.id)).map((r) => [r.kind, r.title]).sort()).toEqual([
      ["landlord", "As landlord"],
      ["renter", "As renter"],
    ]);

    // Writing again in one role edits that review only.
    expect(await review("landlord", subject.id, { title: "As landlord, edited" })).toMatchObject({
      status: "success",
      message: UPDATED,
    });
    expect((await reviewsBy(author.id)).map((r) => [r.kind, r.title]).sort()).toEqual([
      ["landlord", "As landlord, edited"],
      ["renter", "As renter"],
    ]);
    expect(await review("renter", subject.id, { title: "As renter, edited" })).toMatchObject({ message: UPDATED });
    expect((await reviewsBy(author.id)).map((r) => [r.kind, r.title]).sort()).toEqual([
      ["landlord", "As landlord, edited"],
      ["renter", "As renter, edited"],
    ]);

    // Each role's form finds its own review.
    expect((await getReviewByAuthor(author.id, { userId: subject.id, as: "landlord" }))?.title).toBe(
      "As landlord, edited",
    );
    expect((await getReviewByAuthor(author.id, { userId: subject.id, as: "renter" }))?.title).toBe(
      "As renter, edited",
    );
  });

  it("a double-submit in one role still leaves one review for that role", async () => {
    const subject = await createUser("both");
    const author = await createUser("both");
    await logInAs(author);
    const results = await Promise.all([
      review("renter", subject.id, { title: "First" }),
      review("renter", subject.id, { title: "Second" }),
      review("landlord", subject.id, { title: "Third" }),
    ]);
    expect(results.every((r) => r.status === "success")).toBe(true);
    const mine = await reviewsBy(author.id);
    expect(mine.filter((r) => r.kind === "renter")).toHaveLength(1);
    expect(mine.filter((r) => r.kind === "landlord")).toHaveLength(1);
  });

  it("the database allows one review per author, person, and role", async () => {
    const subject = await createUser("both");
    const author = await createUser("both");
    await insertReview({ kind: "landlord", authorId: author.id, subjectUserId: subject.id });
    await insertReview({ kind: "renter", authorId: author.id, subjectUserId: subject.id });
    const duplicate = await insertReview({ kind: "renter", authorId: author.id, subjectUserId: subject.id }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(pgErrorCode(duplicate)).toBe("23505");
    // A different author is fine.
    const other = await createUser("landlord");
    await insertReview({ kind: "renter", authorId: other.id, subjectUserId: subject.id });
  });

  it("deleting one role's review leaves the other", async () => {
    const subject = await createUser("both");
    const author = await createUser("both");
    await logInAs(author);
    await review("landlord", subject.id);
    await review("renter", subject.id);
    const landlordReview = await getReviewByAuthor(author.id, { userId: subject.id, as: "landlord" });
    await deleteReview(form({ reviewId: landlordReview!.id }));
    expect((await reviewsBy(author.id)).map((r) => r.kind)).toEqual(["renter"]);
  });
});

// ---------------------------------------------------------------------------
// Ratings are kept separately for each role
// ---------------------------------------------------------------------------

describe("per-role ratings", () => {
  let subject: CreatedUser;
  let renterA: CreatedUser;
  let landlordA: CreatedUser;

  beforeAll(async () => {
    subject = await createUser("both");
    renterA = await createUser("renter");
    const renterB = await createUser("renter");
    landlordA = await createUser("landlord");
    // As a landlord: 5 and 4 stars. As a renter: 1 star.
    await insertReview({ kind: "landlord", authorId: renterA.id, subjectUserId: subject.id, rating: 5 });
    await insertReview({ kind: "landlord", authorId: renterB.id, subjectUserId: subject.id, rating: 4 });
    await insertReview({ kind: "renter", authorId: landlordA.id, subjectUserId: subject.id, rating: 1 });
    // Reviews of their property don't count toward either personal rating.
    const managed = await insertProperty(subject.id, subject.id);
    await insertReview({ kind: "property", authorId: renterA.id, propertyId: managed, rating: 2 });
  });

  it("getRatingSummary counts only the reviews about that role", async () => {
    expect(await getRatingSummary({ userId: subject.id, as: "landlord" })).toEqual({
      average: 4.5,
      count: 2,
      distribution: [0, 0, 0, 1, 1],
    });
    expect(await getRatingSummary({ userId: subject.id, as: "renter" })).toEqual({
      average: 1,
      count: 1,
      distribution: [1, 0, 0, 0, 0],
    });
  });

  it("listReviewsAbout lists only that role's reviews, with the author's role as they wrote it", async () => {
    const asLandlord = await listReviewsAbout({ userId: subject.id, as: "landlord" });
    expect(asLandlord.total).toBe(2);
    expect(asLandlord.items.map((r) => r.rating).sort()).toEqual([4, 5]);
    for (const item of asLandlord.items) {
      expect(item.kind).toBe("landlord");
      expect(item.author.role).toBe("renter");
      expect(item.subject).toMatchObject({ kind: "landlord", id: subject.id });
    }

    const asRenter = await listReviewsAbout({ userId: subject.id, as: "renter" });
    expect(asRenter.total).toBe(1);
    expect(asRenter.items[0]).toMatchObject({
      kind: "renter",
      rating: 1,
      author: { id: landlordA.id, role: "landlord", isLandlord: true, isRenter: false },
      subject: { kind: "renter", id: subject.id },
    });
  });

  it("a review's author role is the role they wrote it in, even when they have both", async () => {
    const author = await createUser("both");
    const someone = await createUser("both");
    await insertReview({ kind: "renter", authorId: author.id, subjectUserId: someone.id });
    await insertReview({ kind: "landlord", authorId: author.id, subjectUserId: someone.id });
    const { items } = await listReviewsByAuthor(author.id);
    expect(items.map((r) => [r.kind, r.author.role]).sort()).toEqual([
      ["landlord", "renter"],
      ["renter", "landlord"],
    ]);
    for (const item of items) expect(item.author).toMatchObject({ isLandlord: true, isRenter: true });
  });

  it("the directories show each role's own rating and count", async () => {
    const [asLandlord] = (await listPeople({ role: "landlord", query: subject.name })).items;
    expect(asLandlord).toMatchObject({ id: subject.id, average: 4.5, reviewCount: 2, isLandlord: true, isRenter: true });
    expect(asLandlord.propertyCount).toBe(1);
    const [asRenter] = (await listPeople({ role: "renter", query: subject.name })).items;
    expect(asRenter).toMatchObject({ id: subject.id, average: 1, reviewCount: 1 });
  });

  it("someone with one role is listed only in that directory", async () => {
    const landlordOnly = await createUser("landlord");
    expect((await listPeople({ role: "landlord", query: landlordOnly.name })).total).toBe(1);
    expect((await listPeople({ role: "renter", query: landlordOnly.name })).total).toBe(0);
    expect(await getPublicUser(landlordOnly.id, "landlord")).toMatchObject({ id: landlordOnly.id });
    expect(await getPublicUser(landlordOnly.id, "renter")).toBeNull();
    expect(await getPublicUser(subject.id, "renter")).toMatchObject({ isLandlord: true, isRenter: true });
  });

  it("a review in one role doesn't change the other role's rating", async () => {
    const person = await createUser("both");
    expect((await getRatingSummary({ userId: person.id, as: "renter" })).count).toBe(0);
    await insertReview({ kind: "landlord", authorId: renterA.id, subjectUserId: person.id, rating: 2 });
    expect(await getRatingSummary({ userId: person.id, as: "renter" })).toEqual({
      average: null,
      count: 0,
      distribution: [0, 0, 0, 0, 0],
    });
    expect((await getRatingSummary({ userId: person.id, as: "landlord" })).average).toBe(2);
  });

  it("site stats count someone with both roles as a landlord and as a renter", async () => {
    const before = await getSiteStats();
    await createUser("both");
    const after = await getSiteStats();
    expect(after.landlords - before.landlords).toBe(1);
    expect(after.renters - before.renters).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Adding a property: "me" and linking a landlord
// ---------------------------------------------------------------------------

describe("createProperty and roles", () => {
  function propertyForm(landlordId: string, extra: Record<string, string> = {}) {
    return form({
      address: `${unique()} Roles Property Rd`,
      unit: "",
      city: "Testville",
      region: "TS",
      postalCode: "",
      description: "",
      landlordId,
      ...extra,
    });
  }

  /** Add a property as the signed-in user; returns its landlord, or the error. */
  async function add(
    landlordId: string,
    extra: Record<string, string> = {},
  ): Promise<{ landlordId: string | null } | FormState> {
    const result = await outcome(createProperty(idleFormState, propertyForm(landlordId, extra)));
    if (!("redirect" in result)) return result;
    expect(result.redirect).toMatch(/^\/properties\/[0-9a-f-]{36}$/);
    return { landlordId: await landlordOf(result.redirect.split("/").pop()!) };
  }

  const GONE = "That landlord isn't on GossipRent anymore.";

  let landlord: CreatedUser;
  let renter: CreatedUser;
  let both: CreatedUser;
  beforeAll(async () => {
    landlord = await createUser("landlord");
    renter = await createUser("renter");
    both = await createUser("both");
  });

  it('someone with both roles lists it as their own with "me" (or their own id)', async () => {
    const user = await createUser("both");
    await logInAs(user);
    expect(await add("me")).toEqual({ landlordId: user.id });
    expect(await add(user.id)).toEqual({ landlordId: user.id });
    expect(revalidatePath).toHaveBeenCalledWith(`/landlords/${user.id}`);
  });

  it("someone with both roles can add the place they rent, with or without its landlord", async () => {
    const user = await createUser("both");
    await logInAs(user);
    expect(await add("", { relation: "rent" })).toEqual({ landlordId: null });
    expect(await add(landlord.id)).toEqual({ landlordId: landlord.id });
    // Another person with both roles is a landlord too.
    expect(await add(both.id)).toEqual({ landlordId: both.id });
  });

  it('a renter can\'t use "me" or their own id to become a property\'s landlord', async () => {
    const user = await createUser("renter");
    await logInAs(user);
    for (const value of ["me", user.id]) {
      expect(await add(value)).toMatchObject({
        status: "error",
        fieldErrors: { landlordId: [ONLY_LANDLORDS_ME] },
        values: { landlordId: value },
      });
    }
    const db = await getDb();
    expect(await db.select().from(properties).where(eq(properties.createdById, user.id))).toEqual([]);
  });

  it("a renter links a landlord, or someone with both roles, but not a renter", async () => {
    const user = await createUser("renter");
    await logInAs(user);
    expect(await add("")).toEqual({ landlordId: null });
    expect(await add(landlord.id)).toEqual({ landlordId: landlord.id });
    expect(await add(both.id)).toEqual({ landlordId: both.id });
    expect(await add(renter.id)).toMatchObject({ status: "error", fieldErrors: { landlordId: [GONE] } });
  });

  it("someone who is only a landlord always lists it as their own", async () => {
    const user = await createUser("landlord");
    await logInAs(user);
    expect(await add("")).toEqual({ landlordId: user.id });
    expect(await add("me")).toEqual({ landlordId: user.id });
    expect(await add(landlord.id)).toEqual({ landlordId: user.id });
  });

  it("people with either role are offered as landlords only if they're landlords", async () => {
    const ids = (await listLandlordOptions()).map((l) => l.id);
    expect(ids).toContain(landlord.id);
    expect(ids).toContain(both.id);
    expect(ids).not.toContain(renter.id);
  });

  it("claiming a listing needs the landlord role; someone with both roles can", async () => {
    const propertyId = await insertProperty(null, renter.id);
    await logInAs(renter);
    expect(await claimProperty(idleFormState, form({ propertyId }))).toEqual({
      status: "error",
      message: "Only landlords can claim a property.",
    });
    await logInAs(both);
    expect(await claimProperty(idleFormState, form({ propertyId }))).toMatchObject({ status: "success" });
    expect(await landlordOf(propertyId)).toBe(both.id);
    const db = await getDb();
    const [row] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.landlordId, both.id)));
    expect(row?.id).toBe(propertyId);
  });
});

// ---------------------------------------------------------------------------
// Claiming a property you reviewed as a renter
// ---------------------------------------------------------------------------

describe("claiming a property you reviewed", () => {
  it("is refused, and the review and the listing stay as they were", async () => {
    const user = await createUser("both");
    const propertyId = await insertProperty(null, user.id);
    await logInAs(user);
    expect(await review("property", propertyId)).toMatchObject({ status: "success", message: LIVE });

    expect(await claimProperty(idleFormState, form({ propertyId }))).toEqual({
      status: "error",
      message: CLAIM_AFTER_REVIEW,
    });
    expect(await landlordOf(propertyId)).toBeNull();
    expect((await reviewsBy(user.id)).map((r) => r.propertyId)).toEqual([propertyId]);
  });

  it("a refused claim still refreshes the property page", async () => {
    const first = await createUser("landlord");
    const second = await createUser("both");
    const propertyId = await insertProperty(null, null);
    await logInAs(first);
    await claimProperty(idleFormState, form({ propertyId }));
    await logInAs(second);
    vi.mocked(revalidatePath).mockClear();
    expect(await claimProperty(idleFormState, form({ propertyId }))).toMatchObject({ status: "error" });
    expect(revalidatePath).toHaveBeenCalledWith(`/properties/${propertyId}`);
  });

  it("works once you've deleted your review", async () => {
    const user = await createUser("both");
    const propertyId = await insertProperty(null, user.id);
    await logInAs(user);
    await review("property", propertyId);
    const mine = await getReviewByAuthor(user.id, { propertyId });
    await deleteReview(form({ reviewId: mine!.id }));
    expect(await claimProperty(idleFormState, form({ propertyId }))).toEqual({ status: "success", message: CLAIMED });
    expect(await landlordOf(propertyId)).toBe(user.id);
    // ...and now they can't review it again.
    expect(await review("property", propertyId)).toEqual({ status: "error", message: NOT_YOUR_PROPERTY });
  });

  it("other people's reviews of the property don't stop a landlord claiming it", async () => {
    const renter = await createUser("renter");
    const landlord = await createUser("both");
    const propertyId = await insertProperty(null, renter.id);
    await insertReview({ kind: "property", authorId: renter.id, propertyId });
    // Reviews the landlord wrote about other things don't count either.
    await insertReview({ kind: "property", authorId: landlord.id, propertyId: await insertProperty(null, null) });
    await logInAs(landlord);
    expect(await claimProperty(idleFormState, form({ propertyId }))).toEqual({ status: "success", message: CLAIMED });
  });

  it("claiming one you already manage just says it's yours", async () => {
    const user = await createUser("both");
    const propertyId = await insertProperty(user.id, user.id);
    await logInAs(user);
    expect(await claimProperty(idleFormState, form({ propertyId }))).toEqual({ status: "success", message: CLAIMED });
  });

  it("a claim and a review of the same place at the same moment never both land", async () => {
    for (let i = 0; i < 10; i++) {
      const user = await createUser("both");
      const propertyId = await insertProperty(null, null);
      const cookies = await cookiesOf(user);
      const [claimed, reviewed] = await atOnce(
        { cookies, run: () => claimProperty(idleFormState, form({ propertyId })) },
        { cookies, run: () => review("property", propertyId) },
        i,
      );
      const detail = `run ${i}: claim → ${claimed.message}; review → ${reviewed.message}`;
      expect(await reviewsOfOwnProperties(user.id), detail).toEqual([]);
      expect([claimed.status, reviewed.status].sort(), detail).toEqual(["error", "success"]);
      if (claimed.status === "success") {
        expect(reviewed.message, detail).toBe(NOT_YOUR_PROPERTY);
        expect(await landlordOf(propertyId), detail).toBe(user.id);
      } else {
        expect(claimed.message, detail).toBe(CLAIM_AFTER_REVIEW);
        expect(await landlordOf(propertyId), detail).toBeNull();
      }
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Adding a property: own or rent (people with both roles must say which)
// ---------------------------------------------------------------------------

describe("createProperty: own or rent", () => {
  /** Submit the add-property form with exactly these extra fields. */
  async function addWith(
    fields: Record<string, string>,
  ): Promise<{ landlordId: string | null; propertyId: string } | FormState> {
    const result = await outcome(
      createProperty(
        idleFormState,
        form({
          address: `${unique()} Relation Rd`,
          unit: "",
          city: "Testville",
          region: "TS",
          postalCode: "",
          description: "",
          ...fields,
        }),
      ),
    );
    if (!("redirect" in result)) return result;
    const propertyId = result.redirect.split("/").pop()!;
    return { landlordId: await landlordOf(propertyId), propertyId };
  }

  async function createdBy(userId: string): Promise<number> {
    const db = await getDb();
    return (await db.select({ id: properties.id }).from(properties).where(eq(properties.createdById, userId))).length;
  }

  let landlord: CreatedUser;
  let renterOnly: CreatedUser;
  beforeAll(async () => {
    landlord = await createUser("landlord");
    renterOnly = await createUser("renter");
  });

  it("someone with both roles must choose; nothing is added until they do", async () => {
    const user = await createUser("both");
    await logInAs(user);
    const result = await addWith({ address: "12 Undecided Ave" });
    expect(result).toMatchObject({
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { relation: [CHOOSE_RELATION] },
      // What they typed comes back.
      values: { address: "12 Undecided Ave", city: "Testville" },
    });
    expect(await createdBy(user.id)).toBe(0);
  });

  it("rejects a relation that isn't own or rent", async () => {
    const user = await createUser("both");
    await logInAs(user);
    expect(await addWith({ relation: "manage" })).toMatchObject({
      status: "error",
      fieldErrors: { relation: [CHOOSE_RELATION] },
    });
    expect(await createdBy(user.id)).toBe(0);
  });

  it('"own" lists it as theirs, whatever the (hidden) landlord picker held', async () => {
    const user = await createUser("both");
    await logInAs(user);
    expect(await addWith({ relation: "own" })).toMatchObject({ landlordId: user.id });
    expect(await addWith({ relation: "own", landlordId: "" })).toMatchObject({ landlordId: user.id });
    expect(await addWith({ relation: "own", landlordId: landlord.id })).toMatchObject({ landlordId: user.id });
    expect(revalidatePath).toHaveBeenCalledWith(`/landlords/${user.id}`);
  });

  it('"rent" links the landlord they pick, or none', async () => {
    const user = await createUser("both");
    await logInAs(user);
    expect(await addWith({ relation: "rent", landlordId: landlord.id })).toMatchObject({ landlordId: landlord.id });
    expect(await addWith({ relation: "rent", landlordId: "" })).toMatchObject({ landlordId: null });
    // No picker value at all is "not on GossipRent / not sure".
    expect(await addWith({ relation: "rent" })).toMatchObject({ landlordId: null });
    // The landlord picked must be a landlord.
    expect(await addWith({ relation: "rent", landlordId: renterOnly.id })).toMatchObject({
      status: "error",
      fieldErrors: { landlordId: ["That landlord isn't on GossipRent anymore."] },
    });
  });

  it("a place they rent can then be reviewed by them; one they own can't", async () => {
    const user = await createUser("both");
    await logInAs(user);
    const rented = (await addWith({ relation: "rent", landlordId: landlord.id })) as { propertyId: string };
    const owned = (await addWith({ relation: "own" })) as { propertyId: string };
    expect(await review("property", rented.propertyId)).toMatchObject({ status: "success" });
    expect(await review("property", owned.propertyId)).toEqual({ status: "error", message: NOT_YOUR_PROPERTY });
  });

  it('older forms that send landlordId "me" (and no relation) still list it as their own', async () => {
    const user = await createUser("both");
    await logInAs(user);
    expect(await addWith({ landlordId: "me" })).toMatchObject({ landlordId: user.id });
  });

  it("picking another landlord counts as renting, but an empty landlord field isn't a choice", async () => {
    const user = await createUser("both");
    await logInAs(user);
    expect(await addWith({ landlordId: landlord.id })).toMatchObject({ landlordId: landlord.id });
    // Their form always contains the (hidden) landlord picker, so "" alone is ambiguous.
    expect(await addWith({ landlordId: "" })).toMatchObject({
      status: "error",
      fieldErrors: { relation: ["Choose whether you own or rent this place."] },
    });
  });

  it('a renter-only user can\'t use "own" to become the landlord', async () => {
    const user = await createUser("renter");
    await logInAs(user);
    expect(await addWith({ relation: "own" })).toMatchObject({
      status: "error",
      fieldErrors: { landlordId: [ONLY_LANDLORDS_ME] },
    });
    expect(await createdBy(user.id)).toBe(0);
    // They aren't asked to choose, and can link a landlord as before.
    expect(await addWith({ landlordId: landlord.id })).toMatchObject({ landlordId: landlord.id });
    expect(await addWith({})).toMatchObject({ landlordId: null });
  });

  it("a landlord-only user always lists it as their own, even if the form says rent", async () => {
    const user = await createUser("landlord");
    await logInAs(user);
    expect(await addWith({})).toMatchObject({ landlordId: user.id });
    expect(await addWith({ relation: "rent" })).toMatchObject({ landlordId: user.id });
    expect(await addWith({ relation: "rent", landlordId: landlord.id })).toMatchObject({ landlordId: user.id });
  });

  it("a duplicate address is reported before anything else changes", async () => {
    const user = await createUser("both");
    await logInAs(user);
    const first = (await addWith({ relation: "own", address: `${unique()} Twice St` })) as { propertyId: string };
    const db = await getDb();
    const [row] = await db.select().from(properties).where(eq(properties.id, first.propertyId));
    const again = await addWith({ relation: "rent", address: row.address });
    expect(again).toMatchObject({
      status: "error",
      message: "This property is already listed on GossipRent.",
      link: { href: `/properties/${first.propertyId}` },
    });
  });
});

// ---------------------------------------------------------------------------
// Closing an account keeps only the roles someone was reviewed in
// ---------------------------------------------------------------------------

describe("deleteAccount with roles", () => {
  async function closeAccount(): Promise<string | undefined> {
    try {
      await deleteAccount(form({ confirm: "delete" }));
      return undefined;
    } catch (error) {
      if (error instanceof RedirectSignal) return error.url;
      throw error;
    }
  }

  async function row(id: string) {
    const db = await getDb();
    const [found] = await db.select().from(users).where(eq(users.id, id));
    return found;
  }

  it("reviewed only as a renter: the closed profile keeps just the renter role", async () => {
    const user = await createUser("both");
    const landlord = await createUser("landlord");
    const managed = await insertProperty(user.id, user.id);
    await insertReview({ kind: "renter", authorId: landlord.id, subjectUserId: user.id });
    await logInAs(user);
    expect(await closeAccount()).toBe("/?account=deleted");

    expect(await row(user.id)).toMatchObject({ isLandlord: false, isRenter: true, deletedAt: expect.any(Date) });
    expect(await getPublicUser(user.id, "renter")).toMatchObject({ id: user.id });
    expect(await getPublicUser(user.id, "landlord")).toBeNull();
    expect((await listPeople({ role: "landlord", query: user.name })).total).toBe(0);
    expect(await landlordOf(managed)).toBeNull();
    expect(await hiddenReviewsAbout(user.id)).toEqual([]);
  });

  it("reviewed only as a landlord: keeps just the landlord role", async () => {
    const user = await createUser("both");
    const renter = await createUser("renter");
    await insertReview({ kind: "landlord", authorId: renter.id, subjectUserId: user.id });
    await logInAs(user);
    expect(await closeAccount()).toBe("/?account=deleted");
    expect(await row(user.id)).toMatchObject({ isLandlord: true, isRenter: false, deletedAt: expect.any(Date) });
    expect(await getPublicUser(user.id, "renter")).toBeNull();
    expect(await getRatingSummary({ userId: user.id, as: "landlord" })).toMatchObject({ count: 1 });
  });

  it("reviewed in both roles: keeps both", async () => {
    const user = await createUser("both");
    const renter = await createUser("renter");
    const landlord = await createUser("landlord");
    await insertReview({ kind: "landlord", authorId: renter.id, subjectUserId: user.id });
    await insertReview({ kind: "renter", authorId: landlord.id, subjectUserId: user.id });
    await logInAs(user);
    expect(await closeAccount()).toBe("/?account=deleted");
    expect(await row(user.id)).toMatchObject({ isLandlord: true, isRenter: true, deletedAt: expect.any(Date) });
  });

  it("a single-role account reviewed in that role keeps it", async () => {
    const user = await createUser("landlord");
    const renter = await createUser("renter");
    await insertReview({ kind: "landlord", authorId: renter.id, subjectUserId: user.id });
    await logInAs(user);
    await closeAccount();
    expect(await row(user.id)).toMatchObject({ isLandlord: true, isRenter: false });
  });

  it("only reviews they wrote, or reviews of their properties: deleted outright", async () => {
    const user = await createUser("both");
    const renter = await createUser("renter");
    const landlord = await createUser("landlord");
    const managed = await insertProperty(user.id, user.id);
    const propertyReview = await insertReview({ kind: "property", authorId: renter.id, propertyId: managed });
    await insertReview({ kind: "renter", authorId: user.id, subjectUserId: renter.id });
    await insertReview({ kind: "landlord", authorId: user.id, subjectUserId: landlord.id });
    await logInAs(user);
    expect(await closeAccount()).toBe("/?account=deleted");
    expect(await row(user.id)).toBeUndefined();
    expect(await landlordOf(managed)).toBeNull();
    expect(await reviewsBy(user.id)).toEqual([]);
    const db = await getDb();
    expect(await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.id, propertyReview))).toEqual([
      { id: propertyReview },
    ]);
  });

  it("a renter linking them as landlord while they close the account never links a closed account", async () => {
    for (let i = 0; i < 16; i++) {
      const user = await createUser("landlord");
      const renter = await createUser("renter");
      // Reviewed, so the account is kept as a closed profile.
      await insertReview({ kind: "landlord", authorId: (await createUser("renter")).id, subjectUserId: user.id });
      const address = `${unique()} Race Close St`;
      const [closed, added] = await atOnce(
        { cookies: await cookiesOf(user), run: () => closeAccount() },
        {
          cookies: await cookiesOf(renter),
          run: () =>
            outcome(
              createProperty(
                idleFormState,
                form({ address, unit: "", city: "Testville", region: "TS", postalCode: "", description: "", landlordId: user.id }),
              ),
            ),
        },
        i,
      );
      const detail = `run ${i}: close → ${closed}; add → ${JSON.stringify(added)}`;
      expect(closed, detail).toBe("/?account=deleted");
      const db = await getDb();
      const linked = await db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.landlordId, user.id));
      expect(linked, detail).toEqual([]);
    }
  }, 60_000);

  it("a review about them that arrives while they close the account is never left hidden", async () => {
    for (let i = 0; i < 8; i++) {
      const user = await createUser("both");
      const landlord = await createUser("landlord");
      const renter = await createUser("renter");
      // Reviewed as a renter already, so the account is kept (as a renter).
      await insertReview({ kind: "renter", authorId: landlord.id, subjectUserId: user.id });
      const [reviewed, closed] = await atOnce(
        { cookies: await cookiesOf(renter), run: () => review("landlord", user.id) },
        { cookies: await cookiesOf(user), run: () => closeAccount() },
        i,
      );
      const detail = `run ${i}: review → ${reviewed.message}; close → ${closed}`;
      expect(closed, detail).toBe("/?account=deleted");
      expect(await hiddenReviewsAbout(user.id), detail).toEqual([]);
      const after = await row(user.id);
      expect(after.deletedAt, detail).toBeInstanceOf(Date);
      expect(after.isLandlord, detail).toBe(reviewed.status === "success");
      expect(after.isRenter, detail).toBe(true);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// saveReview's transaction: double-submits and one review per role
// ---------------------------------------------------------------------------

describe("saveReview when a double-submit wins the race to insert", () => {
  // A statement-level trigger stands in for the other request: when the
  // action's first UPDATE finds no review, it inserts the queued one (as if a
  // concurrent submit had just committed it), so the action's INSERT then hits
  // the unique index (23505) and must fall back to updating that review.
  beforeAll(async () => {
    const db = await getDb();
    await db.execute(sql`drop trigger if exists test_race_review on reviews`);
    await db.execute(sql`create table if not exists test_race_review_queue (
      kind review_kind not null, author_id uuid not null, subject_user_id uuid, property_id uuid)`);
    await db.execute(sql`create or replace function test_race_review() returns trigger language plpgsql as $$
      declare queued record;
      begin
        for queued in delete from test_race_review_queue returning * loop
          insert into reviews (kind, author_id, subject_user_id, property_id, rating, title, body)
          values (queued.kind, queued.author_id, queued.subject_user_id, queued.property_id, 1,
                  'Raced in', 'The other submit of the same form got here first.');
        end loop;
        return null;
      end $$`);
    await db.execute(sql`create trigger test_race_review after update on reviews
      for each statement execute function test_race_review()`);
  });

  afterAll(async () => {
    const db = await getDb();
    await db.execute(sql`drop trigger if exists test_race_review on reviews`);
    await db.execute(sql`drop function if exists test_race_review()`);
    await db.execute(sql`drop table if exists test_race_review_queue`);
  });

  async function queueRace(values: { kind: ReviewKind; authorId: string; subjectUserId?: string; propertyId?: string }) {
    const db = await getDb();
    await db.execute(sql`insert into test_race_review_queue (kind, author_id, subject_user_id, property_id)
      values (${values.kind}, ${values.authorId}, ${values.subjectUserId ?? null}, ${values.propertyId ?? null})`);
  }

  async function queueLength(): Promise<number> {
    const db = await getDb();
    const result = await db.execute<{ n: number }>(sql`select count(*)::int as n from test_race_review_queue`);
    return (result as unknown as { rows: { n: number }[] }).rows[0].n;
  }

  it.each([["landlord" as const], ["renter" as const]])(
    "a person review (%s): keeps one review, with the text just submitted",
    async (kind) => {
      const subject = await createUser("both");
      const author = await createUser("both");
      await logInAs(author);
      await queueRace({ kind, authorId: author.id, subjectUserId: subject.id });
      const result = await review(kind, subject.id, { title: "Latest text", rating: 5 });
      expect(await queueLength()).toBe(0); // the race really happened
      expect(result).toEqual({
        status: "success",
        message: UPDATED,
        values: { rating: "5", title: "Latest text", body: "Long enough review text for the validation rules." },
      });
      const mine = await reviewsBy(author.id);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ kind, subjectUserId: subject.id, title: "Latest text" });
      expect(revalidatePath).toHaveBeenCalledWith(`/${kind}s/${subject.id}`);
    },
  );

  it("a property review: keeps one review, with the text just submitted", async () => {
    const author = await createUser("renter");
    const propertyId = await insertProperty(null, null);
    await logInAs(author);
    await queueRace({ kind: "property", authorId: author.id, propertyId });
    expect(await review("property", propertyId, { title: "Latest property text" })).toMatchObject({
      status: "success",
      message: UPDATED,
    });
    expect(await queueLength()).toBe(0);
    expect(await reviewsBy(author.id)).toEqual([
      expect.objectContaining({ kind: "property", propertyId, title: "Latest property text" }),
    ]);
  });

  it("the fallback edits only that role's review, not the one in the other role", async () => {
    const subject = await createUser("both");
    const author = await createUser("both");
    await logInAs(author);
    expect(await review("landlord", subject.id, { title: "As landlord" })).toMatchObject({ message: LIVE });
    await queueRace({ kind: "renter", authorId: author.id, subjectUserId: subject.id });
    expect(await review("renter", subject.id, { title: "As renter, latest" })).toMatchObject({ message: UPDATED });
    expect(await queueLength()).toBe(0);
    expect((await reviewsBy(author.id)).map((r) => [r.kind, r.title]).sort()).toEqual([
      ["landlord", "As landlord"],
      ["renter", "As renter, latest"],
    ]);
  });

  it("many submits of the same form at once still leave one review per role", async () => {
    const subject = await createUser("both");
    const author = await createUser("both");
    await logInAs(author);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        review(i % 2 === 0 ? "renter" : "landlord", subject.id, { title: `Submit ${i}` }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(6).fill("success"));
    // Exactly one "live" per role; the rest are edits.
    expect(results.filter((r) => r.message === LIVE)).toHaveLength(2);
    const mine = await reviewsBy(author.id);
    expect(mine.map((r) => r.kind).sort()).toEqual(["landlord", "renter"]);
  });
});
