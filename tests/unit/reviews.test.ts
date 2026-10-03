/**
 * Writing and deleting reviews (src/app/actions/reviews.ts, spec §5): who may
 * review whom, the kennitala a new review of a person needs (profile page) or
 * looks up (/reviews/new), profiles without an account created by a review and
 * tidied up when their last review goes, one review per author per person per
 * role, double-submits, rate limits, and the language of the messages.
 *
 * The races at the end only really race on a real Postgres (UNIT_DATABASE_URL;
 * see support/harness.ts); the embedded database runs one transaction at a time.
 */
import { describe, expect, it, vi, afterAll, beforeAll } from "vitest";
vi.mock("next/headers", async () => (await import("./support/next-mocks")).nextHeadersMock);
vi.mock("next/navigation", async () => (await import("./support/next-mocks")).nextNavigationMock);
vi.mock("next/cache", async () => (await import("./support/next-mocks")).nextCacheMock);
// Unchanged, but replaceable once per test: lets a test make the wizard's lookup
// see a profile that is gone by the time the review is written.
vi.mock("@/lib/people", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/people")>();
  return { ...actual, findPersonByKennitala: vi.fn(actual.findPersonByKennitala) };
});

import { eq, sql } from "drizzle-orm";
import { deleteReview, reviewWizard, saveReview, type WizardState } from "@/app/actions/reviews";
import { pgErrorCode } from "@/db";
import { properties, reviews, users, type ReviewKind } from "@/db/schema";
import { createFormat } from "@/i18n/format";
import { getRatingSummary, getReviewByAuthor, listPeople, listReviewsAbout, listReviewsByAuthor } from "@/lib/data";
import { idleFormState, type FormState } from "@/lib/form-state";
import { formatKennitala, parseKennitalaInput } from "@/lib/kennitala";
import { findPersonByKennitala } from "@/lib/people";
import {
  asVisitor,
  atOnce,
  attemptsFor,
  createUser,
  currentVisitor,
  form,
  freshKennitala,
  getDb,
  insertProperty,
  insertReview,
  logInAs,
  nextCacheMock,
  outcome,
  seedAttempts,
  unique,
  userRow,
  usingPostgres,
  type Roles,
  type TestUser,
} from "./support/harness";

// ---------------------------------------------------------------------------
// Messages (the harness's visitors read English)
// ---------------------------------------------------------------------------

const LIVE = "Thanks! Your review is live.";
const UPDATED = "Your review was updated.";
const LOG_IN = "Please log in to leave a review.";
const ONLY_RENTERS_LANDLORDS = "Only renters can review landlords.";
const ONLY_LANDLORDS_RENTERS = "Only landlords can review renters.";
const ONLY_RENTERS_PROPERTIES = "Only renters can review properties.";
const NOT_YOURSELF = "You can't review yourself.";
const NOT_YOUR_PROPERTY = "You can't review a property you manage.";
const MISMATCH =
  "That kennitala doesn't match this profile. Several people can share a name, so check you're on the right page.";
const OWN_KENNITALA = "That's your own kennitala.";
const MINOR = "We can't accept a review for this kennitala.";
const CONFIRM = "Tick the box to confirm the kennitala is right.";
const TRY_LATER = "Too many attempts. Please try again later.";
const FIX = "Please fix the highlighted fields.";
const INVALID_KENNITALA = "That isn't a valid kennitala. Enter 10 digits, e.g. 123456-7890.";
const NO_KENNITALA_IN_TEXT = "Don't include a kennitala here. ID numbers are never shown on GossipRent.";
const NAME_TOO_SHORT = "Name must be at least 2 characters.";
const PERSON_NAME_CHARS = "Use only letters, spaces, hyphens, apostrophes and periods in a name.";
const kennitalaRequired = (kind: "landlord" | "renter") => `Enter the ${kind}'s kennitala.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PersonKind = "landlord" | "renter";

/** Submit the review form of a profile or property page as the current visitor. */
function review(
  kind: ReviewKind,
  subjectId: string,
  fields: { kennitala?: string; rating?: number; title?: string; body?: string } = {},
): Promise<FormState> {
  return saveReview(
    idleFormState,
    form({
      kind,
      subjectId,
      subjectKennitala: fields.kennitala,
      rating: String(fields.rating ?? 4),
      title: fields.title ?? `Review ${unique()}`,
      body: fields.body ?? "Long enough review text for the validation rules.",
    }),
  );
}

/** A review from a person's page, giving their kennitala as a new review needs. */
function reviewPerson(
  kind: PersonKind,
  subject: TestUser,
  fields: { rating?: number; title?: string; body?: string } = {},
): Promise<FormState> {
  return review(kind, subject.id, { kennitala: subject.kennitala, ...fields });
}

type WizardOutcome = WizardState | { redirect: string; type?: "push" | "replace" };

const START: WizardState = { status: "idle", step: "kennitala" };

/** /reviews/new: "Continue" with a kennitala. */
function check(kind: PersonKind, kennitala: string): Promise<WizardOutcome> {
  return outcome(reviewWizard(START, form({ intent: "check", kind, subjectKennitala: kennitala })));
}

/** /reviews/new: "Post review". */
function wizardSave(
  kind: PersonKind,
  kennitala: string,
  fields: { name?: string; confirm?: boolean; rating?: number; title?: string; body?: string } = {},
): Promise<WizardOutcome> {
  return outcome(
    reviewWizard(
      START,
      form({
        intent: "save",
        kind,
        subjectKennitala: kennitala,
        subjectName: fields.name,
        confirmNew: fields.confirm ? "on" : undefined,
        rating: String(fields.rating ?? 4),
        title: fields.title ?? `Review ${unique()}`,
        body: fields.body ?? "Long enough review text for the validation rules.",
      }),
    ),
  );
}

/** The page the wizard sends the author to after posting. */
const savedPath = (kind: PersonKind, id: string) => `/${kind}s/${id}?saved=1#your-review`;

