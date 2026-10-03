/**
 * Browsing with kennitalas kept out of sight (docs/iceland-spec.md §8, §10):
 * the kennitala lookup (src/app/actions/lookup.ts), search queries that
 * contain a kennitala (src/components/kennitala-query.ts and the pages that
 * use it), reports (src/app/actions/reports.ts and src/app/report/target.ts),
 * and the directory cards.
 *
 * The parallel tests at the end only really race on a real Postgres
 * (UNIT_DATABASE_URL; see support/harness.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
vi.mock("next/headers", async () => (await import("./support/next-mocks")).nextHeadersMock);
vi.mock("next/navigation", async () => (await import("./support/next-mocks")).nextNavigationMock);
vi.mock("next/cache", async () => (await import("./support/next-mocks")).nextCacheMock);
// Unchanged, but observable: lets tests check when the lookup really queries by kennitala.
vi.mock("@/lib/people", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/people")>();
  return { ...actual, findPersonByKennitala: vi.fn(actual.findPersonByKennitala) };
});

import { eq, like } from "drizzle-orm";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { lookupKennitala } from "@/app/actions/lookup";
import { createReport } from "@/app/actions/reports";
import HomePage from "@/app/page";
import LandlordsPage from "@/app/landlords/page";
import { findReportTarget, REASONS_FOR } from "@/app/report/target";
import RentersPage from "@/app/renters/page";
import robots from "@/app/robots";
import SearchPage from "@/app/search/page";
import { PersonCard, PropertyCard } from "@/components/cards";
import { KENNITALA_LOOKUP_PATH, queryHasKennitala, redirectKennitalaQuery } from "@/components/kennitala-query";
import { authAttempts, reports, reviews, type ReportTarget } from "@/db/schema";
import { I18nProvider } from "@/i18n/client";
import type { Locale } from "@/i18n/config";
import { MESSAGES } from "@/i18n/messages";
import type { PersonListItem, PropertyListItem } from "@/lib/data";
import { idleFormState, type FormState } from "@/lib/form-state";
import { formatKennitala } from "@/lib/kennitala";
import { findPersonByKennitala } from "@/lib/people";
import { REPORT_REASONS } from "@/lib/validation";
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
  outcome,
  seedAttempts,
  unique,
  usingPostgres,
  type TestUser,
} from "./support/harness";

// ---------------------------------------------------------------------------
// Messages (the harness's visitors read English)
// ---------------------------------------------------------------------------

const LOG_IN = "Log in to look up a kennitala.";
const NOT_FOUND = "Nobody with this kennitala has been reviewed yet.";
const WRITE_FIRST = { href: "/reviews/new", label: "Write the first review" };
const TRY_LATER = "Too many attempts. Please try again later.";
const FIX = "Please fix the highlighted fields.";
const INVALID_KENNITALA = "That isn't a valid kennitala. Enter 10 digits, e.g. 123456-7890.";
const KENNITALA_REQUIRED = "Enter a kennitala.";
const SENT = "Thanks. We'll look into it.";
const CANT_REPORT = "That page can't be reported.";
const CONTACT_REQUIRED = "Enter your email address so we can reply.";
const DETAILS_REQUIRED = "Describe the problem.";
const REASON_REQUIRED = "Choose a reason.";
const INVALID_EMAIL = "Enter a valid email address.";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Outcome = FormState | { redirect: string; type?: "push" | "replace" };

/** Submit the lookup form as the current visitor, from the page `next` (the home page by default). */
function lookUp(kennitala: string | undefined, next = "/"): Promise<Outcome> {
  return outcome(lookupKennitala(idleFormState, form({ kennitala, next })));
}

/** Submit the report form as the current visitor. */
function report(fields: {
  target?: string;
  id?: string;
  reason?: string;
  details?: string;
  contactEmail?: string;
}): Promise<FormState> {
  return createReport(
    idleFormState,
    form({ reason: "other", details: `Something is wrong here ${unique()}.`, ...fields }),
  );
}

async function reportsFrom(filter: { reporterId?: string; details?: string }) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(reports)
    .where(filter.reporterId ? eq(reports.reporterId, filter.reporterId) : eq(reports.details, filter.details!));
  return rows;
}

const ip = () => currentVisitor().ip!;

/** Read the rest of this test in Icelandic (no language cookie: the site's default). */
function speakIcelandic(): void {
  currentVisitor().cookies.delete("lang");
}

/** Every way a kennitala could show up in text: 10 digits, or with the hyphen. */
function forms(kennitala: string): string[] {
  return [kennitala, formatKennitala(kennitala), `${kennitala.slice(0, 6)} ${kennitala.slice(6)}`];
}

function mentions(value: unknown, kennitala: string): boolean {
  const text = JSON.stringify(value) ?? "";
  return forms(kennitala).some((form) => text.includes(form));
}

/** A random UUID that no row has. */
const missingId = () => crypto.randomUUID();

/** Call a page component the way Next does: with promised search params. */
function visitPage(page: (props: never) => Promise<unknown>, searchParams: Record<string, string>) {
  return outcome(page({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) } as never));
}

beforeEach(() => {
  vi.mocked(findPersonByKennitala).mockClear();
});

// ---------------------------------------------------------------------------
// Looking up a kennitala
// ---------------------------------------------------------------------------

describe("lookupKennitala", () => {
  let searcher: TestUser;

  beforeEach(async () => {
    searcher = await createUser({ roles: "renter" });
  });

  it("asks a visitor who isn't logged in to log in, without looking anything up", async () => {
    const someone = await createUser({ roles: "landlord" });
    const result = await lookUp(formatKennitala(someone.kennitala), "/search");
    expect(result).toEqual({
      status: "error",
      message: LOG_IN,
      link: { href: "/login?next=%2Fsearch", label: "Log in" },
      // The visitor's own typing comes back to their own form, nowhere else.
      values: { kennitala: formatKennitala(someone.kennitala), next: "/search" },
    });
    expect(findPersonByKennitala).not.toHaveBeenCalled();
    expect(await attemptsFor(`kt:ip:${ip()}`)).toBe(0);
  });

  it("sends a visitor who isn't logged in back to a page on this site only", async () => {
    for (const [next, href] of [
      ["/", "/login?next=%2F"],
      [undefined, "/login?next=%2Fsearch"],
      ["//evil.example", "/login?next=%2Fsearch"],
      ["https://evil.example/", "/login?next=%2Fsearch"],
    ] as const) {
      const result = await outcome(lookupKennitala(idleFormState, form({ kennitala: "123", next })));
      expect(result, String(next)).toMatchObject({ message: LOG_IN, link: { href } });
    }
  });

  it("finds a person however the number is typed, and goes to their profile", async () => {
    const landlord = await createUser({ roles: "landlord" });
    await logInAs(searcher);
    for (const typed of [...forms(landlord.kennitala), ` kt. ${formatKennitala(landlord.kennitala)} `]) {
      expect(await lookUp(typed), typed).toEqual({ redirect: `/landlords/${landlord.id}` });
    }
  });

  it("goes to the profile of the role they have: renter, landlord (preferred when both)", async () => {
    const renter = await createUser({ roles: "renter" });
    const both = await createUser({ roles: "both" });
    await logInAs(searcher);
    expect(await lookUp(renter.kennitala)).toEqual({ redirect: `/renters/${renter.id}` });
    expect(await lookUp(both.kennitala)).toEqual({ redirect: `/landlords/${both.id}` });
  });

  it("finds profiles without an account and companies too", async () => {
    const noAccount = await createUser({ roles: "landlord", account: false });
    const company = await createUser({ roles: "landlord", company: true, account: false });
    await logInAs(searcher);
    expect(await lookUp(noAccount.kennitala)).toEqual({ redirect: `/landlords/${noAccount.id}` });
    expect(await lookUp(company.kennitala)).toEqual({ redirect: `/landlords/${company.id}` });
  });

  it("finds your own profile when you look up your own number", async () => {
    await logInAs(searcher);
    expect(await lookUp(searcher.kennitala)).toEqual({ redirect: `/renters/${searcher.id}` });
  });

  it("says nobody has been reviewed yet, and offers to write the first review", async () => {
    const nobody = freshKennitala();
    await logInAs(searcher);
    const result = await lookUp(formatKennitala(nobody));
    expect(result).toEqual({
      status: "success",
      message: NOT_FOUND,
      link: WRITE_FIRST,
      values: { kennitala: formatKennitala(nobody), next: "/" },
    });
  });

  it("checks the number before looking it up, and a malformed one doesn't count", async () => {
    await logInAs(searcher);
    for (const [typed, error] of [
      ["", KENNITALA_REQUIRED],
      [undefined, KENNITALA_REQUIRED],
      ["123", INVALID_KENNITALA],
      ["abcdef-ghij", INVALID_KENNITALA],
      // 31 February
      ["310299-2209", INVALID_KENNITALA],
    ] as const) {
      const result = await lookUp(typed);
      expect(result, String(typed)).toMatchObject({ status: "error", message: FIX, fieldErrors: { kennitala: [error] } });
    }
    expect(findPersonByKennitala).not.toHaveBeenCalled();
    expect(await attemptsFor(`kt:user15:${searcher.id}`)).toBe(0);
  });

  it("counts every lookup, found or not, per account (two windows) and per network", async () => {
    const landlord = await createUser({ roles: "landlord" });
    await logInAs(searcher);
    await lookUp(landlord.kennitala);
    await lookUp(freshKennitala());
    expect(await attemptsFor(`kt:user15:${searcher.id}`)).toBe(2);
    expect(await attemptsFor(`kt:userday:${searcher.id}`)).toBe(2);
    expect(await attemptsFor(`kt:ip:${ip()}`)).toBe(2);
  });

  it("refuses the 11th lookup in 15 minutes, without looking it up", async () => {
    const landlord = await createUser({ roles: "landlord" });
    await logInAs(searcher);
    await seedAttempts(`kt:user15:${searcher.id}`, 9);
    expect(await lookUp(landlord.kennitala)).toEqual({ redirect: `/landlords/${landlord.id}` });
    vi.mocked(findPersonByKennitala).mockClear();
    // Refused the same way whether or not anyone has the number.
    for (const kennitala of [landlord.kennitala, freshKennitala()]) {
      expect(await lookUp(kennitala)).toEqual({
        status: "error",
        message: TRY_LATER,
        values: { kennitala, next: "/" },
      });
    }
    expect(findPersonByKennitala).not.toHaveBeenCalled();
    // Refused attempts aren't counted, so they don't extend the block.
    expect(await attemptsFor(`kt:user15:${searcher.id}`)).toBe(10);
  });

  it("has a daily limit per account and a limit per network", async () => {
    await logInAs(searcher);
    await seedAttempts(`kt:userday:${searcher.id}`, 50);
    expect(await lookUp(freshKennitala())).toMatchObject({ message: TRY_LATER });

    const other = await createUser({ roles: "landlord" });
    await logInAs(other);
    await seedAttempts(`kt:ip:${ip()}`, 100);
    expect(await lookUp(freshKennitala())).toMatchObject({ message: TRY_LATER });
    // The same account from another network is fine.
    await logInAs(other);
    expect(await lookUp(freshKennitala())).toMatchObject({ message: NOT_FOUND });
  });

  it("shares its limits with the other kennitala checks (the review and property forms)", async () => {
    // The review wizard and property form count against the same keys (kennitalaCheckLimits).
    await logInAs(searcher);
    await seedAttempts(`kt:user15:${searcher.id}`, 10);
    expect(await lookUp(freshKennitala())).toMatchObject({ message: TRY_LATER });
  });

  it("isn't limited when AUTH_RATE_LIMIT=off", async () => {
    vi.stubEnv("AUTH_RATE_LIMIT", "off");
    await logInAs(searcher);
    await seedAttempts(`kt:user15:${searcher.id}`, 10);
    expect(await lookUp(freshKennitala())).toMatchObject({ message: NOT_FOUND });
  });

  it("is limited per account even when the network is unknown", async () => {
    await logInAs(searcher);
    currentVisitor().headers.delete("x-real-ip");
    await seedAttempts(`kt:user15:${searcher.id}`, 10);
    expect(await lookUp(freshKennitala())).toMatchObject({ message: TRY_LATER });
  });

  describe("never echoes or logs the kennitala", () => {
    let spies: MockInstance[];

    beforeEach(() => {
      spies = (["log", "info", "warn", "error", "debug", "trace"] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => {}),
      );
    });

    afterEach(() => {
      for (const spy of spies) spy.mockRestore();
    });

    it("in messages, links, redirects, rate-limit keys or logs, whatever the outcome", async () => {
      const landlord = await createUser({ roles: "landlord" });
      const nobody = freshKennitala();
      const results: unknown[] = [];

      // Logged out, found, not found, rate limited.
      results.push(await lookUp(landlord.kennitala));
      await logInAs(searcher);
      results.push(await lookUp(formatKennitala(landlord.kennitala)));
      results.push(await lookUp(nobody));
      await seedAttempts(`kt:user15:${searcher.id}`, 10);
      results.push(await lookUp(landlord.kennitala));

      for (const result of results) {
        const { values, ...shown } = result as FormState;
        expect(mentions(shown, landlord.kennitala) || mentions(shown, nobody), JSON.stringify(shown)).toBe(false);
        // Only the visitor's own form field gets it back.
        if (values) expect(Object.keys(values).sort()).toEqual(["kennitala", "next"]);
      }
      expect(results[1]).toEqual({ redirect: `/landlords/${landlord.id}` });

      const db = await getDb();
      for (const kennitala of [landlord.kennitala, nobody]) {
        for (const text of forms(kennitala)) {
          expect(await db.select().from(authAttempts).where(like(authAttempts.key, `%${text}%`))).toEqual([]);
        }
      }
      for (const spy of spies) {
        expect(mentions(spy.mock.calls, landlord.kennitala) || mentions(spy.mock.calls, nobody)).toBe(false);
      }
    });

    it("a failed database query is rethrown without the number", async () => {
      const kennitala = freshKennitala();
      await logInAs(searcher);
      // As people.ts does: the driver's error (which quotes the parameters) is sanitized.
      const { sanitizeDbError } = await import("@/db");
      vi.mocked(findPersonByKennitala).mockImplementationOnce(async () => {
        throw sanitizeDbError(
          Object.assign(new Error(`Failed query: select … where kennitala = $1 params: ${kennitala}`), { code: "57014" }),
        );
      });
      const error = await lookUp(kennitala).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Database error 57014");
      expect(mentions((error as Error).message, kennitala)).toBe(false);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    });
  });

  it("answers in Icelandic by default", async () => {
    speakIcelandic();
    expect(await lookUp("123")).toMatchObject({
      message: "Skráðu þig inn til að fletta upp kennitölu.",
      link: { label: "Skrá inn" },
    });
    await logInAs(searcher);
    speakIcelandic();
    expect(await lookUp(freshKennitala())).toMatchObject({
      status: "success",
      message: "Engin umsögn hefur enn verið skrifuð um þessa kennitölu.",
      link: { href: "/reviews/new", label: "Skrifa fyrstu umsögnina" },
    });
    expect(await lookUp("123")).toMatchObject({
      message: "Lagaðu merktu reitina.",
      fieldErrors: { kennitala: ["Þetta er ekki gild kennitala. Sláðu inn 10 tölustafi, t.d. 123456-7890."] },
    });
  });
});