/** The id at the end of a wizard redirect ("/landlords/<id>?saved=1#your-review"). */
function redirectedId(result: WizardOutcome): string {
  if (!("redirect" in result)) throw new Error(`expected a redirect, got ${JSON.stringify(result)}`);
  return result.redirect.split("/")[2].split(/[?#]/)[0];
}

async function reviewsBy(authorId: string) {
  const db = await getDb();
  return db
    .select({
      kind: reviews.kind,
      subjectUserId: reviews.subjectUserId,
      propertyId: reviews.propertyId,
      title: reviews.title,
    })
    .from(reviews)
    .where(eq(reviews.authorId, authorId));
}

async function reviewsAbout(subjectId: string) {
  const db = await getDb();
  return db.select({ id: reviews.id, kind: reviews.kind }).from(reviews).where(eq(reviews.subjectUserId, subjectId));
}

/** Everyone stored with this kennitala (at most one row). */
async function rowsWithKennitala(kennitala: string) {
  const db = await getDb();
  return db
    .select({
      id: users.id,
      name: users.name,
      isLandlord: users.isLandlord,
      isRenter: users.isRenter,
      isCompany: users.isCompany,
      hasAccount: sql<boolean>`${users.passwordHash} is not null`,
    })
    .from(users)
    .where(eq(users.kennitala, kennitala));
}

/** Rate-limit keys for one author (spec §9). */
function keysOf(author: { id: string }) {
  return {
    checks: `kt:user15:${author.id}`,
    checksDaily: `kt:userday:${author.id}`,
    newReviews: `review-new:user:${author.id}`,
    newProfiles: `profile-new:user:${author.id}`,
  };
}

const ip = () => currentVisitor().ip!;

/** Read the rest of this test in Icelandic (no language cookie: the site's default). */
function speakIcelandic(): void {
  currentVisitor().cookies.delete("lang");
}

// ---------------------------------------------------------------------------
// Who may review whom
// ---------------------------------------------------------------------------

describe("saveReview permissions by role", () => {
  type Cast = { landlord: TestUser; renter: TestUser; both: TestUser; property: string };
  let cast: Cast;

  beforeAll(async () => {
    const landlord = await createUser({ roles: "landlord" });
    cast = {
      landlord,
      renter: await createUser({ roles: "renter" }),
      both: await createUser({ roles: "both" }),
      property: (await insertProperty({ landlordId: landlord.id, createdById: null })).id,
    };
  });

  /** [label, kind, subject] → expected message for each kind of author. */
  const cases: [string, ReviewKind, (c: Cast) => { id: string; kennitala?: string }, Record<Roles, string>][] = [
    ["a landlord", "landlord", (c) => c.landlord, { renter: LIVE, landlord: ONLY_RENTERS_LANDLORDS, both: LIVE }],
    ["a renter", "renter", (c) => c.renter, { renter: ONLY_LANDLORDS_RENTERS, landlord: LIVE, both: LIVE }],
    ["a property", "property", (c) => ({ id: c.property }), { renter: LIVE, landlord: ONLY_RENTERS_PROPERTIES, both: LIVE }],
    [
      "someone with both roles, as a landlord",
      "landlord",
      (c) => c.both,
      { renter: LIVE, landlord: ONLY_RENTERS_LANDLORDS, both: LIVE },
    ],
    [
      "someone with both roles, as a renter",
      "renter",
      (c) => c.both,
      { renter: ONLY_LANDLORDS_RENTERS, landlord: LIVE, both: LIVE },
    ],
  ];

  for (const author of ["renter", "landlord", "both"] as const) {
    for (const [label, kind, subjectOf, expected] of cases) {
      it(`a ${author === "both" ? "renter-and-landlord" : `${author}-only user`} reviewing ${label}: ${expected[author]}`, async () => {
        const user = await createUser({ roles: author });
        await logInAs(user);
        const subject = subjectOf(cast);
        const result = await review(kind, subject.id, { kennitala: subject.kennitala });
        if (expected[author] === LIVE) {
          expect(result).toEqual({ status: "success", message: LIVE });
          expect(await reviewsBy(user.id)).toHaveLength(1);
        } else {
          expect(result).toMatchObject({ status: "error", message: expected[author] });
          expect(await reviewsBy(user.id)).toEqual([]);
        }
      });
    }
  }

  it("nobody can review themselves, in either role", async () => {
    for (const roles of ["renter", "landlord", "both"] as const) {
      const user = await createUser({ roles });
      await logInAs(user);
      for (const kind of ["landlord", "renter"] as const) {
        const result = await review(kind, user.id, { kennitala: user.kennitala });
        expect(result.status, `${roles} reviewing themselves as a ${kind}`).toBe("error");
        // Someone with the right role to write it is told why.
        if (roles === "both") expect(result.message).toBe(NOT_YOURSELF);
      }
      expect(await reviewsBy(user.id)).toEqual([]);
    }
  });

  it("the database also refuses a self-review", async () => {
    const user = await createUser({ roles: "both" });
    const error = await insertReview({ kind: "landlord", authorId: user.id, subjectUserId: user.id }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(pgErrorCode(error)).toBe("23514");
  });

  it("can't review a property you manage, whoever added it", async () => {
    const user = await createUser({ roles: "both" });
    const renter = await createUser({ roles: "renter" });
    const listedByMe = await insertProperty({ landlordId: user.id, createdById: user.id });
    const linkedByRenter = await insertProperty({ landlordId: user.id, createdById: renter.id });
    await logInAs(user);
    expect(await review("property", listedByMe.id)).toMatchObject({ status: "error", message: NOT_YOUR_PROPERTY });
    expect(await review("property", linkedByRenter.id)).toMatchObject({ status: "error", message: NOT_YOUR_PROPERTY });
    expect(await reviewsBy(user.id)).toEqual([]);
    // A property you added as a renter (someone else manages it) is fine.
    const placeIRent = await insertProperty({ landlordId: cast.landlord.id, createdById: user.id });
    expect(await review("property", placeIRent.id)).toMatchObject({ status: "success" });
    // So is one with no landlord yet.
    const unmanaged = await insertProperty({ landlordId: null, createdById: user.id });
    expect(await review("property", unmanaged.id)).toMatchObject({ status: "success" });
  });

  it("once you no longer manage a property you may review it as a renter", async () => {
    const user = await createUser({ roles: "both" });
    const property = await insertProperty({ landlordId: user.id, createdById: user.id });
    await logInAs(user);
    expect(await review("property", property.id)).toMatchObject({ message: NOT_YOUR_PROPERTY });
    const db = await getDb();
    await db.update(properties).set({ landlordId: null }).where(eq(properties.id, property.id));
    expect(await review("property", property.id)).toMatchObject({ status: "success", message: LIVE });
  });

  it("a property review never needs (or uses) a kennitala", async () => {
    const renter = await createUser({ roles: "renter" });
    const property = await insertProperty({ landlordId: null, createdById: null });
    await logInAs(renter);
    expect(await review("property", property.id, { kennitala: freshKennitala() })).toEqual({
      status: "success",
      message: LIVE,
    });
    expect(await attemptsFor(keysOf(renter).checks)).toBe(0);
  });

  it("reviewing someone in a role they don't have yet gives them that role", async () => {
    const renterOnly = await createUser({ roles: "renter" });
    const landlordOnly = await createUser({ roles: "landlord", account: false });
    const reviewer = await createUser({ roles: "both" });
    await logInAs(reviewer);
    expect(await reviewPerson("landlord", renterOnly)).toEqual({ status: "success", message: LIVE });
    expect(await userRow(renterOnly.id)).toMatchObject({ isLandlord: true, isRenter: true });
    expect(await reviewPerson("renter", landlordOnly)).toEqual({ status: "success", message: LIVE });
    expect(await userRow(landlordOnly.id)).toMatchObject({ isLandlord: true, isRenter: true });
  });

  it("a page that no longer exists says so", async () => {
    const reviewer = await createUser({ roles: "both" });
    await logInAs(reviewer);
    const gone = crypto.randomUUID();
    expect(await review("landlord", gone, { kennitala: freshKennitala() })).toMatchObject({
      status: "error",
      message: "That landlord no longer exists.",
    });
    expect(await review("renter", gone, { kennitala: freshKennitala() })).toMatchObject({
      message: "That renter no longer exists.",
    });
    expect(await review("property", gone)).toMatchObject({ message: "That property no longer exists." });
    expect(await reviewsBy(reviewer.id)).toEqual([]);
    // Nothing about a kennitala was learned, so nothing counts.
    expect(await attemptsFor(keysOf(reviewer).checks)).toBe(0);
    expect(await attemptsFor(keysOf(reviewer).newReviews)).toBe(0);
  });

  it("signed-out visitors can't review", async () => {
    expect(await reviewPerson("landlord", cast.both)).toEqual({ status: "error", message: LOG_IN });
  });

  it("validates the rating, title and text, and never accepts a kennitala in them", async () => {
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    const kennitala = formatKennitala(freshKennitala());
    expect(
      await review("landlord", cast.landlord.id, { kennitala: cast.landlord.kennitala, rating: 0, title: "x" }),
    ).toMatchObject({
      status: "error",
      message: FIX,
      fieldErrors: { rating: ["Pick a star rating from 1 to 5."], title: ["Title must be at least 3 characters."] },
    });
    expect(
      await reviewPerson("landlord", cast.landlord, { body: `Ask them about ${kennitala}, it was a long story.` }),
    ).toMatchObject({ status: "error", fieldErrors: { body: [NO_KENNITALA_IN_TEXT] } });
    expect(await reviewPerson("landlord", cast.landlord, { title: `About ${kennitala}` })).toMatchObject({
      status: "error",
      fieldErrors: { title: [NO_KENNITALA_IN_TEXT] },
    });
    expect(await reviewsBy(renter.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The profile page: a new review needs the profile's kennitala
// ---------------------------------------------------------------------------

describe("saveReview on a profile page", () => {
  it("a new review with the profile's kennitala is posted, and the check isn't counted", async () => {
    const landlord = await createUser({ roles: "landlord", account: false });
    const renter = await createUser({ roles: "renter" });
    const visitor = await logInAs(renter);
    // However it was typed.
    const typed = `${landlord.kennitala.slice(0, 6)} - ${landlord.kennitala.slice(6)}`;
    expect(await review("landlord", landlord.id, { kennitala: typed })).toEqual({ status: "success", message: LIVE });
    expect(await reviewsBy(renter.id)).toEqual([
      expect.objectContaining({ kind: "landlord", subjectUserId: landlord.id }),
    ]);
    const keys = keysOf(renter);
    expect(await attemptsFor(keys.checks)).toBe(0);
    expect(await attemptsFor(keys.checksDaily)).toBe(0);
    expect(await attemptsFor(`kt:ip:${visitor.ip}`)).toBe(0);
    expect(await attemptsFor(`kt:subject:${landlord.id}`)).toBe(0);
    expect(await attemptsFor(keys.newReviews)).toBe(1);
    expect(nextCacheMock.revalidatePath).toHaveBeenCalledWith(`/landlords/${landlord.id}`);
  });

  it("a new review without a kennitala is refused, even from a tampered form", async () => {
    const landlord = await createUser({ roles: "landlord" });
    const renter = await createUser({ roles: "renter" });
    const author = await createUser({ roles: "both" });
    await logInAs(author);
    expect(await review("landlord", landlord.id)).toMatchObject({
      status: "error",
      message: FIX,
      fieldErrors: { subjectKennitala: [kennitalaRequired("landlord")] },
    });
    expect(await review("renter", renter.id)).toMatchObject({
      fieldErrors: { subjectKennitala: [kennitalaRequired("renter")] },
    });
    expect(await reviewsBy(author.id)).toEqual([]);
    expect(await attemptsFor(keysOf(author).newReviews)).toBe(0);
  });

  it("refuses an invalid kennitala before anything else", async () => {
    const landlord = await createUser({ roles: "landlord" });
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    expect(await review("landlord", landlord.id, { kennitala: "123456-7890" })).toMatchObject({
      status: "error",
      fieldErrors: { subjectKennitala: [INVALID_KENNITALA] },
    });
    expect(await attemptsFor(keysOf(renter).checks)).toBe(0);
  });

  it("someone else's kennitala and an unknown one get the same answer, write nothing, and count", async () => {
    const landlord = await createUser({ roles: "landlord", account: false });
    const someoneElse = await createUser({ roles: "renter" });
    const nobody = freshKennitala();
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);

    const wrong = await review("landlord", landlord.id, { kennitala: someoneElse.kennitala, title: "Kept text" });
    const unknown = await review("landlord", landlord.id, { kennitala: nobody });
    for (const result of [wrong, unknown]) {
      expect(result).toMatchObject({ status: "error", message: FIX, fieldErrors: { subjectKennitala: [MISMATCH] } });
      // Never the profile's kennitala; only what the author typed comes back.
      expect(JSON.stringify(result)).not.toContain(landlord.kennitala);
    }
    expect(Object.keys(wrong)).toEqual(Object.keys(unknown));
    // What was typed comes back so the author can fix it.
    expect((wrong as FormState).values).toMatchObject({ title: "Kept text", subjectKennitala: someoneElse.kennitala });

    expect(await reviewsBy(renter.id)).toEqual([]);
    expect(await rowsWithKennitala(nobody)).toEqual([]);
    expect(await userRow(someoneElse.id)).toMatchObject({ isLandlord: false, isRenter: true });
    expect(await userRow(landlord.id)).toMatchObject({ isLandlord: true, isRenter: false });
    // Both mismatches count, per author and against the profile; no new review does.
    expect(await attemptsFor(keysOf(renter).checks)).toBe(2);
    expect(await attemptsFor(keysOf(renter).checksDaily)).toBe(2);
    expect(await attemptsFor(`kt:subject:${landlord.id}`)).toBe(2);
    expect(await attemptsFor(keysOf(renter).newReviews)).toBe(0);

    // The right number still works, and releases its own check.
    expect(await reviewPerson("landlord", landlord)).toEqual({ status: "success", message: LIVE });
    expect(await attemptsFor(keysOf(renter).checks)).toBe(2);
  });

  it("an edit needs no kennitala, and a wrong one sent with it is ignored", async () => {
    const landlord = await createUser({ roles: "landlord" });
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    expect(await reviewPerson("landlord", landlord, { title: "First" })).toMatchObject({ message: LIVE });
    expect(await review("landlord", landlord.id, { title: "Second" })).toEqual({ status: "success", message: UPDATED });
    expect(await review("landlord", landlord.id, { title: "Third", kennitala: freshKennitala() })).toEqual({
      status: "success",
      message: UPDATED,
    });
    expect((await reviewsBy(renter.id)).map((r) => r.title)).toEqual(["Third"]);
    expect(await attemptsFor(keysOf(renter).checks)).toBe(0);
    expect(await attemptsFor(keysOf(renter).newReviews)).toBe(1);
  });

  it("refuses your own kennitala on someone else's page", async () => {
    const landlord = await createUser({ roles: "landlord" });
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    expect(await review("landlord", landlord.id, { kennitala: renter.kennitala })).toMatchObject({
      status: "error",
      message: FIX,
      fieldErrors: { subjectKennitala: [OWN_KENNITALA] },
    });
    expect(await reviewsBy(renter.id)).toEqual([]);
    expect(await attemptsFor(keysOf(renter).checks)).toBe(0);
  });

  it("refuses a minor's kennitala with a neutral message", async () => {
    const minor = await createUser({ roles: "renter", account: false, kennitala: freshKennitala("minor") });
    const landlord = await createUser({ roles: "landlord" });
    await logInAs(landlord);
    expect(await reviewPerson("renter", minor)).toMatchObject({
      status: "error",
      fieldErrors: { subjectKennitala: [MINOR] },
    });
    expect(await reviewsAbout(minor.id)).toEqual([]);
  });

  describe("rate limits", () => {
    it("too many kennitala checks by one author: refused before looking", async () => {
      const landlord = await createUser({ roles: "landlord" });
      const renter = await createUser({ roles: "renter" });
      await logInAs(renter);
      await seedAttempts(keysOf(renter).checks, 10);
      expect(await reviewPerson("landlord", landlord)).toMatchObject({ status: "error", message: TRY_LATER });
      expect(await reviewsBy(renter.id)).toEqual([]);
      expect(await userRow(landlord.id)).toMatchObject({ isLandlord: true });
      // The refused attempt isn't counted, and nor is the review it would have been.
      expect(await attemptsFor(keysOf(renter).checks)).toBe(10);
      expect(await attemptsFor(keysOf(renter).newReviews)).toBe(0);
    });

    it("the daily and per-network limits apply too", async () => {
      const landlord = await createUser({ roles: "landlord" });
      const renter = await createUser({ roles: "renter" });
      await logInAs(renter);
      await seedAttempts(keysOf(renter).checksDaily, 50);
      expect(await reviewPerson("landlord", landlord)).toMatchObject({ message: TRY_LATER });

      const other = await createUser({ roles: "renter" });
      await logInAs(other);
      await seedAttempts(`kt:ip:${ip()}`, 100);
      expect(await reviewPerson("landlord", landlord)).toMatchObject({ message: TRY_LATER });
      expect(await reviewsAbout(landlord.id)).toEqual([]);
    });

    it("too many wrong numbers on one profile, from anyone, stop all checks on it", async () => {
      const landlord = await createUser({ roles: "landlord", account: false });
      const renter = await createUser({ roles: "renter" });
      await logInAs(renter);
      await seedAttempts(`kt:subject:${landlord.id}`, 20);
      // Even the right number: the profile is being guessed at.
      expect(await reviewPerson("landlord", landlord)).toMatchObject({ message: TRY_LATER });
      expect(await reviewsAbout(landlord.id)).toEqual([]);
      // Other profiles are unaffected.
      const other = await createUser({ roles: "landlord" });
      expect(await reviewPerson("landlord", other)).toMatchObject({ message: LIVE });
    });

    it("too many new reviews in a day: refused, but editing still works", async () => {
      const landlord = await createUser({ roles: "landlord" });
      const another = await createUser({ roles: "landlord" });
      const renter = await createUser({ roles: "renter" });
      await logInAs(renter);
      expect(await reviewPerson("landlord", landlord)).toMatchObject({ message: LIVE });
      await seedAttempts(keysOf(renter).newReviews, 20);
      expect(await reviewPerson("landlord", another)).toMatchObject({ message: TRY_LATER });
      expect(await review("landlord", landlord.id, { title: "Still editable" })).toMatchObject({ message: UPDATED });
      expect(await attemptsFor(keysOf(renter).checks)).toBe(0);
    });

    it("are switched off by AUTH_RATE_LIMIT=off", async () => {
      vi.stubEnv("AUTH_RATE_LIMIT", "off");
      const landlord = await createUser({ roles: "landlord" });
      const renter = await createUser({ roles: "renter" });
      await logInAs(renter);
      await seedAttempts(keysOf(renter).checks, 10);
      expect(await reviewPerson("landlord", landlord)).toMatchObject({ message: LIVE });
    });
  });

  it("answers in Icelandic by default", async () => {
    const landlord = await createUser({ roles: "landlord" });
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    speakIcelandic();
    expect(await review("landlord", landlord.id, { kennitala: freshKennitala() })).toMatchObject({
      message: "Lagaðu merktu reitina.",
      fieldErrors: {
        subjectKennitala: [
          "Kennitalan passar ekki við þessa síðu. Nöfn eru ekki einstök, svo athugaðu hvort þú sért á réttri síðu.",
        ],
      },
    });
    expect(await reviewPerson("landlord", landlord)).toEqual({
      status: "success",
      message: "Takk! Umsögnin þín er komin á vefinn.",
    });
    expect(await review("landlord", landlord.id)).toEqual({ status: "success", message: "Umsögnin þín var uppfærð." });
    expect(await review("renter", landlord.id)).toMatchObject({
      message: "Aðeins leigusalar geta skrifað umsagnir um leigjendur.",
    });
  });
});

// ---------------------------------------------------------------------------
// One review per author per person per role
// ---------------------------------------------------------------------------

describe("reviewing someone with both roles", () => {
  it("the same author reviews them once as a landlord and once as a renter; writing again edits", async () => {
    const subject = await createUser({ roles: "both" });
    const author = await createUser({ roles: "both" });
    await logInAs(author);

    expect(await reviewPerson("landlord", subject, { title: "As landlord" })).toMatchObject({ message: LIVE });
    expect(await reviewPerson("renter", subject, { title: "As renter" })).toMatchObject({ message: LIVE });
    expect((await reviewsBy(author.id)).map((r) => [r.kind, r.title]).sort()).toEqual([
      ["landlord", "As landlord"],
      ["renter", "As renter"],
    ]);

    // Writing again in one role edits that review only (no kennitala needed).
    expect(await review("landlord", subject.id, { title: "As landlord, edited" })).toEqual({
      status: "success",
      message: UPDATED,
    });
    expect((await reviewsBy(author.id)).map((r) => [r.kind, r.title]).sort()).toEqual([
      ["landlord", "As landlord, edited"],
      ["renter", "As renter"],
    ]);
    expect(await review("renter", subject.id, { title: "As renter, edited" })).toMatchObject({ message: UPDATED });

    // Each role's form finds its own review.
    expect((await getReviewByAuthor(author.id, { userId: subject.id, as: "landlord" }))?.title).toBe(
      "As landlord, edited",
    );
    expect((await getReviewByAuthor(author.id, { userId: subject.id, as: "renter" }))?.title).toBe(
      "As renter, edited",
    );
  });

  it("a double-submit in one role still leaves one review for that role", async () => {
    const subject = await createUser({ roles: "both" });
    const author = await createUser({ roles: "both" });
    await logInAs(author);
    const results = await Promise.all([
      reviewPerson("renter", subject, { title: "First" }),
      reviewPerson("renter", subject, { title: "Second" }),
      reviewPerson("landlord", subject, { title: "Third" }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["success", "success", "success"]);
    const mine = await reviewsBy(author.id);
    expect(mine.filter((r) => r.kind === "renter")).toHaveLength(1);
    expect(mine.filter((r) => r.kind === "landlord")).toHaveLength(1);
  });

  it("many submits of the same form at once still leave one review per role", async () => {
    const subject = await createUser({ roles: "both" });
    const author = await createUser({ roles: "both" });
    await logInAs(author);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        reviewPerson(i % 2 === 0 ? "renter" : "landlord", subject, { title: `Submit ${i}` }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(6).fill("success"));
    // Exactly one "live" per role; the rest are edits, and only those two count as new.
    expect(results.filter((r) => r.message === LIVE)).toHaveLength(2);
    expect((await reviewsBy(author.id)).map((r) => r.kind).sort()).toEqual(["landlord", "renter"]);
    expect(await attemptsFor(keysOf(author).newReviews)).toBe(2);
  });

  it("the database allows one review per author, person, and role", async () => {
    const subject = await createUser({ roles: "both" });
    const author = await createUser({ roles: "both" });
    await insertReview({ kind: "landlord", authorId: author.id, subjectUserId: subject.id });
    await insertReview({ kind: "renter", authorId: author.id, subjectUserId: subject.id });
    const duplicate = await insertReview({ kind: "renter", authorId: author.id, subjectUserId: subject.id }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(pgErrorCode(duplicate)).toBe("23505");
    // A different author is fine.
    const other = await createUser({ roles: "landlord" });
    await insertReview({ kind: "renter", authorId: other.id, subjectUserId: subject.id });
  });

  it("deleting one role's review leaves the other", async () => {
    const subject = await createUser({ roles: "both" });
    const author = await createUser({ roles: "both" });
    await logInAs(author);
    await reviewPerson("landlord", subject);
    await reviewPerson("renter", subject);
    const landlordReview = await getReviewByAuthor(author.id, { userId: subject.id, as: "landlord" });
    expect(await outcome(deleteReview(form({ reviewId: landlordReview!.id })))).toBeUndefined();
    expect((await reviewsBy(author.id)).map((r) => r.kind)).toEqual(["renter"]);
  });
});

// ---------------------------------------------------------------------------
// Ratings are kept separately for each role
// ---------------------------------------------------------------------------

describe("per-role ratings", () => {
  let subject: TestUser;
  let landlordA: TestUser;

  beforeAll(async () => {
    subject = await createUser({ roles: "both" });
    const renterA = await createUser({ roles: "renter" });
    const renterB = await createUser({ roles: "renter" });
    landlordA = await createUser({ roles: "landlord" });
    // As a landlord: 5 and 4 stars. As a renter: 1 star.
    await insertReview({ kind: "landlord", authorId: renterA.id, subjectUserId: subject.id, rating: 5 });
    await insertReview({ kind: "landlord", authorId: renterB.id, subjectUserId: subject.id, rating: 4 });
    await insertReview({ kind: "renter", authorId: landlordA.id, subjectUserId: subject.id, rating: 1 });
    // Reviews of their property don't count toward either personal rating.
    const managed = await insertProperty({ landlordId: subject.id, createdById: subject.id });
    await insertReview({ kind: "property", authorId: renterA.id, propertyId: managed.id, rating: 2 });
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
      expect(item.author.role).toBe("renter");
      expect(item.subject).toMatchObject({ kind: "landlord", id: subject.id, name: subject.name });
    }
    const asRenter = await listReviewsAbout({ userId: subject.id, as: "renter" });
    expect(asRenter.total).toBe(1);
    expect(asRenter.items[0]).toMatchObject({
      rating: 1,
      author: { id: landlordA.id, role: "landlord", isLandlord: true, isRenter: false },
      subject: { kind: "renter", id: subject.id },
    });
  });

  it("a review's author role is the role they wrote it in, even when they have both", async () => {
    const author = await createUser({ roles: "both" });
    const someone = await createUser({ roles: "both" });
    await insertReview({ kind: "renter", authorId: author.id, subjectUserId: someone.id });
    await insertReview({ kind: "landlord", authorId: author.id, subjectUserId: someone.id });
    const { items } = await listReviewsByAuthor(author.id, 10);
    expect(items.map((r) => [r.subject.kind, r.author.role]).sort()).toEqual([
      ["landlord", "renter"],
      ["renter", "landlord"],
    ]);
  });

  it("the directories show each role's own rating and count", async () => {
    const [asLandlord] = (await listPeople({ role: "landlord", query: subject.name })).items;
    expect(asLandlord).toMatchObject({ id: subject.id, average: 4.5, reviewCount: 2, propertyCount: 1 });
    const [asRenter] = (await listPeople({ role: "renter", query: subject.name })).items;
    expect(asRenter).toMatchObject({ id: subject.id, average: 1, reviewCount: 1 });
  });

  it("a review in one role doesn't change the other role's rating", async () => {
    const person = await createUser({ roles: "both" });
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    await reviewPerson("landlord", person, { rating: 2 });
    expect(await getRatingSummary({ userId: person.id, as: "renter" })).toEqual({
      average: null,
      count: 0,
      distribution: [0, 0, 0, 0, 0],
    });
    expect((await getRatingSummary({ userId: person.id, as: "landlord" })).average).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Double-submits that win the race to insert
// ---------------------------------------------------------------------------

// A statement-level trigger stands in for the other request: when the action's
// first UPDATE finds no review, it inserts the queued one (as if a concurrent
// submit had just committed it), so the action's INSERT then hits the unique
// index (23505) and must fall back to updating that review. Embedded database
// only: on the Postgres every test file shares, other files' updates would fire it.
describe.skipIf(usingPostgres)("saveReview when a double-submit wins the race to insert", () => {
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
      const subject = await createUser({ roles: "both" });
      const author = await createUser({ roles: "both" });
      await logInAs(author);
      await queueRace({ kind, authorId: author.id, subjectUserId: subject.id });
      const result = await reviewPerson(kind, subject, { title: "Latest text", rating: 5 });
      expect(await queueLength()).toBe(0); // the race really happened
      expect(result).toEqual({ status: "success", message: UPDATED });
      const mine = await reviewsBy(author.id);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ kind, subjectUserId: subject.id, title: "Latest text" });
      expect(nextCacheMock.revalidatePath).toHaveBeenCalledWith(`/${kind}s/${subject.id}`);
    },
  );

  it("a property review: keeps one review, with the text just submitted", async () => {
    const author = await createUser({ roles: "renter" });
    const property = await insertProperty({ landlordId: null, createdById: null });
    await logInAs(author);
    await queueRace({ kind: "property", authorId: author.id, propertyId: property.id });
    expect(await review("property", property.id, { title: "Latest property text" })).toEqual({
      status: "success",
      message: UPDATED,
    });
    expect(await queueLength()).toBe(0);
    expect(await reviewsBy(author.id)).toEqual([
      expect.objectContaining({ kind: "property", propertyId: property.id, title: "Latest property text" }),
    ]);
  });

  it("the fallback edits only that role's review, not the one in the other role", async () => {
    const subject = await createUser({ roles: "both" });
    const author = await createUser({ roles: "both" });
    await logInAs(author);
    expect(await reviewPerson("landlord", subject, { title: "As landlord" })).toMatchObject({ message: LIVE });
    await queueRace({ kind: "renter", authorId: author.id, subjectUserId: subject.id });
    expect(await reviewPerson("renter", subject, { title: "As renter, latest" })).toMatchObject({ message: UPDATED });
    expect(await queueLength()).toBe(0);
    expect((await reviewsBy(author.id)).map((r) => [r.kind, r.title]).sort()).toEqual([
      ["landlord", "As landlord"],
      ["renter", "As renter, latest"],
    ]);
  });

  it("a wizard review: keeps one review", async () => {
    const subject = await createUser({ roles: "landlord", account: false });
    const author = await createUser({ roles: "renter" });
    await logInAs(author);
    await queueRace({ kind: "landlord", authorId: author.id, subjectUserId: subject.id });
    expect(await wizardSave("landlord", subject.kennitala, { title: "Wizard text" })).toEqual({
      redirect: savedPath("landlord", subject.id),
    });
    expect(await queueLength()).toBe(0);
    expect(await reviewsBy(author.id)).toEqual([expect.objectContaining({ title: "Wizard text" })]);
  });
});

// ---------------------------------------------------------------------------
// /reviews/new
// ---------------------------------------------------------------------------

describe("reviewWizard: checking a kennitala", () => {
  it("found: shows whose it is (an account)", async () => {
    const landlord = await createUser({ roles: "landlord", name: "Sigrún Prófun" });
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    const formatted = formatKennitala(landlord.kennitala);
    expect(await check("landlord", landlord.kennitala)).toEqual({
      status: "idle",
      step: "review",
      subject: {
        id: landlord.id,
        name: "Sigrún Prófun",
        hasAccount: true,
        isCompany: false,
        formattedKennitala: formatted,
        birthDate: createFormat("en").date(parseKennitalaInput(landlord.kennitala)!.birthDate!),
      },
      values: { kind: "landlord", subjectKennitala: formatted },
    });
    // Every lookup counts, found or not.
    expect(await attemptsFor(keysOf(renter).checks)).toBe(1);
    expect(await attemptsFor(`kt:ip:${ip()}`)).toBe(1);
    // A check writes nothing.
    expect(await reviewsBy(renter.id)).toEqual([]);
  });

  it("found: a profile without an account, in a role it doesn't have yet", async () => {
    const renterProfile = await createUser({ roles: "renter", account: false });
    const author = await createUser({ roles: "both" });
    await logInAs(author);
    expect(await check("landlord", renterProfile.kennitala)).toMatchObject({
      step: "review",
      subject: { id: renterProfile.id, name: renterProfile.name, hasAccount: false },
    });
    expect(await userRow(renterProfile.id)).toMatchObject({ isLandlord: false });
  });

  it("not found: a person, with their birth date, or a company", async () => {
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    const person = freshKennitala();
    expect(await check("landlord", person)).toEqual({
      status: "idle",
      step: "review",
      subject: {
        id: null,
        name: null,
        hasAccount: false,
        isCompany: false,
        formattedKennitala: formatKennitala(person),
        birthDate: createFormat("en").date(parseKennitalaInput(person)!.birthDate!),
      },
      values: { kind: "landlord", subjectKennitala: formatKennitala(person) },
    });
    const company = freshKennitala("company");
    expect(await check("landlord", company)).toMatchObject({
      step: "review",
      subject: { id: null, isCompany: true, birthDate: null },
    });
    expect(await rowsWithKennitala(person)).toEqual([]);
    expect(await attemptsFor(keysOf(renter).checks)).toBe(2);
  });

  it("already reviewed in that role: goes to the review on their page", async () => {
    const landlord = await createUser({ roles: "both" });
    const author = await createUser({ roles: "both" });
    await logInAs(author);
    await reviewPerson("landlord", landlord);
    expect(await check("landlord", landlord.kennitala)).toEqual({ redirect: `/landlords/${landlord.id}#your-review` });
    // Not in the other role.
    expect(await check("renter", landlord.kennitala)).toMatchObject({ step: "review" });
  });

  it("refuses an invalid kennitala, your own, and a minor's, without counting a lookup", async () => {
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    expect(await check("landlord", "12345")).toMatchObject({
      status: "error",
      step: "kennitala",
      fieldErrors: { subjectKennitala: [INVALID_KENNITALA] },
    });
    expect(await check("landlord", renter.kennitala)).toMatchObject({
      status: "error",
      step: "kennitala",
      message: FIX,
      fieldErrors: { subjectKennitala: [OWN_KENNITALA] },
    });
    expect(await check("landlord", freshKennitala("minor"))).toMatchObject({
      step: "kennitala",
      fieldErrors: { subjectKennitala: [MINOR] },
    });
    expect(await attemptsFor(keysOf(renter).checks)).toBe(0);
  });

  it("only offers the roles the author may review", async () => {
    const landlord = await createUser({ roles: "landlord" });
    await logInAs(landlord);
    expect(await check("landlord", freshKennitala())).toMatchObject({
      status: "error",
      step: "kennitala",
      message: ONLY_RENTERS_LANDLORDS,
    });
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    expect(await check("renter", freshKennitala())).toMatchObject({ step: "kennitala", message: ONLY_LANDLORDS_RENTERS });
    // A missing or made-up kind is shown in the banner (it's a hidden field).
    expect(
      await outcome(reviewWizard(START, form({ intent: "check", kind: "property", subjectKennitala: freshKennitala() }))),
    ).toMatchObject({ step: "kennitala", message: "Choose whether you're reviewing a landlord or a renter." });
  });

  it("needs a logged-in author", async () => {
    expect(await check("landlord", freshKennitala())).toEqual({
      status: "error",
      step: "kennitala",
      message: LOG_IN,
    });
  });

  it("is rate limited", async () => {
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    await seedAttempts(keysOf(renter).checks, 10);
    expect(await check("landlord", freshKennitala())).toMatchObject({
      status: "error",
      step: "kennitala",
      message: TRY_LATER,
    });
    expect(await attemptsFor(keysOf(renter).checks)).toBe(10);
  });
});

describe("reviewWizard: posting", () => {
  it("creates a profile without an account, named as typed, and goes to it", async () => {
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    const kennitala = freshKennitala();
    const result = await wizardSave("landlord", formatKennitala(kennitala), {
      name: "  Gunnar   Már Prófun ",
      confirm: true,
      title: "Fair landlord",
    });
    const [profile] = await rowsWithKennitala(kennitala);
    expect(profile).toEqual({
      id: expect.any(String),
      name: "Gunnar Már Prófun",
      isLandlord: true,
      isRenter: false,
      isCompany: false,
      hasAccount: false,
    });
    expect(result).toEqual({ redirect: savedPath("landlord", profile.id) });
    expect(await reviewsBy(renter.id)).toEqual([
      expect.objectContaining({ kind: "landlord", subjectUserId: profile.id, title: "Fair landlord" }),
    ]);
    const keys = keysOf(renter);
    expect(await attemptsFor(keys.checks)).toBe(1);
    expect(await attemptsFor(keys.newProfiles)).toBe(1);
    expect(await attemptsFor(keys.newReviews)).toBe(1);
    expect(nextCacheMock.revalidatePath).toHaveBeenCalledWith(`/landlords/${profile.id}`);
  });

  it("a company kennitala makes a company profile, whose name may have digits and &", async () => {
    const landlord = await createUser({ roles: "landlord" });
    await logInAs(landlord);
    const kennitala = freshKennitala("company");
    const result = await wizardSave("renter", kennitala, { name: "Hús 3 & synir ehf.", confirm: true });
    const [profile] = await rowsWithKennitala(kennitala);
    expect(profile).toMatchObject({ name: "Hús 3 & synir ehf.", isCompany: true, isRenter: true, isLandlord: false });
    expect(result).toEqual({ redirect: savedPath("renter", profile.id) });
  });

  it("a person's name follows the rules for people", async () => {
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    const kennitala = freshKennitala();
    expect(await wizardSave("landlord", kennitala, { name: "Hús 3 & synir", confirm: true })).toMatchObject({
      status: "error",
      step: "review",
      message: FIX,
      fieldErrors: { subjectName: [PERSON_NAME_CHARS] },
      subject: { id: null, formattedKennitala: formatKennitala(kennitala) },
    });
    expect(await rowsWithKennitala(kennitala)).toEqual([]);
  });

  it("a new kennitala needs a name and the confirmation; nothing is created without them", async () => {
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    const kennitala = freshKennitala();
    expect(await wizardSave("landlord", kennitala, { confirm: true, title: "Kept" })).toMatchObject({
      status: "error",
      step: "review",
      fieldErrors: { subjectName: [NAME_TOO_SHORT] },
      subject: { id: null },
      values: { title: "Kept", confirmNew: "on" },
    });
    expect(await wizardSave("landlord", kennitala, { name: "Jóna Prófun" })).toMatchObject({
      status: "error",
      step: "review",
      fieldErrors: { confirmNew: [CONFIRM] },
      values: { subjectName: "Jóna Prófun" },
    });
    expect(await rowsWithKennitala(kennitala)).toEqual([]);
    expect(await reviewsBy(renter.id)).toEqual([]);
    expect(await attemptsFor(keysOf(renter).newProfiles)).toBe(0);
    expect(await attemptsFor(keysOf(renter).newReviews)).toBe(0);
  });

  it("stays on the review step with the subject when the review itself is invalid", async () => {
    const landlord = await createUser({ roles: "landlord", account: false });
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    expect(await wizardSave("landlord", landlord.kennitala, { title: "x", body: "Too short" })).toMatchObject({
      status: "error",
      step: "review",
      fieldErrors: {
        title: ["Title must be at least 3 characters."],
        body: ["Your review must be at least 20 characters."],
      },
      subject: { id: landlord.id, name: landlord.name },
      values: { title: "x", body: "Too short" },
    });
    expect(await reviewsBy(renter.id)).toEqual([]);
  });

  it("an existing person keeps their name and gets the role; an account too", async () => {
    const profile = await createUser({ roles: "renter", account: false, name: "Fyrsta Nafnið" });
    const account = await createUser({ roles: "renter" });
    const author = await createUser({ roles: "both" });
    await logInAs(author);
    expect(await wizardSave("landlord", profile.kennitala, { name: "Annað Nafn", confirm: true })).toEqual({
      redirect: savedPath("landlord", profile.id),
    });
    expect(await userRow(profile.id)).toMatchObject({ name: "Fyrsta Nafnið", isLandlord: true, isRenter: true });
    // No name needed for someone already known.
    expect(await wizardSave("landlord", account.kennitala)).toEqual({ redirect: savedPath("landlord", account.id) });
    expect(await userRow(account.id)).toMatchObject({ name: account.name, isLandlord: true, isRenter: true });
    // No new profiles were counted.
    expect(await attemptsFor(keysOf(author).newProfiles)).toBe(0);
    expect(await attemptsFor(keysOf(author).newReviews)).toBe(2);
  });

  it("posting again about the same person edits the review", async () => {
    const author = await createUser({ roles: "renter" });
    await logInAs(author);
    const kennitala = freshKennitala();
    const first = await wizardSave("landlord", kennitala, { name: "Jón Prófun", confirm: true, title: "One" });
    const second = await wizardSave("landlord", kennitala, { title: "Two" });
    expect(second).toEqual(first);
    expect((await reviewsBy(author.id)).map((r) => r.title)).toEqual(["Two"]);
    expect(await attemptsFor(keysOf(author).newReviews)).toBe(1);
  });

  it("refuses your own kennitala and minors, going back to the first step", async () => {
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    expect(await wizardSave("landlord", renter.kennitala, { name: "Mín Prófun", confirm: true })).toMatchObject({
      step: "kennitala",
      fieldErrors: { subjectKennitala: [OWN_KENNITALA] },
    });
    const minor = freshKennitala("minor");
    expect(await wizardSave("landlord", minor, { name: "Barn Prófun", confirm: true })).toMatchObject({
      step: "kennitala",
      fieldErrors: { subjectKennitala: [MINOR] },
    });
    expect(await rowsWithKennitala(minor)).toEqual([]);
    expect(await reviewsBy(renter.id)).toEqual([]);
  });

  describe("when the profile the lookup found is deleted before the review is written", () => {
    // reconcileProfiles can delete a profile without an account between the
    // wizard's lookup and its transaction (its last other review was deleted).
    const vanished = () =>
      vi.mocked(findPersonByKennitala).mockResolvedValueOnce({
        id: crypto.randomUUID(),
        name: "Horfin Prófun",
        isLandlord: true,
        isRenter: false,
        isCompany: false,
        hasAccount: false,
      });

    it("a typed name creates it again, counted as a new profile", async () => {
      const renter = await createUser({ roles: "renter" });
      await logInAs(renter);
      const kennitala = freshKennitala();
      vanished();
      const result = await wizardSave("landlord", kennitala, { name: "Jón Prófun", confirm: true });
      const [profile] = await rowsWithKennitala(kennitala);
      expect(result).toEqual({ redirect: savedPath("landlord", profile.id) });
      expect(profile).toMatchObject({ name: "Jón Prófun", hasAccount: false, isLandlord: true });
      expect(await attemptsFor(keysOf(renter).newProfiles)).toBe(1);
      expect(await attemptsFor(keysOf(renter).newReviews)).toBe(1);
    });

    it("without a name, it asks for one", async () => {
      const renter = await createUser({ roles: "renter" });
      await logInAs(renter);
      const kennitala = freshKennitala();
      vanished();
      expect(await wizardSave("landlord", kennitala, { title: "Kept" })).toMatchObject({
        status: "error",
        step: "review",
        fieldErrors: { subjectName: [NAME_TOO_SHORT] },
        subject: { id: null, name: null },
        values: { title: "Kept" },
      });
      expect(await rowsWithKennitala(kennitala)).toEqual([]);
      expect(await attemptsFor(keysOf(renter).newProfiles)).toBe(0);
      expect(await attemptsFor(keysOf(renter).newReviews)).toBe(0);
    });
  });

  it("too many new profiles in a day: refused, nothing created", async () => {
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    await seedAttempts(keysOf(renter).newProfiles, 5);
    const kennitala = freshKennitala();
    expect(await wizardSave("landlord", kennitala, { name: "Jón Prófun", confirm: true })).toMatchObject({
      status: "error",
      step: "review",
      message: TRY_LATER,
    });
    expect(await rowsWithKennitala(kennitala)).toEqual([]);
    expect(await attemptsFor(keysOf(renter).newReviews)).toBe(0);
    // Reviewing someone already known still works.
    const known = await createUser({ roles: "landlord", account: false });
    expect(await wizardSave("landlord", known.kennitala)).toEqual({ redirect: savedPath("landlord", known.id) });
  });

  it("too many new reviews in a day: refused, nothing created", async () => {
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    await seedAttempts(keysOf(renter).newReviews, 20);
    const kennitala = freshKennitala();
    expect(await wizardSave("landlord", kennitala, { name: "Jón Prófun", confirm: true })).toMatchObject({
      step: "review",
      message: TRY_LATER,
    });
    expect(await rowsWithKennitala(kennitala)).toEqual([]);
    expect(await attemptsFor(keysOf(renter).newProfiles)).toBe(0);
  });

  it("answers in Icelandic by default", async () => {
    const landlord = await createUser({ roles: "landlord" });
    await logInAs(landlord);
    speakIcelandic();
    expect(await check("landlord", freshKennitala())).toMatchObject({
      step: "kennitala",
      message: "Aðeins leigjendur geta skrifað umsagnir um leigusala.",
    });
    expect(await wizardSave("renter", freshKennitala(), { name: "Jón Prófun" })).toMatchObject({
      step: "review",
      fieldErrors: { confirmNew: ["Hakaðu í reitinn til að staðfesta að kennitalan sé rétt."] },
    });
    expect(await check("renter", landlord.kennitala)).toMatchObject({
      fieldErrors: { subjectKennitala: ["Þetta er þín eigin kennitala."] },
    });
  });
});

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

describe("deleteReview", () => {
  it("only the author can delete a review", async () => {
    const landlord = await createUser({ roles: "landlord" });
    const author = await createUser({ roles: "renter" });
    const stranger = await createUser({ roles: "renter" });
    const reviewId = await insertReview({ kind: "landlord", authorId: author.id, subjectUserId: landlord.id });
    await logInAs(stranger);
    await deleteReview(form({ reviewId }));
    expect(await reviewsBy(author.id)).toHaveLength(1);
    // Signed out, or a malformed id: nothing happens.
    await logInAs(author);
    await deleteReview(form({ reviewId: "not-a-uuid" }));
    expect(await reviewsBy(author.id)).toHaveLength(1);
    await deleteReview(form({ reviewId }));
    expect(await reviewsBy(author.id)).toEqual([]);
  });

  it("deleting the only review of a profile without an account deletes the profile too", async () => {
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    const kennitala = freshKennitala();
    const id = redirectedId(await wizardSave("landlord", kennitala, { name: "Jón Prófun", confirm: true }));
    const reviewId = (await getReviewByAuthor(renter.id, { userId: id, as: "landlord" }))!.id;
    // Its page is gone, so the author goes to their dashboard.
    expect(await outcome(deleteReview(form({ reviewId })))).toEqual({ redirect: "/dashboard" });
    expect(await rowsWithKennitala(kennitala)).toEqual([]);
    expect(nextCacheMock.revalidatePath).toHaveBeenCalledWith(`/landlords/${id}`);
  });

  it("a profile without an account keeps what it still has", async () => {
    const profile = await createUser({ roles: "both", account: false });
    const renter = await createUser({ roles: "renter" });
    const landlord = await createUser({ roles: "landlord" });
    await insertReview({ kind: "landlord", authorId: renter.id, subjectUserId: profile.id });
    const renterReview = await insertReview({ kind: "renter", authorId: landlord.id, subjectUserId: profile.id });
    await logInAs(landlord);
    expect(await outcome(deleteReview(form({ reviewId: renterReview })))).toBeUndefined();
    expect(await userRow(profile.id)).toMatchObject({ isLandlord: true, isRenter: false });

    // A linked property keeps a landlord profile with no reviews.
    const linked = await createUser({ roles: "landlord", account: false });
    await insertProperty({ landlordId: linked.id, createdById: renter.id });
    const only = await insertReview({ kind: "landlord", authorId: renter.id, subjectUserId: linked.id });
    await logInAs(renter);
    expect(await outcome(deleteReview(form({ reviewId: only })))).toBeUndefined();
    expect(await userRow(linked.id)).toMatchObject({ isLandlord: true });
  });

  it("accounts are never deleted or changed by it", async () => {
    const account = await createUser({ roles: "both" });
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    await reviewPerson("landlord", account);
    const reviewId = (await getReviewByAuthor(renter.id, { userId: account.id, as: "landlord" }))!.id;
    expect(await outcome(deleteReview(form({ reviewId })))).toBeUndefined();
    expect(await userRow(account.id)).toMatchObject({ isLandlord: true, isRenter: true });
  });

  it("deleting a property review leaves the property", async () => {
    const renter = await createUser({ roles: "renter" });
    const property = await insertProperty({ landlordId: null, createdById: renter.id });
    await logInAs(renter);
    await review("property", property.id);
    const reviewId = (await getReviewByAuthor(renter.id, { propertyId: property.id }))!.id;
    expect(await outcome(deleteReview(form({ reviewId })))).toBeUndefined();
    expect(await reviewsBy(renter.id)).toEqual([]);
    const db = await getDb();
    expect(await db.select({ id: properties.id }).from(properties).where(eq(properties.id, property.id))).toHaveLength(1);
    expect(nextCacheMock.revalidatePath).toHaveBeenCalledWith(`/properties/${property.id}`);
  });
});

// ---------------------------------------------------------------------------
// At the same moment (real Postgres only)
// ---------------------------------------------------------------------------

describe.runIf(usingPostgres)("at the same moment", () => {
  it("two first reviews of a new kennitala make one profile", async () => {
    for (let i = 0; i < 8; i++) {
      const kennitala = freshKennitala();
      const a = await createUser({ roles: "renter" });
      const b = await createUser({ roles: "renter" });
      const asA = await logInAs(a);
      const asB = await logInAs(b);
      const [first, second] = await atOnce(
        () => asVisitor(asA, () => wizardSave("landlord", kennitala, { name: "Fyrra Nafn", confirm: true })),
        () => asVisitor(asB, () => wizardSave("landlord", kennitala, { name: "Seinna Nafn", confirm: true })),
        i,
      );
      const rows = await rowsWithKennitala(kennitala);
      const detail = `run ${i}: ${JSON.stringify([first, second])}`;
      expect(rows, detail).toHaveLength(1);
      expect([first, second], detail).toEqual([
        { redirect: savedPath("landlord", rows[0].id) },
        { redirect: savedPath("landlord", rows[0].id) },
      ]);
      expect(["Fyrra Nafn", "Seinna Nafn"], detail).toContain(rows[0].name);
      expect(await reviewsAbout(rows[0].id), detail).toHaveLength(2);
      // Only the one that created it counts a new profile.
      const counted = (await attemptsFor(keysOf(a).newProfiles)) + (await attemptsFor(keysOf(b).newProfiles));
      expect(counted, detail).toBe(1);
    }
  }, 60_000);

  it("a review arriving while the profile's last other review is deleted keeps (or recreates) the profile", async () => {
    for (let i = 0; i < 8; i++) {
      const kennitala = freshKennitala();
      const first = await createUser({ roles: "renter" });
      const second = await createUser({ roles: "renter" });
      const asFirst = await logInAs(first);
      const id = redirectedId(await wizardSave("landlord", kennitala, { name: "Jón Prófun", confirm: true }));
      const reviewId = (await getReviewByAuthor(first.id, { userId: id, as: "landlord" }))!.id;
      const asSecond = await logInAs(second);
      const [deleted, saved] = await atOnce(
        () => asVisitor(asFirst, () => outcome(deleteReview(form({ reviewId })))),
        // With a name, in case the profile is gone by the time the review is written.
        () => asVisitor(asSecond, () => wizardSave("landlord", kennitala, { name: "Jón Prófun", confirm: true })),
        i,
      );
      const detail = `run ${i}: delete → ${JSON.stringify(deleted)}; save → ${JSON.stringify(saved)}`;
      const rows = await rowsWithKennitala(kennitala);
      expect(rows, detail).toHaveLength(1);
      expect(rows[0], detail).toMatchObject({ isLandlord: true, hasAccount: false });
      expect(saved, detail).toEqual({ redirect: savedPath("landlord", rows[0].id) });
      expect(await reviewsAbout(rows[0].id), detail).toHaveLength(1);
      expect(await reviewsBy(first.id), detail).toEqual([]);
    }
  }, 60_000);

  it("parallel wrong guesses on one profile can't exceed its limit", async () => {
    const landlord = await createUser({ roles: "landlord", account: false });
    await seedAttempts(`kt:subject:${landlord.id}`, 15);
    const guessers = await Promise.all(Array.from({ length: 10 }, () => createUser({ roles: "renter" })));
    const visitors = [];
    for (const guesser of guessers) visitors.push(await logInAs(guesser));
    const results = await Promise.all(
      visitors.map((visitor) =>
        asVisitor(visitor, () => review("landlord", landlord.id, { kennitala: freshKennitala() })),
      ),
    );
    // Each attempt is recorded before counting, so a burst may refuse more than
    // strictly needed, but never lets more than the limit through.
    const mismatches = results.filter((r) => r.fieldErrors?.subjectKennitala?.[0] === MISMATCH).length;
    const refused = results.filter((r) => r.message === TRY_LATER).length;
    expect(mismatches + refused).toBe(10);
    expect(mismatches).toBeLessThanOrEqual(5);
    expect(await attemptsFor(`kt:subject:${landlord.id}`)).toBe(15 + mismatches);
    expect(await reviewsAbout(landlord.id)).toEqual([]);
  }, 60_000);
});