// ---------------------------------------------------------------------------
// Search queries that contain a kennitala
// ---------------------------------------------------------------------------

describe("a kennitala in a search query", () => {
  const kennitala = "0101302989";

  it("is recognised anywhere in the query, typed any way", () => {
    for (const q of [
      kennitala,
      "010130-2989",
      " 010130 - 2989 ",
      "kt. 010130-2989",
      "Jón 0101302989",
      // Even an impossible one: a typo of a real number is still personal.
      "123456-7890",
      ["Jón", "010130-2989"],
    ]) {
      expect(queryHasKennitala(q), String(q)).toBe(true);
    }
    for (const q of ["", undefined, null, "Njálsgata 23", "101 Reykjavík", "Hamraborg 14 0503 200", "5812345", "12345-6789", []]) {
      expect(queryHasKennitala(q), String(q)).toBe(false);
    }
  });

  it("sends the visitor to the lookup form instead (never searched or shown)", () => {
    expect(KENNITALA_LOOKUP_PATH).toBe("/search?kt=1");
    expect(() => redirectKennitalaQuery("010130-2989")).toThrowError(/redirect to \/search\?kt=1/);
    expect(() => redirectKennitalaQuery("Njálsgata")).not.toThrow();
    expect(() => redirectKennitalaQuery(undefined)).not.toThrow();
  });

  it.each([
    ["the home page", HomePage],
    ["/search", SearchPage],
    ["/landlords", LandlordsPage],
    ["/renters", RentersPage],
  ] as const)("%s redirects it to /search?kt=1 before searching", async (_name, page) => {
    for (const q of [kennitala, "010130-2989", "kt. 010130 2989"]) {
      expect(await visitPage(page, { q }), q).toEqual({ redirect: KENNITALA_LOOKUP_PATH });
    }
    // Ordinary searches render.
    const rendered = await visitPage(page, { q: "Njálsgata" });
    expect(rendered).not.toHaveProperty("redirect");
  });

  it("/search?kt=1 itself renders (the lookup form with its pointer)", async () => {
    expect(await visitPage(SearchPage, { kt: "1" })).not.toHaveProperty("redirect");
  });
});

describe("robots.txt", () => {
  it("keeps crawlers off renters, search, the review wizard, the dashboard and reports", () => {
    expect(robots()).toEqual({
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: ["/renters", "/search", "/reviews", "/dashboard", "/report"],
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

describe("createReport", () => {
  let reporter: TestUser;
  let landlord: TestUser;
  let reviewId: string;

  beforeEach(async () => {
    reporter = await createUser({ roles: "renter" });
    landlord = await createUser({ roles: "landlord" });
    const author = await createUser({ roles: "renter" });
    reviewId = await insertReview({ kind: "landlord", authorId: author.id, subjectUserId: landlord.id });
  });

  it("stores a logged-in visitor's report with them as the reporter", async () => {
    await logInAs(reporter);
    const details = `The review names my neighbour's illness ${unique()}.`;
    expect(await report({ target: "review", id: reviewId, reason: "personal_data", details })).toEqual({
      status: "success",
      message: SENT,
    });
    const [row] = await reportsFrom({ reporterId: reporter.id });
    expect(row).toMatchObject({
      targetKind: "review",
      targetId: reviewId,
      reason: "personal_data",
      details,
      contactEmail: null,
      reporterId: reporter.id,
      resolvedAt: null,
      resolution: null,
    });
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("lets a logged-in visitor leave an email for the reply (stored lower-cased)", async () => {
    await logInAs(reporter);
    await report({ target: "profile", id: landlord.id, contactEmail: "  Reply@Example.COM " });
    const [row] = await reportsFrom({ reporterId: reporter.id });
    expect(row).toMatchObject({ targetKind: "profile", targetId: landlord.id, contactEmail: "reply@example.com" });
  });

  it("needs an email address from a visitor who isn't logged in, and then stores no reporter", async () => {
    const details = `Wrong person ${unique()}.`;
    for (const contactEmail of [undefined, "", "   "]) {
      expect(await report({ target: "review", id: reviewId, details, contactEmail }), String(contactEmail)).toMatchObject({
        status: "error",
        message: FIX,
        fieldErrors: { contactEmail: [CONTACT_REQUIRED] },
        values: { details },
      });
    }
    expect(await reportsFrom({ details })).toEqual([]);

    expect(await report({ target: "review", id: reviewId, details, contactEmail: "Visitor@Example.com" })).toEqual({
      status: "success",
      message: SENT,
    });
    const [row] = await reportsFrom({ details });
    expect(row).toMatchObject({ contactEmail: "visitor@example.com", reporterId: null, targetId: reviewId });
  });

  it("shows a missing email together with the other problems", async () => {
    const result = await report({ target: "review", id: reviewId, reason: "", details: "" });
    expect(result).toMatchObject({
      status: "error",
      message: FIX,
      fieldErrors: { reason: [REASON_REQUIRED], details: [DETAILS_REQUIRED], contactEmail: [CONTACT_REQUIRED] },
    });
  });

  it("accepts a review, a profile, a property, or an account (which never has an id)", async () => {
    const property = await insertProperty({ landlordId: landlord.id, createdById: landlord.id });
    await logInAs(reporter);
    expect(await report({ target: "review", id: reviewId })).toMatchObject({ status: "success" });
    expect(await report({ target: "profile", id: landlord.id })).toMatchObject({ status: "success" });
    expect(await report({ target: "property", id: property.id })).toMatchObject({ status: "success" });
    expect(await report({ target: "account", reason: "identity_claimed" })).toMatchObject({ status: "success" });
    expect(await report({ target: "account", id: landlord.id })).toMatchObject({ status: "success" });
    const rows = await reportsFrom({ reporterId: reporter.id });
    expect(rows.map((row) => [row.targetKind, row.targetId]).sort()).toEqual(
      [
        ["account", null],
        ["account", null],
        ["profile", landlord.id],
        ["property", property.id],
        ["review", reviewId],
      ].sort(),
    );
  });

  it("refuses an unknown target, or a missing, malformed or unknown id, without counting it", async () => {
    await logInAs(reporter);
    const deletedReview = await insertReview({
      kind: "landlord",
      authorId: (await createUser({ roles: "renter" })).id,
      subjectUserId: landlord.id,
    });
    const db = await getDb();
    await db.delete(reviews).where(eq(reviews.id, deletedReview));

    for (const fields of [
      { target: "user", id: landlord.id },
      { target: undefined, id: landlord.id },
      { target: "review" },
      { target: "review", id: "not-a-uuid" },
      { target: "profile", id: `${landlord.id}x` },
      { target: "review", id: missingId() },
      { target: "profile", id: missingId() },
      { target: "property", id: missingId() },
      // A review id given as a profile, or the other way round.
      { target: "profile", id: reviewId },
      { target: "review", id: landlord.id },
      { target: "review", id: deletedReview },
    ]) {
      const result = await report(fields);
      expect(result, JSON.stringify(fields)).toMatchObject({ status: "error", message: CANT_REPORT });
    }
    expect(await reportsFrom({ reporterId: reporter.id })).toEqual([]);
    expect(await attemptsFor(`report:user:${reporter.id}`)).toBe(0);
  });

  it("needs a reason from the list", async () => {
    await logInAs(reporter);
    for (const reason of ["", "spam", undefined]) {
      expect(await report({ target: "review", id: reviewId, reason }), String(reason)).toMatchObject({
        message: FIX,
        fieldErrors: { reason: [REASON_REQUIRED] },
      });
    }
    for (const reason of REPORT_REASONS) {
      expect(await report({ target: "review", id: reviewId, reason }), reason).toMatchObject({ status: "success" });
    }
  });

  it("needs details, at most 2000 characters; they may name a kennitala", async () => {
    await logInAs(reporter);
    for (const details of ["", "   \n "]) {
      expect(await report({ target: "review", id: reviewId, details })).toMatchObject({
        fieldErrors: { details: [DETAILS_REQUIRED] },
      });
    }
    expect(await report({ target: "review", id: reviewId, details: "x".repeat(2001) })).toMatchObject({
      fieldErrors: { details: ["Must be 2,000 characters or fewer."] },
    });
    const longest = `${unique()} ${"x".repeat(1990)}`.slice(0, 2000);
    expect(await report({ target: "review", id: reviewId, details: `  ${longest}  ` })).toMatchObject({
      status: "success",
    });
    expect(await reportsFrom({ details: longest })).toHaveLength(1);

    // Someone whose identity was claimed has to say whose number it is.
    const claimed = `Someone signed up with my kennitala ${formatKennitala(freshKennitala())} ${unique()}`;
    expect(await report({ target: "account", reason: "identity_claimed", details: claimed })).toMatchObject({
      status: "success",
    });
    expect(await reportsFrom({ details: claimed })).toHaveLength(1);
  });

  it("checks the email address when one is given", async () => {
    await logInAs(reporter);
    expect(await report({ target: "review", id: reviewId, contactEmail: "not-an-email" })).toMatchObject({
      fieldErrors: { contactEmail: [INVALID_EMAIL] },
    });
  });

  describe("rate limits", () => {
    it("allows 10 reports a day per account", async () => {
      await logInAs(reporter);
      await seedAttempts(`report:user:${reporter.id}`, 9);
      expect(await report({ target: "review", id: reviewId })).toMatchObject({ status: "success" });
      expect(await report({ target: "review", id: reviewId })).toMatchObject({
        status: "error",
        message: TRY_LATER,
      });
      expect(await reportsFrom({ reporterId: reporter.id })).toHaveLength(1);
      expect(await attemptsFor(`report:user:${reporter.id}`)).toBe(10);
      // The account from another network is still limited.
      await logInAs(reporter);
      expect(await report({ target: "review", id: reviewId })).toMatchObject({ message: TRY_LATER });
    });

    it("allows 20 reports a day per network, logged in or not", async () => {
      const visitor = newVisitor();
      await seedAttempts(`report:ip:${visitor.ip}`, 20);
      expect(await report({ target: "review", id: reviewId, contactEmail: "a@example.com" })).toMatchObject({
        message: TRY_LATER,
      });
      // Another network is fine.
      newVisitor();
      expect(await report({ target: "review", id: reviewId, contactEmail: "a@example.com" })).toMatchObject({
        status: "success",
      });
    });

    it("counts sent reports per account and per network, never with the details or email in a key", async () => {
      await logInAs(reporter);
      const details = `Private details ${unique()}`;
      await report({ target: "review", id: reviewId, details, contactEmail: "secret@example.com" });
      expect(await attemptsFor(`report:user:${reporter.id}`)).toBe(1);
      expect(await attemptsFor(`report:ip:${ip()}`)).toBe(1);
      const db = await getDb();
      for (const text of [details, "secret@example.com"]) {
        expect(await db.select().from(authAttempts).where(like(authAttempts.key, `%${text}%`))).toEqual([]);
      }
    });

    it("doesn't count invalid reports", async () => {
      await logInAs(reporter);
      await report({ target: "review", id: reviewId, details: "" });
      await report({ target: "review", id: reviewId, reason: "spam" });
      expect(await attemptsFor(`report:user:${reporter.id}`)).toBe(0);
      expect(await attemptsFor(`report:ip:${ip()}`)).toBe(0);
    });

    it("isn't limited when AUTH_RATE_LIMIT=off", async () => {
      vi.stubEnv("AUTH_RATE_LIMIT", "off");
      await logInAs(reporter);
      await seedAttempts(`report:user:${reporter.id}`, 10);
      expect(await report({ target: "review", id: reviewId })).toMatchObject({ status: "success" });
    });
  });

  it("answers in Icelandic by default", async () => {
    speakIcelandic();
    expect(await report({ target: "review", id: reviewId })).toMatchObject({
      fieldErrors: { contactEmail: ["Sláðu inn netfang svo hægt sé að svara þér."] },
    });
    expect(await report({ target: "nothing" })).toMatchObject({ message: "Ekki er hægt að tilkynna þessa síðu." });
    expect(await report({ target: "review", id: reviewId, contactEmail: "a@example.com" })).toEqual({
      status: "success",
      message: "Takk. Við skoðum málið.",
    });
  });
});

// ---------------------------------------------------------------------------
// The report page's target (validated search params)
// ---------------------------------------------------------------------------

describe("findReportTarget (the /report page)", () => {
  it("describes a review of a person, linking to their page in that role", async () => {
    const subject = await createUser({ roles: "both", name: `Jóna Prófun ${unique()}` });
    const author = await createUser({ roles: "landlord" });
    const id = await insertReview({ kind: "renter", authorId: author.id, subjectUserId: subject.id, title: "Góð umgengni" });
    const target = await findReportTarget("review", id);
    expect(target).toEqual({
      target: "review",
      id,
      title: "Góð umgengni",
      about: { kind: "renter", name: subject.name },
      href: `/renters/${subject.id}`,
    });
    expect(mentions(target, subject.kennitala)).toBe(false);
  });

  it("describes a review of a property, with its address", async () => {
    const author = await createUser({ roles: "renter" });
    const property = await insertProperty({ landlordId: null, createdById: author.id, unit: "0201", postalCode: 200 });
    const id = await insertReview({ kind: "property", authorId: author.id, propertyId: property.id, title: "Rakt" });
    expect(await findReportTarget("review", id)).toEqual({
      target: "review",
      id,
      title: "Rakt",
      about: { kind: "property", address: property.address, unit: "0201", postalCode: 200 },
      href: `/properties/${property.id}`,
    });
  });

  it("describes a profile (with or without an account) and a property", async () => {
    const renter = await createUser({ roles: "renter", account: false });
    const property = await insertProperty({ landlordId: null, createdById: null, postalCode: 101 });
    const profile = await findReportTarget("profile", renter.id);
    expect(profile).toEqual({ target: "profile", id: renter.id, name: renter.name, href: `/renters/${renter.id}` });
    expect(mentions(profile, renter.kennitala)).toBe(false);
    expect(await findReportTarget("property", property.id)).toEqual({
      target: "property",
      id: property.id,
      address: property.address,
      unit: null,
      postalCode: 101,
      href: `/properties/${property.id}`,
    });
  });

  it("needs no id for an account, and ignores one", async () => {
    expect(await findReportTarget("account", undefined)).toEqual({ target: "account", id: null, href: null });
    expect(await findReportTarget("account", missingId())).toEqual({ target: "account", id: null, href: null });
  });

  it("is null for anything that can't be reported", async () => {
    const user = await createUser({ roles: "landlord" });
    for (const [target, id] of [
      [undefined, undefined],
      ["", user.id],
      ["user", user.id],
      ["Profile", user.id],
      [["profile"], user.id],
      ["profile", undefined],
      ["profile", ""],
      ["profile", "123"],
      ["profile", missingId()],
      ["review", user.id],
      ["property", user.id],
    ] as const) {
      expect(await findReportTarget(target, id), `${String(target)} ${String(id)}`).toBeNull();
    }
  });

  it("offers reasons that make sense for each target, all of them valid", () => {
    for (const [target, reasons] of Object.entries(REASONS_FOR) as [ReportTarget, readonly string[]][]) {
      expect(reasons.length, target).toBeGreaterThan(1);
      for (const reason of reasons) expect(REPORT_REASONS, `${target} ${reason}`).toContain(reason);
      expect(reasons.at(-1), target).toBe("other");
    }
    expect(REASONS_FOR.account[0]).toBe("identity_claimed");
    expect(REASONS_FOR.profile[0]).toBe("wrong_name");
  });
});

// ---------------------------------------------------------------------------
// Cards (client components, rendered as the server would)
// ---------------------------------------------------------------------------

describe("directory cards", () => {
  function render(locale: Locale, node: ReactNode): string {
    const props = { locale, messages: MESSAGES[locale] } as ComponentProps<typeof I18nProvider>;
    return renderToStaticMarkup(createElement(I18nProvider, props, node));
  }
  const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  const person = (overrides: Partial<PersonListItem> = {}): PersonListItem => ({
    id: "11111111-1111-4111-8111-111111111111",
    name: "Gunnar Már Pétursson",
    isLandlord: true,
    isRenter: false,
    isCompany: false,
    hasAccount: false,
    city: null,
    bio: null,
    joinedAt: null,
    firstReviewedAt: new Date("2026-03-01T12:00:00Z"),
    average: 4.25,
    reviewCount: 3,
    propertyCount: 2,
    ...overrides,
  });

  const property = (overrides: Partial<PropertyListItem> = {}): PropertyListItem => ({
    id: "22222222-2222-4222-8222-222222222222",
    address: "Njálsgata 23",
    unit: "0201",
    postalCode: 101,
    place: "Reykjavík",
    description: null,
    // Named by a renter, no account.
    landlord: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Gunnar Már Pétursson",
      hasAccount: false,
      confirmed: false,
    },
    createdById: null,
    createdAt: new Date("2026-03-01T12:00:00Z"),
    average: 4.3,
    reviewCount: 21,
    ...overrides,
  });

  it("badges a profile without an account and shows a landlord's properties where the city would be", () => {
    const html = text(render("en", createElement(PersonCard, { person: person(), role: "landlord" })));
    expect(html).toContain("Gunnar Már Pétursson 2 properties");
    expect(html).toContain("Landlord No account");
    expect(html).not.toContain("Location not listed");
    expect(html).toContain("4.3 · 3 reviews");
    expect(text(render("is", createElement(PersonCard, { person: person({ propertyCount: 21 }), role: "landlord" })))).toContain(
      "21 eign",
    );
    expect(text(render("is", createElement(PersonCard, { person: person(), role: "landlord" })))).toContain(
      "Leigusali Án aðgangs",
    );
  });

  it("shows an account's city, and the other role", () => {
    const html = text(
      render(
        "en",
        createElement(PersonCard, {
          person: person({ hasAccount: true, city: "Akureyri", isRenter: true, propertyCount: 0 }),
          role: "renter",
        }),
      ),
    );
    expect(html).toContain("Akureyri");
    expect(html).toContain("Renter · Also a landlord");
    expect(html).not.toContain("No account");
    expect(html).not.toContain("properties");
    expect(text(render("en", createElement(PersonCard, { person: person({ propertyCount: 0 }), role: "landlord" })))).toContain(
      "No properties yet",
    );
    expect(
      text(render("en", createElement(PersonCard, { person: person({ city: "Selfoss", propertyCount: 1 }), role: "landlord" }))),
    ).toContain("Selfoss · 1 property");
  });

  it("links to the profile in the card's role", () => {
    expect(render("en", createElement(PersonCard, { person: person(), role: "renter" }))).toContain(
      'href="/renters/11111111-1111-4111-8111-111111111111"',
    );
  });

  it("shows a property's address on two lines, its rating and its landlord", () => {
    const en = text(render("en", createElement(PropertyCard, { property: property() })));
    expect(en).toContain("Njálsgata 23, apt. 0201 101 Reykjavík");
    expect(en).toContain("4.3 · 21 reviews");
    expect(en).toContain("Landlord: Gunnar Már Pétursson (not confirmed)");
    const is = text(render("is", createElement(PropertyCard, { property: property() })));
    expect(is).toContain("Njálsgata 23, íbúð 0201 101 Reykjavík");
    expect(is).toContain("4,3 · 21 umsögn");
    expect(is).toContain("Leigusali: Gunnar Már Pétursson (ekki staðfest)");

    const account = property({
      landlord: { id: "x", name: "Sigrún Helgadóttir", hasAccount: true, confirmed: false },
      unit: null,
    });
    expect(text(render("en", createElement(PropertyCard, { property: account })))).toContain("Landlord: Sigrún Helgadóttir");
    expect(text(render("en", createElement(PropertyCard, { property: property({ landlord: null }) })))).toContain(
      "Landlord not on GossipRent yet",
    );
  });

  it("doesn't call a landlord who listed or claimed the property unconfirmed after they close their account", () => {
    const closed = property({
      landlord: { id: "x", name: "Sigrún Helgadóttir", hasAccount: false, confirmed: true },
    });
    const en = text(render("en", createElement(PropertyCard, { property: closed })));
    expect(en).toContain("Landlord: Sigrún Helgadóttir");
    expect(en).not.toContain("not confirmed");
    const is = text(render("is", createElement(PropertyCard, { property: closed })));
    expect(is).toContain("Leigusali: Sigrún Helgadóttir");
    expect(is).not.toContain("ekki staðfest");
  });
});

// ---------------------------------------------------------------------------
// Bursts (only really parallel on Postgres)
// ---------------------------------------------------------------------------

describe.runIf(usingPostgres)("parallel requests", () => {
  // consumeAttempt records an attempt before counting, so a burst never gets
  // more than the allowance (it may get less: attempts refused in the same
  // instant still counted against each other). What's left of the allowance
  // can then be used one at a time, never more.

  it("parallel lookups can't exceed the per-account limit", async () => {
    const searcher = await createUser({ roles: "renter" });
    const visitor = await logInAs(searcher);
    await seedAttempts(`kt:user15:${searcher.id}`, 6);
    const burst = await Promise.all(
      Array.from({ length: 10 }, () => asVisitor(visitor, () => lookUp(freshKennitala()))),
    );
    for (const result of burst) expect([NOT_FOUND, TRY_LATER]).toContain((result as FormState).message);
    const inBurst = burst.filter((r) => (r as FormState).message === NOT_FOUND).length;
    expect(inBurst).toBeLessThanOrEqual(4);

    let after = 0;
    for (let i = 0; i < 5; i++) {
      const result = await asVisitor(visitor, () => lookUp(freshKennitala()));
      if ((result as FormState).message === NOT_FOUND) after += 1;
    }
    expect(inBurst + after).toBe(4);
    expect(await attemptsFor(`kt:user15:${searcher.id}`)).toBe(10);
  });

  it("parallel reports can't exceed the per-account limit", async () => {
    const reporter = await createUser({ roles: "renter" });
    const subject = await createUser({ roles: "landlord" });
    const visitor = await logInAs(reporter);
    await seedAttempts(`report:user:${reporter.id}`, 7);
    const send = () => asVisitor(visitor, () => report({ target: "profile", id: subject.id }));
    const [a, b] = await atOnce(send, () => Promise.all(Array.from({ length: 6 }, send)));
    const inBurst = [a, ...b].filter((r) => r.status === "success").length;
    expect(inBurst).toBeLessThanOrEqual(3);

    let after = 0;
    for (let i = 0; i < 4; i++) if ((await send()).status === "success") after += 1;
    expect(inBurst + after).toBe(3);
    expect(await reportsFrom({ reporterId: reporter.id })).toHaveLength(3);
  });

  it("a report from a fresh network and account goes through while another network is blocked", async () => {
    const blocked = newVisitor(freshIp());
    await seedAttempts(`report:ip:${blocked.ip}`, 20);
    const open = newVisitor(freshIp());
    const subject = await createUser({ roles: "landlord" });
    const [refused, sent] = await atOnce(
      () => asVisitor(blocked, () => report({ target: "profile", id: subject.id, contactEmail: "a@example.com" })),
      () => asVisitor(open, () => report({ target: "profile", id: subject.id, contactEmail: "b@example.com" })),
    );
    expect(refused).toMatchObject({ message: TRY_LATER });
    expect(sent).toMatchObject({ status: "success" });
  });
});
