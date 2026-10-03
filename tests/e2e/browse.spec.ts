import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import {
  addProperty,
  cardMeta,
  cardNames,
  cardSubtitle,
  createActor,
  DEMO,
  type DemoPersonKey,
  demoProfilePath,
  escapeRegExp,
  findPropertyPath,
  formatKennitala,
  freshKennitala,
  homeStat,
  kennitalaVariants,
  logInAs,
  lookupSection,
  lookUpKennitala,
  makeProperty,
  makeReview,
  makeUser,
  myProfilePath,
  nameToken,
  NOT_A_KENNITALA,
  type NewProperty,
  postReview,
  propertyAddressText,
  propertyLabel,
  propertyPlace,
  reviewCard,
  setLanguage,
  signUp,
  summaryCount,
  uid,
  writeReviewByKennitala,
} from "./helpers";

/*
 * Browsing: the home page, the landlord/renter/property directories, search,
 * profile and property pages, the kennitala lookup next to the search boxes,
 * 404s and phone widths. Exact values come from the seeded demo data
 * (src/db/demo-people.ts) or from rows a test creates itself with a unique
 * token in their names.
 */

const PEOPLE = DEMO.people;
const PROPERTIES = DEMO.properties;
const DAY = 24 * 60 * 60 * 1000;

type Role = "landlord" | "renter";

function demoPeopleIn(role: Role) {
  return Object.values(PEOPLE).filter((person) => (person.roles as readonly Role[]).includes(role));
}

/** What the site counts in a fresh database: the demo data. */
const DEMO_COUNTS = {
  reviews: DEMO.reviews.length,
  landlords: demoPeopleIn("landlord").length,
  renters: demoPeopleIn("renter").length,
  properties: Object.keys(PROPERTIES).length,
};

/** "October 2026", as profiles show "Member since" / "First reviewed" (Iceland's time zone). */
function monthYear(date: Date, locale: "en-GB" | "is-IS" = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "Atlantic/Reykjavik" }).format(date);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY);
}

/** How many days ago the first demo review about this person was written. */
function demoFirstReviewedDaysAgo(key: DemoPersonKey): number {
  const days = DEMO.reviews
    .filter((review) => ("landlord" in review && review.landlord === key) || ("renter" in review && review.renter === key))
    .map((review) => review.daysAgo);
  expect(days.length, `demo reviews about ${key}`).toBeGreaterThan(0);
  return Math.max(...days);
}

/** The "N things" total shown above a directory listing ("6 landlords", "7 properties"). */
async function directoryTotal(page: Page, path: string): Promise<number> {
  await page.goto(path);
  const summary = page
    .getByRole("main")
    .locator("p")
    .filter({ hasText: /^[\d,]+ (landlords?|renters?|propert(y|ies))$/ })
    .first();
  const match = (await summary.innerText()).match(/^([\d,]+)/);
  expect(match, `directory summary on ${path}`).not.toBeNull();
  return Number(match![1].replace(/,/g, ""));
}

/** The names on every page of a directory listing, following its "Next →" links. */
async function allCardNames(page: Page, path: string): Promise<string[]> {
  const names: string[] = [];
  await page.goto(path);
  for (;;) {
    names.push(...(await cardNames(page)));
    const next = page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "Next →" });
    if ((await next.count()) === 0) return names;
    await page.goto((await next.getAttribute("href"))!);
  }
}

/** Search a directory for someone by their whole name and return their card. */
async function findCard(page: Page, role: Role, name: string): Promise<Locator> {
  await page.goto(`/${role}s?q=${encodeURIComponent(name)}`);
  const card = personCard(page, name);
  await expect(card, name).toBeVisible();
  return card;
}

/** A person's card (in a directory or a search result group), found by the name it starts with. */
function personCard(scope: Page | Locator, name: string): Locator {
  const root = "goto" in scope ? scope.getByRole("main") : scope;
  return root.getByRole("link", { name: new RegExp(`^${escapeRegExp(name)}(\\s|$)`) });
}

/** A property's card: street line ("Njálsgata 23, apt. 0201"), then the place ("101 Reykjavík"). */
function propertyCard(scope: Page | Locator, property: { address: string; unit?: string | null; postalCode: string | number }): Locator {
  const root = "goto" in scope ? scope.getByRole("main") : scope;
  return root.getByRole("link", {
    name: new RegExp(`^${escapeRegExp(propertyLabel(property))}\\s*${escapeRegExp(propertyPlace(property))}`),
  });
}

function notFoundHeading(page: Page): Locator {
  return page.getByRole("heading", { level: 1, name: "We couldn't find that page" });
}

/** The page's <meta name="robots">. */
function robotsMeta(page: Page): Locator {
  return page.locator('meta[name="robots"]');
}

/** How far the page can scroll sideways (0 or less: not at all). */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
}

/** The id at the end of a profile or property path. */
function idOf(path: string): string {
  return path.split("/").pop()!;
}

/** Every URL the page requests from now on: navigations, fetches, RSC requests, assets. */
function watchRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  return urls;
}

/** Console errors and uncaught page errors (e.g. hydration mismatches) from now on. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

/** Fails if any of `urls` carries the kennitala, however it was written. */
function expectNoKennitalaIn(urls: string[], kennitala: string): void {
  for (const url of urls) {
    const decoded = decodeURIComponent(url.replace(/\+/g, " "));
    for (const variant of kennitalaVariants(kennitala)) {
      expect(decoded, "a requested URL").not.toContain(variant);
    }
  }
}

const HOME_SEARCH = "Search landlords, renters, and properties";
const KENNITALA_POINTER = "To look up a kennitala, use the form below.";

function homeSearchBox(page: Page): Locator {
  return page.getByRole("searchbox", { name: HOME_SEARCH });
}

/** The search box on /search or in a directory's filter bar. */
function searchBox(page: Page): Locator {
  return page.getByRole("search").getByRole("searchbox");
}

function lookupField(page: Page): Locator {
  return lookupSection(page).getByLabel("Kennitala", { exact: true });
}

/** A review with a unique title, for tests that need one but don't care what it says. */
function anyReview(stars = 4) {
  return makeReview(stars);
}

/**
 * New profiles without an account, made by reviewing fresh kennitalas from one
 * account's /reviews/new: renters review new landlords, landlords new renters.
 */
async function createProfilesWithoutAccount(
  reviewerPage: Page,
  kind: Role,
  people: { name: string; stars?: number }[],
): Promise<Map<string, { path: string; kennitala: string }>> {
  const result = new Map<string, { path: string; kennitala: string }>();
  for (const person of people) {
    const kennitala = freshKennitala();
    const path = await writeReviewByKennitala(reviewerPage, kind, { kennitala, name: person.name }, anyReview(person.stars ?? 4));
    result.set(person.name, { path, kennitala });
  }
  return result;
}

/** Sign up a renter or landlord account with this name, in a throwaway browser context. */
async function signUpSomeone(browser: Browser, role: Role, name: string): Promise<void> {
  const context = await browser.newContext();
  try {
    await signUp(await context.newPage(), makeUser(role, { name }));
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// Home page
// ---------------------------------------------------------------------------

test.describe("home page", () => {
  test("shows the pitch, search box, kennitala lookup, live stats, and latest reviews", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("GossipRent — Landlord & renter reviews");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1, name: "Rent with your eyes open." })).toBeVisible();
    await expect(homeSearchBox(page)).toBeVisible();
    await expect(homeSearchBox(page)).toHaveAttribute("placeholder", "Search a name, address, or postcode");

    // The kennitala lookup sits under the search box; visitors who aren't logged in are told to log in.
    const lookup = lookupSection(page);
    await expect(lookup.getByRole("heading", { level: 2, name: "Look up a kennitala" })).toBeVisible();
    await expect(lookupField(page)).toBeVisible();
    await expect(lookup.getByRole("button", { name: "Look up", exact: true })).toBeVisible();
    await expect(lookup.getByText("You need to log in to look up a kennitala.")).toBeVisible();
    await expect(lookup.getByRole("link", { name: "log in", exact: true })).toHaveAttribute("href", "/login?next=%2F");

    // The three things you can review.
    for (const [title, link, href] of [
      ["Review your landlord", "Find a landlord →", "/landlords"],
      ["Review the place you rent", "Find a property →", "/properties"],
      ["Review your renters", "Find a renter →", "/renters"],
    ]) {
      await expect(page.getByRole("heading", { level: 3, name: title })).toBeVisible();
      await expect(page.getByRole("main").getByRole("link", { name: link })).toHaveAttribute("href", href);
    }

    // Stats are at least the seeded demo data...
    const stats = {
      reviews: await homeStat(page, "Reviews"),
      landlords: await homeStat(page, "Landlords"),
      renters: await homeStat(page, "Renters"),
      properties: await homeStat(page, "Properties"),
    };
    expect(stats.reviews).toBeGreaterThanOrEqual(DEMO_COUNTS.reviews);
    expect(stats.landlords).toBeGreaterThanOrEqual(DEMO_COUNTS.landlords);
    expect(stats.renters).toBeGreaterThanOrEqual(DEMO_COUNTS.renters);
    expect(stats.properties).toBeGreaterThanOrEqual(DEMO_COUNTS.properties);

    // ...and the latest-reviews feed shows the six newest, each saying what it's about.
    const recent = page.getByRole("region", { name: "Latest reviews" }).locator("article");
    await expect(recent).toHaveCount(6);
    for (const card of await recent.all()) {
      await expect(card.getByText(/^(Reviewed|Lived at) /)).toBeVisible();
      await expect(card.getByRole("img", { name: /^Rated [1-5] out of 5 stars$/ })).toBeVisible();
      // Visitors can report a review, but not edit or delete it.
      await expect(card.getByRole("link", { name: "Report", exact: true })).toHaveAttribute(
        "href",
        /^\/report\?target=review&id=[0-9a-f-]{36}$/,
      );
      await expect(card.getByRole("button", { name: "Delete" })).toHaveCount(0);
    }

    // Signed-out visitors get sign-up calls to action.
    await expect(page.getByRole("link", { name: "I'm a renter" })).toHaveAttribute("href", "/signup?role=renter");
    await expect(page.getByRole("link", { name: "I'm a landlord" })).toHaveAttribute("href", "/signup?role=landlord");

    // The stat tiles agree with the directories, which list people with and without an account.
    expect(await directoryTotal(page, "/landlords")).toBe(stats.landlords);
    expect(await directoryTotal(page, "/renters")).toBe(stats.renters);
    expect(await directoryTotal(page, "/properties")).toBe(stats.properties);
  });

  test("stats count new accounts and new profiles without an account", async ({ page, browser }) => {
    await page.goto("/");
    const before = {
      renters: await homeStat(page, "Renters"),
      landlords: await homeStat(page, "Landlords"),
      reviews: await homeStat(page, "Reviews"),
    };

    await signUp(page, makeUser("renter"));
    await page.goto("/");
    expect(await homeStat(page, "Renters")).toBe(before.renters + 1);
    expect(await homeStat(page, "Landlords")).toBe(before.landlords);

    // A landlord reviewing a kennitala nobody has yet creates a renter profile without an account.
    const landlord = await createActor(browser, "landlord");
    await createProfilesWithoutAccount(landlord.page, "renter", [{ name: `Nína ${nameToken()}` }]);
    await landlord.context.close();
    await page.goto("/");
    expect(await homeStat(page, "Renters")).toBe(before.renters + 2);
    expect(await homeStat(page, "Landlords")).toBe(before.landlords + 1);
    expect(await homeStat(page, "Reviews")).toBe(before.reviews + 1);
  });

  test("the latest reviews feed shows new reviews first, saying who or what each is about", async ({ page, browser }) => {
    const renter = await createActor(browser, "renter");
    const property = makeProperty();
    const propertyPath = await addProperty(renter.page, property);
    const propertyReview = anyReview(4);
    await postReview(renter.page, propertyPath, propertyReview);

    const landlord = await createActor(browser, "landlord");
    const renteeName = `Nína ${nameToken()}`;
    const renterReview = anyReview(5);
    const renteePath = await writeReviewByKennitala(
      landlord.page,
      "renter",
      { kennitala: freshKennitala(), name: renteeName },
      renterReview,
    );
    await renter.context.close();
    await landlord.context.close();

    await page.goto("/");
    const feed = page.getByRole("region", { name: "Latest reviews" }).locator("article");
    await expect(feed).toHaveCount(6);

    // Newest first: the landlord's review of a renter (a page the review created)…
    const first = feed.nth(0);
    await expect(first.getByRole("heading", { level: 3, name: renterReview.title })).toBeVisible();
    await expect(first.getByText(`Reviewed ${renteeName}`, { exact: true })).toBeVisible();
    await expect(first.getByRole("link", { name: renteeName, exact: true })).toHaveAttribute("href", renteePath);
    await expect(first.getByRole("link", { name: landlord.user.name, exact: true })).toHaveAttribute(
      "href",
      landlord.profilePath,
    );
    await expect(first.getByText("Landlord", { exact: true })).toBeVisible();
    await expect(first.getByRole("img", { name: "Rated 5 out of 5 stars" })).toBeVisible();

    // …then the renter's review of the place they rent, with its whole address on one line.
    const second = feed.nth(1);
    await expect(second.getByRole("heading", { level: 3, name: propertyReview.title })).toBeVisible();
    await expect(second.getByText(`Lived at ${propertyAddressText(property)}`, { exact: true })).toBeVisible();
    await expect(second.getByRole("link", { name: propertyAddressText(property), exact: true })).toHaveAttribute(
      "href",
      propertyPath,
    );
    await expect(second.getByRole("link", { name: renter.user.name, exact: true })).toHaveAttribute(
      "href",
      renter.profilePath,
    );
    await expect(second.getByText("Renter", { exact: true })).toBeVisible();
    await expect(second.getByRole("img", { name: "Rated 4 out of 5 stars" })).toBeVisible();

    await second.getByRole("link", { name: propertyAddressText(property), exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: propertyLabel(property) })).toBeVisible();
  });

  test("main navigation reaches every directory", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const label of ["Landlords", "Renters", "Properties"]) {
      await nav.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${label.toLowerCase()}$`));
      await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
      await expect(page).toHaveTitle(`${label} · GossipRent`);
      await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    }
    await expect(nav.getByRole("link", { name: "Write a review", exact: true })).toHaveAttribute("href", "/reviews/new");
  });
});

test("pages are sent with basic security headers", async ({ page }) => {
  const response = await page.goto("/");
  const headers = response!.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("robots.txt keeps crawlers off renters, search, reviews, the dashboard and reports", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  const lines = (await response.text()).split("\n").map((line) => line.trim());
  expect(lines).toContain("User-Agent: *");
  for (const path of ["/renters", "/search", "/reviews", "/dashboard", "/report"]) {
    expect(lines).toContain(`Disallow: ${path}`);
  }
  expect(lines).not.toContain("Disallow: /landlords");
  expect(lines).not.toContain("Disallow: /properties");
});

test("the footer has the disclaimer and the privacy page explains kennitalas", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByText("Reviews are the opinions of their authors. Identities aren't verified.")).toBeVisible();
  await footer.getByRole("link", { name: "Privacy", exact: true }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page).toHaveTitle("Privacy · GossipRent");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
  for (const heading of [
    "Why we use kennitalas",
    "Kennitalas are never shown",
    "Identities aren't verified",
    "Reviews about you",
    "Closing your account",
    "What we store",
    "Contact",
  ]) {
    await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
  }
  await expect(page.getByText(/^Many people in Iceland share a name\./)).toBeVisible();
  await expect(page.getByText(/^You can't remove reviews others have written about you\./)).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "the report form" })).toHaveAttribute(
    "href",
    "/report?target=account",
  );
});

// ---------------------------------------------------------------------------
// Directories
// ---------------------------------------------------------------------------

test.describe("directories", () => {
  test("the landlords directory lists everyone who's a landlord, with or without an account", async ({ page }) => {
    await page.goto("/landlords");
    await expect(page).toHaveTitle("Landlords · GossipRent");
    await expect(page.getByRole("heading", { level: 1, name: "Landlords" })).toBeVisible();
    await expect(robotsMeta(page)).toHaveCount(0);
    const total = await directoryTotal(page, "/landlords");

    // Every page of the listing, A–Z: everyone counted is listed once.
    const names = await allCardNames(page, "/landlords?sort=name");
    expect(names).toHaveLength(total);
    expect(new Set(names).size).toBe(total);
    for (const landlord of demoPeopleIn("landlord")) expect(names).toContain(landlord.name);
    // People who are only renters aren't listed here.
    expect(names).not.toContain(PEOPLE.kari.name);
    expect(names).not.toContain(PEOPLE.magnus.name);

    // An account: city and properties under the name, no badge but the role.
    const jon = await findCard(page, "landlord", PEOPLE.jon.name);
    expect(await cardSubtitle(jon)).toBe("Selfoss · 1 property");
    expect(await cardMeta(jon)).toEqual(["Landlord"]);
    await expect(jon).toContainText("4 · 1 review");
    await expect(jon).toContainText(PEOPLE.jon.bio);

    // Someone with both roles.
    const olafur = await findCard(page, "landlord", PEOPLE.olafur.name);
    expect(await cardSubtitle(olafur)).toBe("Akureyri · 1 property");
    expect(await cardMeta(olafur)).toEqual(["Landlord", "· Also a renter"]);

    // An account with no properties shows just the city; no reviews yet.
    const helga = await findCard(page, "landlord", PEOPLE.helga.name);
    expect(await cardSubtitle(helga)).toBe("Hafnarfjörður");
    await expect(helga).toContainText("No reviews yet");
    expect(await cardMeta(helga)).toEqual(["Landlord"]);

    // Profiles without an account (a person and a company): no city or bio, a "No account" badge.
    const gunnar = await findCard(page, "landlord", PEOPLE.gunnar.name);
    expect(await cardSubtitle(gunnar)).toBe("1 property");
    expect(await cardMeta(gunnar)).toEqual(["Landlord", "No account"]);
    await expect(gunnar).toContainText("2.5 · 2 reviews");
    const company = await findCard(page, "landlord", PEOPLE.leigufelag.name);
    expect(await cardSubtitle(company)).toBe("2 properties");
    expect(await cardMeta(company)).toEqual(["Landlord", "No account"]);

    await (await findCard(page, "landlord", PEOPLE.jon.name)).click();
    await expect(page).toHaveURL(/\/landlords\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: PEOPLE.jon.name })).toBeVisible();
  });

  test("the renters directory lists everyone who's a renter, with or without an account", async ({ page }) => {
    await page.goto("/renters");
    await expect(page).toHaveTitle("Renters · GossipRent");
    // Renters are private people: the directory isn't indexed.
    await expect(robotsMeta(page)).toHaveAttribute("content", "noindex, nofollow");
    const total = await directoryTotal(page, "/renters");

    const names = await allCardNames(page, "/renters?sort=name");
    expect(names).toHaveLength(total);
    expect(new Set(names).size).toBe(total);
    for (const renter of demoPeopleIn("renter")) expect(names).toContain(renter.name);
    expect(names).not.toContain(PEOPLE.jon.name);
    expect(names).not.toContain(PEOPLE.gunnar.name);

    // A renter card has the city (no property count) under the name.
    const kari = await findCard(page, "renter", PEOPLE.kari.name);
    expect(await cardSubtitle(kari)).toBe("Kópavogur");
    expect(await cardMeta(kari)).toEqual(["Renter"]);
    const olafur = await findCard(page, "renter", PEOPLE.olafur.name);
    expect(await cardMeta(olafur)).toEqual(["Renter", "· Also a landlord"]);
    await expect(olafur).toContainText("4 · 1 review");
    for (const key of ["magnus", "david"] as const) {
      const card = await findCard(page, "renter", PEOPLE[key].name);
      expect(await cardSubtitle(card), key).toBeNull();
      expect(await cardMeta(card), key).toEqual(["Renter", "No account"]);
    }
  });

  test("renters directory searches by city without accents, sorts, and remembers the form", async ({ page }) => {
    await page.goto("/renters");
    const search = page.getByRole("search");
    await search.getByRole("searchbox").fill("Kopavogur");
    await search.getByLabel("Sort by").selectOption("newest");
    await search.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/renters\?q=Kopavogur&sort=newest$/);
    await expect(page.getByText("2 renters matching “Kopavogur”")).toBeVisible();
    // Sunna joined more recently than Kári; both live in Kópavogur.
    expect(await cardNames(page)).toEqual([PEOPLE.sunna.name, PEOPLE.kari.name]);

    await page.getByLabel("Sort by").selectOption("name");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/renters\?q=Kopavogur&sort=name$/);
    expect(await cardNames(page)).toEqual([PEOPLE.kari.name, PEOPLE.sunna.name]);
    // The form remembers the query and sort.
    await expect(searchBox(page)).toHaveValue("Kopavogur");
    await expect(page.getByLabel("Sort by")).toHaveValue("name");

    await page.getByRole("link", { name: "Clear search" }).click();
    await expect(page).toHaveURL(/\/renters$/);
    await expect(searchBox(page)).toHaveValue("");
  });

  test("names are found without their accents, and with them", async ({ page }) => {
    for (const [path, query, name] of [
      ["/renters", "Thordis", PEOPLE.thordis.name],
      ["/renters", "ÞÓRDÍS", PEOPLE.thordis.name],
      ["/renters", "johannsdottir", PEOPLE.thordis.name],
      ["/renters", "Asdis", PEOPLE.asdis.name],
      ["/renters", "Gudmundsdottir", PEOPLE.eva.name],
      ["/landlords", "Daemi", PEOPLE.leigufelag.name],
      ["/landlords", "petursson", PEOPLE.gunnar.name],
      ["/landlords", "Jón Selfoss", PEOPLE.jon.name],
    ] as const) {
      await page.goto(`${path}?q=${encodeURIComponent(query)}`);
      const noun = path === "/renters" ? "renter" : "landlord";
      await expect(page.getByText(`1 ${noun} matching “${query}”`), query).toBeVisible();
      expect(await cardNames(page), query).toEqual([name]);
    }
    // Both of Ólafur's roles are found the same way.
    for (const path of ["/landlords", "/renters"]) {
      await page.goto(`${path}?q=olafur`);
      await expect(personCard(page, PEOPLE.olafur.name)).toBeVisible();
    }
  });

  test("a directory search with no matches shows an empty state and ways forward", async ({ page }) => {
    await page.goto("/landlords?q=zzz-no-such-landlord");
    await expect(page.getByText("0 landlords matching “zzz-no-such-landlord”")).toBeVisible();
    await expect(page.getByText("No landlords match “zzz-no-such-landlord”")).toBeVisible();
    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: "Write a review" })).toHaveAttribute("href", "/reviews/new?kind=landlord");
    await expect(main.getByRole("link", { name: "Review the place you rented instead" })).toHaveAttribute(
      "href",
      "/properties/new",
    );

    await page.goto("/renters?q=zzz-no-such-renter");
    await expect(page.getByText("No renters match “zzz-no-such-renter”")).toBeVisible();
    await expect(main.getByRole("link", { name: "Write a review" })).toHaveAttribute("href", "/reviews/new?kind=renter");
    await expect(main.getByRole("link", { name: "Review the place you rented instead" })).toHaveCount(0);
  });

  test("a profile made by a review is listed with a No account badge and found by name", async ({ browser, page }) => {
    const token = nameToken();
    const renter = await createActor(browser, "renter");
    const landlord = await createActor(browser, "landlord");
    const [newLandlord] = (
      await createProfilesWithoutAccount(renter.page, "landlord", [{ name: `Gígja ${token}` }])
    ).values();
    const [newRenter] = (await createProfilesWithoutAccount(landlord.page, "renter", [{ name: `Hörður ${token}` }])).values();
    await renter.context.close();
    await landlord.context.close();

    // Searched without accents ("gigja", "hordur"); no city, so the landlord card says "No properties yet".
    await page.goto(`/landlords?q=${encodeURIComponent(`gigja ${token}`)}`);
    const landlordCard = personCard(page, `Gígja ${token}`);
    await expect(landlordCard).toHaveAttribute("href", newLandlord.path);
    expect(await cardSubtitle(landlordCard)).toBe("No properties yet");
    expect(await cardMeta(landlordCard)).toEqual(["Landlord", "No account"]);
    await expect(landlordCard).toContainText("4 · 1 review");

    await page.goto(`/renters?q=${encodeURIComponent(`hordur ${token}`)}`);
    const renterCard = personCard(page, `Hörður ${token}`);
    await expect(renterCard).toHaveAttribute("href", newRenter.path);
    expect(await cardSubtitle(renterCard)).toBeNull();
    expect(await cardMeta(renterCard)).toEqual(["Renter", "No account"]);

    // The kennitala the reviews were written with is never on the pages.
    for (const [path, kennitala] of [
      [`/landlords?q=${token}`, newLandlord.kennitala],
      [`/renters?q=${token}`, newRenter.kennitala],
      [`/search?q=${token}`, newRenter.kennitala],
      [newLandlord.path, newLandlord.kennitala],
      [newRenter.path, newRenter.kennitala],
    ]) {
      await page.goto(path);
      const html = await page.content();
      for (const variant of kennitalaVariants(kennitala)) expect(html, path).not.toContain(variant);
    }
  });
});

test.describe("landlord directory sorting", () => {
  // Created landlords that only a search for the token finds:
  // Ösp 5★ (1 review), Bára 4★ + 5★ (2 reviews), Ágúst 3★ (1 review): profiles
  // without an account, made in that order by renters' reviews; then Atli, an
  // account with no reviews (and the city Testbær), signs up last.
  const token = nameToken();
  const osp = `Ösp ${token}`;
  const bara = `Bára ${token}`;
  const agust = `Ágúst ${token}`;
  const atli = `Atli ${token}`;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const first = await createActor(browser, "renter");
    const second = await createActor(browser, "renter");
    const made = await createProfilesWithoutAccount(first.page, "landlord", [
      { name: osp, stars: 5 },
      { name: bara, stars: 4 },
      { name: agust, stars: 3 },
    ]);
    await writeReviewByKennitala(second.page, "landlord", { kennitala: made.get(bara)!.kennitala }, anyReview(5));
    await first.context.close();
    await second.context.close();
    await signUpSomeone(browser, "landlord", atli);
  });

  test("top rated (the default), most reviewed, newest and A–Z", async ({ page }) => {
    await page.goto(`/landlords?q=${token}`);
    await expect(page.getByText(`4 landlords matching “${token}”`)).toBeVisible();
    await expect(page.getByLabel("Sort by")).toHaveValue("top");
    // Highest average first; no reviews last.
    expect(await cardNames(page)).toEqual([osp, bara, agust, atli]);
    await expect(personCard(page, bara)).toContainText("4.5 · 2 reviews");
    await expect(personCard(page, atli)).toContainText("No reviews yet");
    expect(await cardSubtitle(personCard(page, atli))).toBe("Testbær");
    expect(await cardMeta(personCard(page, atli))).toEqual(["Landlord"]);
    expect(await cardMeta(personCard(page, osp))).toEqual(["Landlord", "No account"]);

    // The sort is a form field: pick one and search.
    await page.getByLabel("Sort by").selectOption("most");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(new RegExp(`/landlords\\?q=${token}&sort=most$`));
    // Most reviews first, then the higher rating.
    expect(await cardNames(page)).toEqual([bara, osp, agust, atli]);

    await page.goto(`/landlords?q=${token}&sort=newest`);
    expect(await cardNames(page)).toEqual([atli, agust, bara, osp]);

    // A–Z is Icelandic alphabetical order: A before Á, and Ö at the very end.
    await page.goto(`/landlords?q=${token}&sort=name`);
    await expect(page.getByLabel("Sort by")).toHaveValue("name");
    await expect(page.getByLabel("Sort by").locator("option:checked")).toHaveText("A–Z");
    expect(await cardNames(page)).toEqual([atli, agust, bara, osp]);
  });

  test("an unknown sort falls back to top rated", async ({ page }) => {
    await page.goto(`/landlords?q=${token}&sort=bogus`);
    await expect(page.getByLabel("Sort by")).toHaveValue("top");
    expect(await cardNames(page)).toEqual([osp, bara, agust, atli]);
  });
});

test.describe("renters A–Z and pagination", () => {
  // Thirteen renters whose names share a token: one more than a page (12).
  // Their first names in Icelandic alphabetical order (A, Á, …, O, Ó, …, U, Ú,
  // Y, Ý, Z, Þ, Æ, Ö), lower case included. Four are accounts; the rest are
  // profiles a landlord's reviews made.
  const token = nameToken();
  const IN_ORDER = ["anna", "Atli", "Ágústa", "Baldur", "Oddur", "Ólöf", "Unnur", "Úlfar", "Ýmir", "Zophonías", "Þóra", "Ægir", "Örn"].map(
    (first) => `${first} ${token}`,
  );
  const WITH_ACCOUNT = new Set(["anna", "Ólöf", "Þóra", "Örn"].map((first) => `${first} ${token}`));
  // Created in this (scrambled) order, so "newest" differs from A–Z.
  const CREATED = ["Örn", "Baldur", "anna", "Ýmir", "Ágústa", "Þóra", "Oddur", "Zophonías", "Atli", "Ólöf", "Úlfar", "Ægir", "Unnur"].map(
    (first) => `${first} ${token}`,
  );

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    const landlord = await createActor(browser, "landlord");
    for (const name of CREATED) {
      if (WITH_ACCOUNT.has(name)) await signUpSomeone(browser, "renter", name);
      else await createProfilesWithoutAccount(landlord.page, "renter", [{ name, stars: 3 }]);
    }
    await landlord.context.close();
  });

  test("A–Z sorts names in Icelandic order, ignoring case", async ({ page }) => {
    await page.goto(`/renters?q=${token}&sort=name`);
    await expect(page.getByText(`13 renters matching “${token}”`)).toBeVisible();
    // Byte order would put "anna" after "Ægir", and Á, Ó, Ú, Ý, Þ, Æ, Ö after Z.
    expect(await cardNames(page)).toEqual(IN_ORDER.slice(0, 12));
    for (const name of IN_ORDER.slice(0, 12)) {
      expect(await cardMeta(personCard(page, name)), name).toEqual(
        WITH_ACCOUNT.has(name) ? ["Renter"] : ["Renter", "No account"],
      );
    }
    await page.goto(`/renters?q=${token}&sort=name&page=2`);
    expect(await cardNames(page)).toEqual(IN_ORDER.slice(12));
  });

  test("newest first", async ({ page }) => {
    await page.goto(`/renters?q=${token}&sort=newest`);
    expect(await cardNames(page)).toEqual([...CREATED].reverse().slice(0, 12));
  });

  test("Previous and Next links page through the results, keeping the search and sort", async ({ page }) => {
    await page.goto(`/renters?q=${token}&sort=name`);
    const pagination = page.getByRole("navigation", { name: "Pagination" });
    await expect(pagination.getByText("Page 1 of 2")).toBeVisible();
    await expect(page.locator("main ul > li > a")).toHaveCount(12);
    // No "Previous" link on the first page.
    await expect(pagination.getByRole("link", { name: "← Previous" })).toHaveCount(0);
    const next = pagination.getByRole("link", { name: "Next →" });
    await expect(next).toHaveAttribute("href", `/renters?q=${token}&sort=name&page=2`);

    await next.click();
    await expect(page).toHaveURL(new RegExp(`/renters\\?q=${token}&sort=name&page=2$`));
    await expect(pagination.getByText("Page 2 of 2")).toBeVisible();
    await expect(page.locator("main ul > li > a")).toHaveCount(1);
    await expect(pagination.getByRole("link", { name: "Next →" })).toHaveCount(0);
    // The search box and sort still say what's being paged through.
    await expect(searchBox(page)).toHaveValue(token);
    await expect(page.getByLabel("Sort by")).toHaveValue("name");

    await pagination.getByRole("link", { name: "← Previous" }).click();
    await expect(page).toHaveURL(new RegExp(`/renters\\?q=${token}&sort=name$`));
    await expect(page.locator("main ul > li > a")).toHaveCount(12);
  });

  test("a page past the end redirects to the last page, keeping the search and sort", async ({ page, request }) => {
    const response = await request.get(`/renters?q=${token}&sort=name&page=3`, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toBe(`/renters?q=${token}&sort=name&page=2`);
    await page.goto(`/renters?q=${token}&sort=name&page=99`);
    await expect(page).toHaveURL(new RegExp(`/renters\\?q=${token}&sort=name&page=2$`));
    expect(await cardNames(page)).toEqual(IN_ORDER.slice(12));
  });

  test("search shows the first six and links to all of them", async ({ page }) => {
    await page.goto(`/search?q=${token}`);
    await expect(page.getByRole("heading", { level: 1, name: `Results for “${token}”` })).toBeVisible();
    await expect(page.getByText("13 matches")).toBeVisible();
    const renters = page.getByRole("region", { name: "Renters" });
    await expect(renters.getByRole("heading", { name: "Renters (13)" })).toBeVisible();
    await expect(renters.locator("ul > li > a")).toHaveCount(6);
    await expect(renters.getByRole("link", { name: "See all 13 →" })).toHaveAttribute("href", `/renters?q=${token}`);
    await expect(page.getByRole("region", { name: "Landlords" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Properties" })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

test.describe("properties directory", () => {
  test("lists every property with its address, place, rating and landlord", async ({ page }) => {
    await page.goto("/properties");
    await expect(page).toHaveTitle("Properties · GossipRent");
    await expect(robotsMeta(page)).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("link", { name: "Add a property" }).first()).toHaveAttribute(
      "href",
      "/properties/new",
    );
    expect(await directoryTotal(page, "/properties")).toBeGreaterThanOrEqual(DEMO_COUNTS.properties);

    // Each demo property, found by its address: street line (with "apt." for an
    // apartment number), then postcode and place.
    for (const property of Object.values(PROPERTIES)) {
      await page.goto(`/properties?q=${encodeURIComponent(property.address)}`);
      await expect(propertyCard(page, property), property.address).toBeVisible();
      await expect(propertyCard(page, property)).toContainText(property.description);
    }
    expect(propertyLabel(PROPERTIES.njalsgata)).toBe("Njálsgata 23, apt. 0201");

    // A landlord with an account.
    await page.goto("/properties?q=Austurvegur");
    const austurvegur = propertyCard(page, PROPERTIES.austurvegur);
    await expect(austurvegur).toContainText("800 Selfoss");
    await expect(austurvegur).toContainText(`Landlord: ${PEOPLE.jon.name}`);
    await expect(austurvegur).toContainText("4 · 1 review");
    await expect(austurvegur.getByRole("img", { name: "Rated 4 out of 5 stars" })).toBeVisible();

    // A landlord a renter named, who has no account: not confirmed.
    await page.goto("/properties?q=Hamraborg");
    const hamraborg = propertyCard(page, PROPERTIES.hamraborg);
    await expect(hamraborg).toContainText("Hamraborg 14, apt. 0503");
    await expect(hamraborg).toContainText("200 Kópavogur");
    await expect(hamraborg).toContainText(`Landlord: ${PEOPLE.gunnar.name} (not confirmed)`);

    await hamraborg.click();
    await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Hamraborg 14, apt. 0503" })).toBeVisible();
  });

  test("a property with no landlord linked says so", async ({ browser, page }) => {
    const renter = await createActor(browser, "renter");
    const property = makeProperty({ unit: "2nd floor left" });
    await addProperty(renter.page, property);
    await renter.context.close();

    await page.goto(`/properties?q=${encodeURIComponent(property.address)}`);
    await expect(page.getByText(`1 property matching “${property.address}”`)).toBeVisible();
    const card = propertyCard(page, property);
    // A unit that isn't an apartment number is shown as typed.
    await expect(card).toContainText(`${property.address}, 2nd floor left`);
    await expect(card).toContainText("Landlord not on GossipRent yet");
    await expect(card).toContainText("No reviews yet");
  });

  test("searches by address, apartment, postcode and town, with or without accents", async ({ page }) => {
    for (const [query, property] of [
      ["Njalsgata", PROPERTIES.njalsgata],
      ["NJÁLSGATA 23", PROPERTIES.njalsgata],
      ["Njálsgata 23 0201", PROPERTIES.njalsgata],
      ["thorunnarstraeti", PROPERTIES.thorunnarstraeti],
      ["ÞÓRUNNARSTRÆTI 112", PROPERTIES.thorunnarstraeti],
      ["0503", PROPERTIES.hamraborg],
      ["200", PROPERTIES.hamraborg],
      ["Kopavogur", PROPERTIES.hamraborg],
      ["Hafnarfjörður", PROPERTIES.strandgata],
      ["Reykjanesbaer", PROPERTIES.hafnargata],
      ["Selfoss", PROPERTIES.austurvegur],
      // Words are matched across the address, postcode and town.
      ["Njalsgata 23, 101 Reykjavik", PROPERTIES.njalsgata],
      ["Hringbraut 79 Reykjavík", PROPERTIES.hringbraut],
      ["Strandgata 220", PROPERTIES.strandgata],
    ] as const) {
      await page.goto(`/properties?q=${encodeURIComponent(query)}`);
      await expect(page.getByText(`1 property matching “${query}”`), query).toBeVisible();
      await expect(propertyCard(page, property), query).toBeVisible();
    }

    // Every word has to match somewhere.
    await page.goto(`/properties?q=${encodeURIComponent("Njalsgata Akureyri")}`);
    await expect(page.getByText("0 properties matching “Njalsgata Akureyri”")).toBeVisible();
    await expect(page.getByText("No properties match “Njalsgata Akureyri”")).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Add the place you rent" })).toHaveAttribute(
      "href",
      "/properties/new",
    );
  });

  test("the address exactly as the site shows it finds the property", async ({ page }) => {
    // What cards, page titles and review cards show, in English and in Icelandic.
    for (const [query, property] of [
      ["Njálsgata 23, apt. 0201", PROPERTIES.njalsgata],
      ["Njálsgata 23, apt. 0201, 101 Reykjavík", PROPERTIES.njalsgata],
      ["Hamraborg 14, apt. 0503, 200 Kópavogur", PROPERTIES.hamraborg],
      ["Njálsgata 23, íbúð 0201", PROPERTIES.njalsgata],
      ["Hamraborg 14, íbúð 0503, 200 Kópavogur", PROPERTIES.hamraborg],
    ] as const) {
      await page.goto(`/properties?q=${encodeURIComponent(query)}`);
      await expect(page.getByText(`1 property matching “${query}”`), query).toBeVisible();
      await expect(propertyCard(page, property), query).toBeVisible();
    }
    await page.goto(`/search?q=${encodeURIComponent(propertyAddressText(PROPERTIES.njalsgata))}`);
    await expect(page.getByRole("region", { name: "Properties" }).getByRole("heading", { name: "Properties (1)" })).toBeVisible();
  });

  test("names and places with Greek or Turkish capitals can be found as typed", async ({ browser, page }) => {
    const renter = await createActor(browser, "renter");
    const token = `U${uid()}`;
    const greek: NewProperty = { address: `${token} ΟΔΟΣ ΕΡΜΟΥ 5`, postalCode: "101" };
    const turkish: NewProperty = { address: `${token} İstiklal Caddesi 7`, postalCode: "101" };
    for (const property of [greek, turkish]) await addProperty(renter.page, property);
    await renter.context.close();
    for (const [query, count] of [
      [`${token} ΟΔΟΣ`, 1],
      [`${token} οδος`, 1],
      [`${token} İstiklal`, 1],
      [`${token} Reykjavík`, 2],
      [`${token} ΕΡΜΟΥ`, 1],
    ] as const) {
      await page.goto(`/properties?q=${encodeURIComponent(query)}`);
      await expect(page.getByText(new RegExp(`^${count} propert(y|ies) matching`)), query).toBeVisible();
    }
  });

  test("A–Z sorts addresses in Icelandic order and house numbers by value", async ({ browser, page }) => {
    test.setTimeout(120_000);
    const token = nameToken();
    const IN_ORDER = [
      `Aðalstræti ${token} 9`,
      `Aðalstræti ${token} 10`,
      `Aðalstræti ${token} 100`,
      `Austurvegur ${token} 2`,
      `Álfheimar ${token} 3`,
      `ofanleiti ${token} 1`,
      `Óðinsgata ${token} 7`,
      `Zimsensbraut ${token} 6`,
      `Þingholtsstræti ${token} 4`,
      `Öldugata ${token} 8`,
    ];
    const renter = await createActor(browser, "renter");
    // Added out of order.
    for (const index of [9, 4, 2, 7, 0, 5, 8, 1, 6, 3]) {
      await addProperty(renter.page, { address: IN_ORDER[index], postalCode: "101" });
    }
    await renter.context.close();

    await page.goto(`/properties?q=${token}&sort=name`);
    await expect(page.getByText(`10 properties matching “${token}”`)).toBeVisible();
    // Byte order would put "100" before "9", lower case after Z, and Á, Ó, Þ, Ö after Z too.
    expect(await cardNames(page)).toEqual(IN_ORDER);
  });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

test.describe("search", () => {
  test("home search finds landlords, renters, and properties", async ({ page }) => {
    await page.goto("/");
    await homeSearchBox(page).fill("Akureyri");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/\/search\?q=Akureyri$/);
    await expect(page).toHaveTitle("Search · GossipRent");
    await expect(robotsMeta(page)).toHaveAttribute("content", "noindex, follow");
    await expect(page.getByRole("heading", { level: 1, name: "Results for “Akureyri”" })).toBeVisible();
    await expect(page.getByText("4 matches")).toBeVisible();
    await expect(searchBox(page)).toHaveValue("Akureyri");

    const landlords = page.getByRole("region", { name: "Landlords" });
    await expect(landlords.getByRole("heading", { name: "Landlords (1)" })).toBeVisible();
    await expect(personCard(landlords, PEOPLE.olafur.name)).toHaveAttribute("href", /^\/landlords\//);

    const properties = page.getByRole("region", { name: "Properties" });
    await expect(properties.getByRole("heading", { name: "Properties (1)" })).toBeVisible();
    await expect(propertyCard(properties, PROPERTIES.thorunnarstraeti)).toBeVisible();

    // Ólafur is both, so he's in both groups, each linking to that role's page.
    const renters = page.getByRole("region", { name: "Renters" });
    await expect(renters.getByRole("heading", { name: "Renters (2)" })).toBeVisible();
    await expect(personCard(renters, PEOPLE.olafur.name)).toHaveAttribute("href", /^\/renters\//);
    await personCard(renters, PEOPLE.birta.name).click();
    await expect(page.getByRole("heading", { level: 1, name: PEOPLE.birta.name })).toBeVisible();
  });

  test("search ignores case and accents, and matches part of a name", async ({ page }) => {
    await page.goto("/search?q=%20%20thÓrDIS%20");
    await expect(page.getByRole("heading", { level: 1, name: "Results for “thÓrDIS”" })).toBeVisible();
    await expect(personCard(page.getByRole("region", { name: "Renters" }), PEOPLE.thordis.name)).toBeVisible();

    await page.goto("/search?q=Kopavogur");
    await expect(page.getByText("3 matches")).toBeVisible();
    await expect(propertyCard(page.getByRole("region", { name: "Properties" }), PROPERTIES.hamraborg)).toBeVisible();
    const renters = page.getByRole("region", { name: "Renters" });
    await expect(personCard(renters, PEOPLE.kari.name)).toBeVisible();
    await expect(personCard(renters, PEOPLE.sunna.name)).toBeVisible();

    await page.goto("/search?q=helgad");
    await expect(personCard(page.getByRole("region", { name: "Landlords" }), PEOPLE.sigrun.name)).toBeVisible();
  });

  test("search with no results suggests adding a property", async ({ page }) => {
    await page.goto("/search?q=qqq-nothing-here");
    await expect(page.getByText("0 matches")).toBeVisible();
    await expect(page.getByText("Nothing matched your search")).toBeVisible();
    await expect(page.getByRole("link", { name: "Add it" })).toHaveAttribute("href", "/properties/new");
  });

  test("LIKE wildcards in the query are matched literally", async ({ page }) => {
    for (const q of ["%", "_", "%%", "\\"]) {
      await page.goto(`/search?q=${encodeURIComponent(q)}`);
      await expect(page.getByText("Nothing matched your search"), `query ${JSON.stringify(q)}`).toBeVisible();
    }
  });

  // Regression: Postgres can't store or compare "\u0000", so a query containing
  // it used to crash every search/directory page with a 500.
  test("a query containing a NUL character doesn't crash search or the directories", async ({ page }) => {
    for (const path of ["/search?q=%00", "/search?q=abc%00", "/landlords?q=%00", "/renters?q=a%00b", "/properties?q=%00", "/?q=%00"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      await expect(page.getByRole("heading", { name: "Something went wrong" }), path).toHaveCount(0);
    }
    // The NUL is simply dropped: "Thor\0dis" searches for "Thordis".
    await page.goto("/search?q=Thor%00dis");
    await expect(page.getByRole("heading", { level: 1, name: "Results for “Thordis”" })).toBeVisible();
    await expect(personCard(page.getByRole("region", { name: "Renters" }), PEOPLE.thordis.name)).toBeVisible();
    // A query that's nothing but NULs is an empty search.
    await page.goto("/search?q=%00%00");
    await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
  });

  test("words are matched across fields: a name and a town find that person", async ({ page }) => {
    await page.goto(`/landlords?q=${encodeURIComponent("Sigrun Reykjavik")}`);
    await expect(page.getByText("1 landlord matching “Sigrun Reykjavik”")).toBeVisible();
    expect(await cardNames(page)).toEqual([PEOPLE.sigrun.name]);
    await page.goto(`/renters?q=${encodeURIComponent("Kári, Kópavogur")}`);
    await expect(page.getByText("1 renter matching “Kári, Kópavogur”")).toBeVisible();
    expect(await cardNames(page)).toEqual([PEOPLE.kari.name]);
    // Every word has to match somewhere.
    await page.goto(`/renters?q=${encodeURIComponent("Kári Akureyri")}`);
    await expect(page.getByText("0 renters matching “Kári Akureyri”")).toBeVisible();
    // Properties are searched by address, postcode and town only, not by their landlord's name.
    await page.goto(`/properties?q=${encodeURIComponent("Hringbraut Sigrún")}`);
    await expect(page.getByText("0 properties matching “Hringbraut Sigrún”")).toBeVisible();
  });

  test("an empty search shows just the search form and the lookup", async ({ page }) => {
    await page.goto("/search?q=%20%20");
    await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
    await expect(page.getByText("Find landlords, renters, and properties by name, city, or address.")).toBeVisible();
    await expect(searchBox(page)).toHaveValue("");
    await expect(page.getByText(/matches?$/)).toHaveCount(0);
    await expect(lookupSection(page)).toBeVisible();
    // The pointer to the lookup only shows after a kennitala was typed into a search box.
    await expect(page.getByText(KENNITALA_POINTER)).toHaveCount(0);
  });

  test("a punctuation-only search (“,”) shows the empty search page, not every result", async ({ page }) => {
    for (const q of ["%2C", "%20%2C%20%2C%2C%20", "%2C%0A%09"]) {
      await page.goto(`/search?q=${q}`);
      await expect(page.getByRole("heading", { level: 1, name: "Search" }), q).toBeVisible();
      await expect(searchBox(page), q).toHaveValue("");
      await expect(page.getByText(/matches?$/), q).toHaveCount(0);
      await expect(page.getByRole("heading", { name: /^Results for/ }), q).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Landlords" }), q).toHaveCount(0);
    }
  });

  test("a punctuation-only filter on a directory is ignored", async ({ page }) => {
    const all = await directoryTotal(page, "/landlords");
    await page.goto("/landlords?q=%2C");
    await expect(page.getByText(/matching “/)).toHaveCount(0);
    expect(await directoryTotal(page, "/landlords?q=%2C")).toBe(all);
    await page.goto("/properties?q=%2C%2C");
    await expect(page.getByText(/matching “/)).toHaveCount(0);
  });

  test("a search of more than 100 characters is cut without leaving half an emoji", async ({ page }) => {
    const query = `${"x".repeat(99)}😀`;
    const response = await page.goto(`/search?q=${encodeURIComponent(query)}`);
    expect(response?.status()).toBe(200);
    const shown = await searchBox(page).inputValue();
    expect(shown.startsWith("x".repeat(99))).toBe(true);
    expect(shown.isWellFormed()).toBe(true);
    await expect(page.getByText("Nothing matched your search")).toBeVisible();
  });

  test("repeating a word doesn't change the results", async ({ page }) => {
    await page.goto(`/landlords?q=${encodeURIComponent("helgadottir HELGADÓTTIR Helgadóttir")}`);
    await expect(page.getByText("1 landlord matching “helgadottir HELGADÓTTIR Helgadóttir”")).toBeVisible();
    // Repeats don't use up the 8-word limit either: a word after 10 repeats still counts.
    const query = `${"a ".repeat(10)}Helgadottir`;
    await page.goto(`/landlords?q=${encodeURIComponent(query)}`);
    await expect(personCard(page, PEOPLE.sigrun.name)).toBeVisible();
    await expect(page.getByText(/^1 landlord matching/)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// A kennitala typed into a search box
// ---------------------------------------------------------------------------

test.describe("a kennitala typed into a search box", () => {
  // A kennitala is never searched for, echoed ("Results for …") or put in a
  // URL: search boxes are GET forms, so the number goes to the lookup form instead.
  const kennitala = PEOPLE.gunnar.kennitala;
  const typed = formatKennitala(kennitala);

  test("on the home page, it's moved into the lookup form and nothing is sent", async ({ page }) => {
    await page.goto("/");
    const requests = watchRequests(page);
    await homeSearchBox(page).fill(typed);
    await page.getByRole("button", { name: "Search", exact: true }).click();

    await expect(lookupField(page)).toBeFocused();
    await expect(lookupField(page)).toHaveValue(typed);
    await expect(homeSearchBox(page)).toHaveValue("");
    await expect(page.getByText(KENNITALA_POINTER)).toBeVisible();
    await expect(page).toHaveURL("/");
    expectNoKennitalaIn(requests, kennitala);
    expectNoKennitalaIn([page.url()], kennitala);

    // An ordinary search from the same box still goes to the results.
    await homeSearchBox(page).fill("Akureyri");
    await homeSearchBox(page).press("Enter");
    await expect(page).toHaveURL(/\/search\?q=Akureyri$/);
    await expect(page.getByRole("heading", { level: 1, name: "Results for “Akureyri”" })).toBeVisible();
    expectNoKennitalaIn(requests, kennitala);
  });

  test("on /search, it's moved into the lookup form and the results stay", async ({ page }) => {
    await page.goto("/search?q=Akureyri");
    const requests = watchRequests(page);
    await searchBox(page).fill(`kt. ${kennitala.slice(0, 6)} ${kennitala.slice(6)}`);
    await searchBox(page).press("Enter");

    await expect(lookupField(page)).toBeFocused();
    await expect(lookupField(page)).toHaveValue(`kt. ${kennitala.slice(0, 6)} ${kennitala.slice(6)}`);
    await expect(page.getByText(KENNITALA_POINTER)).toBeVisible();
    await expect(page).toHaveURL(/\/search\?q=Akureyri$/);
    await expect(page.getByRole("heading", { level: 1, name: "Results for “Akureyri”" })).toBeVisible();
    expectNoKennitalaIn(requests, kennitala);
  });

  for (const path of ["/landlords", "/renters", "/properties"]) {
    test(`in the ${path} filter bar, it leads to the lookup form without the number`, async ({ page }) => {
      await page.goto(path);
      const requests = watchRequests(page);
      await searchBox(page).fill(`${PEOPLE.gunnar.name} ${kennitala}`);
      await page.getByRole("search").getByRole("button", { name: "Search" }).click();

      await expect(page).toHaveURL(/\/search\?kt=1$/);
      await expect(page.getByText(KENNITALA_POINTER)).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
      await expect(lookupField(page)).toHaveValue("");
      await expect(searchBox(page)).toHaveValue("");
      expectNoKennitalaIn(requests, kennitala);
      const html = await page.content();
      for (const variant of kennitalaVariants(kennitala)) expect(html).not.toContain(variant);
    });
  }

  test("a kennitala in ?q= is redirected to the lookup form before anything is searched", async ({ request }) => {
    const shapes = [kennitala, typed, `kt. ${kennitala.slice(0, 6)} ${kennitala.slice(6)}`, `Jón ${kennitala}`, NOT_A_KENNITALA];
    const urls = [
      ...shapes.map((shape) => `/?q=${encodeURIComponent(shape)}`),
      ...shapes.map((shape) => `/search?q=${encodeURIComponent(shape)}`),
      `/landlords?q=${encodeURIComponent(typed)}`,
      `/renters?q=${encodeURIComponent(typed)}&sort=name&page=2`,
      `/properties?q=${encodeURIComponent(typed)}`,
      // Hidden behind another value of the same parameter.
      `/search?q=Akureyri&q=${kennitala}`,
    ];
    for (const url of urls) {
      const response = await request.get(url, { maxRedirects: 0 });
      expect(response.status(), url).toBe(307);
      expect(response.headers()["location"], url).toBe("/search?kt=1");
    }
    // Other numbers are just searched: a phone number, a postcode, a house number.
    for (const q of ["5551234", "101", "Hringbraut 79", "123456"]) {
      const response = await request.get(`/search?q=${encodeURIComponent(q)}`, { maxRedirects: 0 });
      expect(response.status(), q).toBe(200);
    }
  });

  test("/search?kt=1 points to the lookup form", async ({ page }) => {
    await page.goto("/search?kt=1");
    await expect(page.getByText(KENNITALA_POINTER)).toBeVisible();
    await expect(lookupSection(page)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
  });

  test("logged out, the lookup form asks you to log in and brings you back", async ({ page }) => {
    for (const [path, next] of [
      ["/", "%2F"],
      ["/search", "%2Fsearch"],
    ]) {
      await page.goto(path);
      await lookUpKennitala(page, typed);
      const alert = lookupSection(page).getByRole("alert");
      await expect(alert).toContainText("Log in to look up a kennitala.");
      await expect(alert.getByRole("link", { name: "Log in" })).toHaveAttribute("href", `/login?next=${next}`);
      expectNoKennitalaIn([page.url()], kennitala);
      // The hint is replaced by the message.
      await expect(lookupSection(page).getByText("You need to log in to look up a kennitala.")).toHaveCount(0);
    }
  });

  test("logged in, the number handed over from the search box finds the person's page", async ({ page }) => {
    const gunnarPath = await demoProfilePath(page, "gunnar");
    await logInAs(page, "kari");
    await page.goto("/");
    const requests = watchRequests(page);
    await homeSearchBox(page).fill(typed);
    await homeSearchBox(page).press("Enter");
    await expect(lookupField(page)).toHaveValue(typed);
    await lookupSection(page).getByRole("button", { name: "Look up", exact: true }).click();
    await expect(page).toHaveURL(gunnarPath);
    await expect(page.getByRole("heading", { level: 1, name: PEOPLE.gunnar.name })).toBeVisible();
    expectNoKennitalaIn(requests, kennitala);

    // A number nobody has been reviewed with yet.
    await page.goto("/search");
    const unknown = freshKennitala();
    await lookUpKennitala(page, unknown);
    const answer = lookupSection(page).getByRole("status");
    await expect(answer).toContainText("Nobody with this kennitala has been reviewed yet.");
    await expect(answer.getByRole("link", { name: "Write the first review" })).toHaveAttribute("href", "/reviews/new");
    await expect(page).toHaveURL(/\/search$/);
  });
});

// ---------------------------------------------------------------------------
// Profile and property pages
// ---------------------------------------------------------------------------

test.describe("profile pages", () => {
  test("a landlord with an account: details, rating, properties, reviews, and a sign-up prompt", async ({ page }) => {
    const path = await demoProfilePath(page, "jon");
    await page.goto(path);
    await expect(page).toHaveTitle(`${PEOPLE.jon.name} — landlord reviews · GossipRent`);
    // A landlord with an account may be indexed.
    await expect(robotsMeta(page)).toHaveCount(0);
    const header = page.getByRole("main").locator("section").first();
    await expect(header.getByRole("heading", { level: 1, name: PEOPLE.jon.name })).toBeVisible();
    await expect(header.getByText("Landlord", { exact: true })).toBeVisible();
    await expect(header.getByText("No account", { exact: true })).toHaveCount(0);
    await expect(header.getByText(`Selfoss · Member since ${monthYear(daysAgo(PEOPLE.jon.joinedDaysAgo))}`, { exact: true })).toBeVisible();
    await expect(header.getByText("Identity not verified", { exact: true })).toBeVisible();
    await expect(header.getByText(PEOPLE.jon.bio)).toBeVisible();
    await expect(page.getByText(/doesn't have a GossipRent account/)).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Ratings by role" })).toHaveCount(0);

    // Rating summary: one 4-star review.
    await expect(summaryCount(page)).toHaveText("1 review");
    const breakdown = page.getByRole("list", { name: "Rating breakdown" }).getByRole("listitem");
    await expect(breakdown).toHaveCount(5);
    await expect(breakdown.nth(0)).toHaveText(/5 stars\s*0 reviews/);
    await expect(breakdown.nth(1)).toHaveText(/4 stars\s*1 review/);
    await expect(breakdown.nth(4)).toHaveText(/1 star\s*0 reviews/);

    await expect(page.getByRole("link", { name: "Report this page" })).toHaveAttribute(
      "href",
      `/report?target=profile&id=${idOf(path)}`,
    );

    // The property he manages.
    await expect(page.getByRole("heading", { name: "Properties (1)" })).toBeVisible();
    await expect(propertyCard(page, PROPERTIES.austurvegur)).toBeVisible();

    // The review, by a renter.
    await expect(page.getByRole("heading", { name: "Reviews (1)" })).toBeVisible();
    await expect(page.getByText(`${PEOPLE.jon.name}, as rated by their renters.`, { exact: true })).toBeVisible();
    const review = reviewCard(page, "Traustur og hjálpsamur");
    await expect(review.getByRole("link", { name: PEOPLE.thordis.name })).toHaveAttribute("href", /^\/renters\/[0-9a-f-]{36}$/);
    await expect(review.getByText("Renter", { exact: true })).toBeVisible();
    await expect(review.getByRole("img", { name: "Rated 4 out of 5 stars" })).toBeVisible();
    await expect(review.getByText("4/5")).toBeVisible();
    // Visitors can report other people's reviews, but not edit or delete them.
    await expect(review.getByRole("link", { name: "Report", exact: true })).toHaveAttribute(
      "href",
      /^\/report\?target=review&id=[0-9a-f-]{36}$/,
    );
    await expect(review.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(review.getByRole("link", { name: "Edit" })).toHaveCount(0);

    // Signed-out visitors are invited to sign up as a renter and come back here.
    const next = encodeURIComponent(path);
    await expect(page.getByRole("heading", { name: "Have you rented from this landlord?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign up as a renter" })).toHaveAttribute(
      "href",
      `/signup?role=renter&next=${next}`,
    );
    await expect(page.getByRole("main").getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      `/login?next=${next}`,
    );
    await expect(page.getByRole("button", { name: "Post review" })).toHaveCount(0);
    await expect(page.getByRole("radio")).toHaveCount(0);

    // Reviewer names link to their profiles.
    await review.getByRole("link", { name: PEOPLE.thordis.name }).click();
    await expect(page.getByRole("heading", { level: 1, name: PEOPLE.thordis.name })).toBeVisible();
  });

  test("a landlord without an account: No account, first reviewed, how to take the page over, noindex", async ({
    page,
  }) => {
    const path = await demoProfilePath(page, "gunnar");
    await page.goto(path);
    await expect(page).toHaveTitle(`${PEOPLE.gunnar.name} — landlord reviews · GossipRent`);
    // A person who hasn't signed up didn't choose to be here: keep the page out of search engines.
    await expect(robotsMeta(page)).toHaveAttribute("content", "noindex, nofollow");
    const header = page.getByRole("main").locator("section").first();
    await expect(header.getByRole("heading", { level: 1, name: PEOPLE.gunnar.name })).toBeVisible();
    await expect(header.getByText("No account", { exact: true })).toBeVisible();
    await expect(
      header.getByText(`First reviewed ${monthYear(daysAgo(demoFirstReviewedDaysAgo("gunnar")))}`, { exact: true }),
    ).toBeVisible();
    await expect(header.getByText(/Member since/)).toHaveCount(0);
    await expect(header.getByText("Identity not verified")).toHaveCount(0);
    await expect(
      header.getByText(
        "This person doesn't have a GossipRent account. The page was created when the first review was written, and the name is the one its author entered. Is this you? Sign up with your kennitala to take over the page. Reviews others wrote about you stay on it.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(header.getByRole("link", { name: "Sign up with your kennitala" })).toHaveAttribute("href", "/signup");

    // Ratings 2 and 3.
    await expect(summaryCount(page)).toHaveText("2 reviews");
    await expect(page.getByRole("img", { name: "Rated 2.5 out of 5 stars" }).first()).toBeVisible();
    const breakdown = page.getByRole("list", { name: "Rating breakdown" }).getByRole("listitem");
    await expect(breakdown.nth(2)).toHaveText(/3 stars\s*1 review/);
    await expect(breakdown.nth(3)).toHaveText(/2 stars\s*1 review/);
    await expect(page.locator("article")).toHaveCount(2);

    // The property a renter linked him to.
    await expect(page.getByRole("heading", { name: "Properties (1)" })).toBeVisible();
    await expect(propertyCard(page, PROPERTIES.hamraborg)).toContainText(`Landlord: ${PEOPLE.gunnar.name} (not confirmed)`);
    await expect(page.getByRole("heading", { name: "Have you rented from this landlord?" })).toBeVisible();
  });

  test("a company without an account gets the company note and may be indexed", async ({ page }) => {
    const path = await demoProfilePath(page, "leigufelag");
    await page.goto(path);
    await expect(page).toHaveTitle(`${PEOPLE.leigufelag.name} — landlord reviews · GossipRent`);
    await expect(robotsMeta(page)).toHaveCount(0);
    const header = page.getByRole("main").locator("section").first();
    await expect(header.getByText("No account", { exact: true })).toBeVisible();
    await expect(
      header.getByText(
        "This company doesn't have a GossipRent account. The page was created when the first review was written, and the name is the one its author entered.",
        { exact: true },
      ),
    ).toBeVisible();
    // A company can't sign up, so there's no "take over the page".
    await expect(header.getByRole("link", { name: "Sign up with your kennitala" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Properties (2)" })).toBeVisible();
    await expect(propertyCard(page, PROPERTIES.strandgata)).toBeVisible();
    await expect(propertyCard(page, PROPERTIES.hafnargata)).toBeVisible();
  });

  test("a name that ends in a period doesn't get a second one", async ({ page }) => {
    // Company names end in "ehf.", "hf." and so on.
    await page.goto(await demoProfilePath(page, "leigufelag"));
    await expect(page.getByText(`${PEOPLE.leigufelag.name}, as rated by their renters.`, { exact: true })).toBeVisible();
  });

  test("a renter profile shows reviews from landlords, is never indexed, and invites landlords", async ({ page }) => {
    const path = await demoProfilePath(page, "thordis");
    await page.goto(path);
    await expect(page).toHaveTitle(`${PEOPLE.thordis.name} — renter reviews · GossipRent`);
    // Renters are private people: their pages are never indexed, account or not.
    await expect(robotsMeta(page)).toHaveAttribute("content", "noindex, nofollow");
    const header = page.getByRole("main").locator("section").first();
    await expect(header.getByRole("heading", { level: 1, name: PEOPLE.thordis.name })).toBeVisible();
    await expect(header.getByText("Renter", { exact: true })).toBeVisible();
    await expect(
      header.getByText(`Selfoss · Member since ${monthYear(daysAgo(PEOPLE.thordis.joinedDaysAgo))}`, { exact: true }),
    ).toBeVisible();
    await expect(header.getByText("Identity not verified", { exact: true })).toBeVisible();
    await expect(page.getByText(`${PEOPLE.thordis.name}, as rated by their landlords.`, { exact: true })).toBeVisible();

    const review = reviewCard(page, "Mæli eindregið með");
    await expect(review.getByRole("link", { name: PEOPLE.jon.name })).toBeVisible();
    await expect(review.getByText("Landlord", { exact: true })).toBeVisible();
    await expect(review.getByRole("img", { name: "Rated 5 out of 5 stars" })).toBeVisible();
    // Renters have no properties section.
    await expect(page.getByRole("heading", { name: /^Properties/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Have you rented to this renter?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign up as a landlord" })).toHaveAttribute(
      "href",
      `/signup?role=landlord&next=${encodeURIComponent(path)}`,
    );

    // Reviewer names link to their profiles.
    await review.getByRole("link", { name: PEOPLE.jon.name }).click();
    await expect(page).toHaveURL(/\/landlords\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: PEOPLE.jon.name })).toBeVisible();
  });

  test("a renter without an account", async ({ page }) => {
    await page.goto(await demoProfilePath(page, "magnus"));
    await expect(robotsMeta(page)).toHaveAttribute("content", "noindex, nofollow");
    const header = page.getByRole("main").locator("section").first();
    await expect(header.getByText("No account", { exact: true })).toBeVisible();
    await expect(
      header.getByText(`First reviewed ${monthYear(daysAgo(demoFirstReviewedDaysAgo("magnus")))}`, { exact: true }),
    ).toBeVisible();
    await expect(header.getByText(/^This person doesn't have a GossipRent account\./)).toBeVisible();
    await expect(header.getByText("Identity not verified")).toHaveCount(0);
    await expect(reviewCard(page, "Kurteis en stundum hávaði").getByRole("link", { name: PEOPLE.sigrun.name })).toBeVisible();
    await expect(page.getByRole("link", { name: "Report this page" })).toBeVisible();
  });

  test("a profile created by a review today says when it was first reviewed", async ({ browser, page }) => {
    const renter = await createActor(browser, "renter");
    const name = `Gígja ${nameToken()}`;
    const [made] = (await createProfilesWithoutAccount(renter.page, "landlord", [{ name }])).values();
    await renter.context.close();

    await page.goto(made.path);
    await expect(robotsMeta(page)).toHaveAttribute("content", "noindex, nofollow");
    const header = page.getByRole("main").locator("section").first();
    await expect(header.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(header.getByText(`First reviewed ${monthYear(new Date())}`, { exact: true })).toBeVisible();
    await expect(header.getByText(/^This person doesn't have a GossipRent account\./)).toBeVisible();
    // Nobody linked a property yet.
    await expect(page.getByRole("heading", { name: "Properties (0)" })).toBeVisible();
    await expect(page.getByText("No properties listed yet")).toBeVisible();
  });

  test("someone with both roles has a page for each, linked by tabs with each role's rating", async ({ page }) => {
    const landlordPath = await demoProfilePath(page, "olafur", "landlord");
    await page.goto(landlordPath);
    await expect(page).toHaveTitle(`${PEOPLE.olafur.name} — landlord reviews · GossipRent`);
    await expect(robotsMeta(page)).toHaveCount(0);
    const tabs = page.getByRole("navigation", { name: "Ratings by role" });
    // "5★" is read as "5 stars" (the ★ is hidden; "stars" is screen-reader text).
    const asLandlord = tabs.getByRole("link", { name: /^As a landlord \(5 stars\s*, 1 review\)$/ });
    const asRenter = tabs.getByRole("link", { name: /^As a renter \(4 stars\s*, 1 review\)$/ });
    await expect(asLandlord).toContainText("(5★");
    await expect(asLandlord).toHaveAttribute("aria-current", "page");
    await expect(asRenter).not.toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: `${PEOPLE.olafur.name}'s rating as a landlord` })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reviews as a landlord (1)" })).toBeVisible();
    await expect(reviewCard(page, "Besti leigusali sem ég hef haft")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Properties (1)" })).toBeVisible();

    await asRenter.click();
    await expect(page).toHaveURL(`/renters/${idOf(landlordPath)}`);
    await expect(page).toHaveTitle(`${PEOPLE.olafur.name} — renter reviews · GossipRent`);
    await expect(robotsMeta(page)).toHaveAttribute("content", "noindex, nofollow");
    await expect(tabs.getByRole("link", { name: /^As a renter / })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: `${PEOPLE.olafur.name}'s rating as a renter` })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reviews as a renter (1)" })).toBeVisible();
    await expect(page.getByText(`${PEOPLE.olafur.name}, as rated by their landlords.`, { exact: true })).toBeVisible();
    const review = reviewCard(page, "Rólegur og snyrtilegur leigjandi");
    await expect(review.getByRole("link", { name: PEOPLE.sigrun.name })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Properties/ })).toHaveCount(0);
  });

  test("property page shows the address, landlord, rating, and reviews", async ({ page }) => {
    const path = await findPropertyPath(page, "Austurvegur", propertyLabel(PROPERTIES.austurvegur));
    await page.goto(path);
    await expect(page).toHaveTitle("Austurvegur 22, 800 Selfoss — reviews · GossipRent");
    await expect(page.getByRole("heading", { level: 1, name: "Austurvegur 22" })).toBeVisible();
    await expect(page.getByText("800 Selfoss", { exact: true })).toBeVisible();
    await expect(page.getByText(PROPERTIES.austurvegur.description)).toBeVisible();
    await expect(
      page.getByText(`Listed ${monthYear(daysAgo(PROPERTIES.austurvegur.addedDaysAgo))}`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(`Landlord: ${PEOPLE.jon.name}`, { exact: true })).toBeVisible();
    await expect(page.getByText("Added by a renter, not confirmed")).toHaveCount(0);
    await expect(summaryCount(page)).toHaveText("1 review");
    const review = reviewCard(page, "Gott raðhús með garði");
    await expect(review.getByRole("link", { name: PEOPLE.thordis.name })).toBeVisible();
    await expect(review.getByRole("img", { name: "Rated 4 out of 5 stars" })).toBeVisible();
    await expect(page.getByText("What renters say about living here.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Have you lived at this property?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign up as a renter" })).toHaveAttribute(
      "href",
      `/signup?role=renter&next=${encodeURIComponent(path)}`,
    );
    await expect(page.getByRole("link", { name: "Report this page" })).toHaveAttribute(
      "href",
      `/report?target=property&id=${idOf(path)}`,
    );

    await page.getByRole("main").getByRole("link", { name: PEOPLE.jon.name, exact: true }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: PEOPLE.jon.name })).toBeVisible();
  });

  test("a property page marks a landlord without an account as not confirmed", async ({ page }) => {
    const path = await findPropertyPath(page, "Hamraborg", propertyLabel(PROPERTIES.hamraborg));
    await page.goto(path);
    await expect(page).toHaveTitle("Hamraborg 14, apt. 0503, 200 Kópavogur — reviews · GossipRent");
    await expect(page.getByRole("heading", { level: 1, name: "Hamraborg 14, apt. 0503" })).toBeVisible();
    await expect(page.getByText("200 Kópavogur", { exact: true })).toBeVisible();
    await expect(page.getByText(`Landlord: ${PEOPLE.gunnar.name}`, { exact: true })).toBeVisible();
    await expect(page.getByText("Added by a renter, not confirmed", { exact: true })).toBeVisible();
  });
});

test.describe("not found", () => {
  const randomUuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  for (const path of [
    "/landlords/not-a-uuid",
    `/landlords/${randomUuid}`,
    "/renters/123",
    `/renters/${randomUuid}`,
    "/properties/abc",
    `/properties/${randomUuid}`,
    "/no-such-page",
  ]) {
    test(`${path} is a 404`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(notFoundHeading(page)).toBeVisible();
      await expect(page.getByRole("main").getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
      await expect(page.getByRole("main").getByRole("link", { name: "Search", exact: true })).toHaveAttribute(
        "href",
        "/search",
      );
    });
  }

  test("a landlord's id under /renters (and vice versa) goes to the page for the role they have", async ({
    page,
    request,
  }) => {
    const landlordPath = await demoProfilePath(page, "jon");
    const renterPath = await demoProfilePath(page, "kari");

    // A plain redirect, not a 404.
    let response = await request.get(`/renters/${idOf(landlordPath)}`, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toBe(landlordPath);
    response = await request.get(`/landlords/${idOf(renterPath)}`, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toBe(renterPath);

    const redirected = await page.goto(`/renters/${idOf(landlordPath)}`);
    expect(redirected?.status()).toBe(200);
    await expect(page).toHaveURL(landlordPath);
    await expect(page.getByRole("heading", { level: 1, name: PEOPLE.jon.name })).toBeVisible();
    await expect(notFoundHeading(page)).toHaveCount(0);

    await page.goto(`/landlords/${idOf(renterPath)}`);
    await expect(page).toHaveURL(renterPath);
    await expect(page.getByRole("heading", { level: 1, name: PEOPLE.kari.name })).toBeVisible();

    // Profiles without an account work the same way.
    const magnusPath = await demoProfilePath(page, "magnus");
    response = await request.get(`/landlords/${idOf(magnusPath)}`, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toBe(magnusPath);

    // Ólafur is both, so both of his pages exist.
    const olafurId = idOf(await demoProfilePath(page, "olafur", "landlord"));
    const olafurRenter = await page.goto(`/renters/${olafurId}`);
    expect(olafurRenter?.status()).toBe(200);
    await expect(page).toHaveURL(`/renters/${olafurId}`);
    await expect(page).toHaveTitle(`${PEOPLE.olafur.name} — renter reviews · GossipRent`);
  });
});

// ---------------------------------------------------------------------------
// Without JavaScript
// ---------------------------------------------------------------------------

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("browsing, searching, and sorting work as plain links and forms", async ({ page }) => {
    await page.goto("/");
    await homeSearchBox(page).fill("Akureyri");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/\/search\?q=Akureyri$/);
    await expect(personCard(page.getByRole("region", { name: "Landlords" }), PEOPLE.olafur.name)).toBeVisible();

    await page.goto("/renters");
    const search = page.getByRole("search");
    await search.getByRole("searchbox").fill("Akureyri");
    await search.getByLabel("Sort by").selectOption("name");
    await search.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/renters\?q=Akureyri&sort=name$/);
    expect(await cardNames(page)).toEqual([PEOPLE.birta.name, PEOPLE.olafur.name]);

    await personCard(page, PEOPLE.birta.name).click();
    await expect(page.getByRole("heading", { level: 1, name: PEOPLE.birta.name })).toBeVisible();
    await expect(reviewCard(page, "Frábær leigjandi")).toBeVisible();
  });

  test("a kennitala typed into any search box lands on the lookup form, never searched or shown", async ({ page }) => {
    const kennitala = PEOPLE.gunnar.kennitala;
    for (const [path, box] of [
      ["/", homeSearchBox],
      ["/search", searchBox],
      ["/search?q=Akureyri", searchBox],
      ["/landlords", searchBox],
      ["/renters", searchBox],
      ["/properties", searchBox],
    ] as const) {
      await page.goto(path);
      await box(page).fill(formatKennitala(kennitala));
      await box(page).press("Enter");
      await expect(page, path).toHaveURL(/\/search\?kt=1$/);
      await expect(page.getByText(KENNITALA_POINTER), path).toBeVisible();
      await expect(page.getByRole("heading", { name: /^Results for/ }), path).toHaveCount(0);
      await expect(lookupField(page), path).toHaveValue("");
      const html = await page.content();
      for (const variant of kennitalaVariants(kennitala)) expect(html, path).not.toContain(variant);
    }
  });
});

// ---------------------------------------------------------------------------
// Out-of-range pages
// ---------------------------------------------------------------------------

test.describe("pagination", () => {
  // Regression: a page number past the last page (an old link, or after
  // deletions) used to show "N landlords" next to "No landlords yet". It now
  // redirects to the last page that exists.
  test("an out-of-range directory page redirects to the last page", async ({ page, request }) => {
    const response = await request.get("/landlords?page=999", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toMatch(/^\/landlords(\?page=\d+)?$/);

    await page.goto("/landlords?page=999");
    await expect(page).toHaveURL(/\/landlords(\?page=\d+)?$/);
    await expect(page.getByText(/^\d+ landlords$/)).toBeVisible();
    await expect(page.getByText("No landlords yet")).toHaveCount(0);
    await expect(page.locator("main ul > li > a").first()).toBeVisible();
  });

  test("the redirect keeps the search and sort", async ({ request }) => {
    const response = await request.get("/properties?q=Kopavogur&sort=name&page=7", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toBe("/properties?q=Kopavogur&sort=name");

    const renters = await request.get("/renters?q=Kopavogur&sort=newest&page=2", { maxRedirects: 0 });
    expect(renters.status()).toBe(307);
    expect(renters.headers()["location"]).toBe("/renters?q=Kopavogur&sort=newest");
  });

  test("a search with no results doesn't redirect, whatever the page", async ({ page }) => {
    const response = await page.goto("/landlords?q=zzz-no-such-landlord&page=5");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/page=5$/);
    await expect(page.getByText("No landlords match “zzz-no-such-landlord”")).toBeVisible();
  });

  test("an out-of-range review page redirects to the last page of reviews", async ({ page, request }) => {
    const path = await demoProfilePath(page, "gunnar");
    const response = await request.get(`${path}?page=99`, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toBe(`${path}#reviews`);

    await page.goto(`${path}?page=99`);
    await expect(page).toHaveURL(`${path}#reviews`);
    await expect(page.getByRole("heading", { name: "Reviews (2)" })).toBeVisible();
    await expect(page.getByText(`No reviews for ${PEOPLE.gunnar.name} yet`)).toHaveCount(0);
    await expect(page.locator("article")).toHaveCount(2);
  });

  test("an out-of-range property review page redirects too", async ({ page, request }) => {
    const path = await findPropertyPath(page, "Austurvegur", propertyLabel(PROPERTIES.austurvegur));
    const response = await request.get(`${path}?page=3`, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toBe(`${path}#reviews`);
    await page.goto(`${path}?page=3`);
    await expect(page.getByRole("heading", { name: "Reviews (1)" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// In Icelandic
// ---------------------------------------------------------------------------

test.describe("in Icelandic", () => {
  test.beforeEach(async ({ context }) => {
    await setLanguage(context, "is");
  });

  test("directories and search read in Icelandic, sorted A–Ö, with decimal commas", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/landlords?q=Gunnar&sort=name");
    await expect(page.locator("html")).toHaveAttribute("lang", "is");
    await expect(page).toHaveTitle("Leigusalar · GossipRent");
    await expect(page.getByRole("heading", { level: 1, name: "Leigusalar" })).toBeVisible();
    await expect(page.getByText("2 leigusalar passa við „Gunnar“")).toBeVisible();
    const sort = page.getByLabel("Raða eftir");
    await expect(sort).toHaveValue("name");
    await expect(sort.locator("option:checked")).toHaveText("A–Ö");
    // "Gunnar Már" before "Ólafur Þór Gunnarsson".
    expect(await cardNames(page)).toEqual([PEOPLE.gunnar.name, PEOPLE.olafur.name]);
    const gunnar = personCard(page, PEOPLE.gunnar.name);
    expect(await cardMeta(gunnar)).toEqual(["Leigusali", "Án aðgangs"]);
    expect(await cardSubtitle(gunnar)).toBe("1 eign");
    await expect(gunnar).toContainText("2,5 · 2 umsagnir");
    await expect(gunnar.getByRole("img", { name: "Einkunn 2,5 af 5" })).toBeVisible();
    expect(await cardMeta(personCard(page, PEOPLE.olafur.name))).toEqual(["Leigusali", "· Einnig leigjandi"]);
    expect(await cardSubtitle(personCard(page, PEOPLE.olafur.name))).toBe("Akureyri · 1 eign");

    await page.goto("/properties?q=Kopavogur");
    await expect(page.getByText("1 eign passar við „Kopavogur“")).toBeVisible();
    const hamraborg = page.getByRole("main").getByRole("link", { name: /^Hamraborg 14, íbúð 0503/ });
    await expect(hamraborg).toContainText("200 Kópavogur");
    await expect(hamraborg).toContainText(`Leigusali: ${PEOPLE.gunnar.name} (ekki staðfest)`);
    await expect(hamraborg).toContainText("2 · 1 umsögn");

    await page.goto("/search?q=Akureyri");
    await expect(page.getByRole("heading", { level: 1, name: "Niðurstöður fyrir „Akureyri“" })).toBeVisible();
    await expect(page.getByText("4 niðurstöður")).toBeVisible();
    await expect(page.getByRole("region", { name: "Leigusalar" }).getByRole("heading", { name: "Leigusalar (1)" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Eignir" }).getByRole("heading", { name: "Eignir (1)" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Leigjendur" }).getByRole("heading", { name: "Leigjendur (2)" })).toBeVisible();
    await expect(lookupSection(page)).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Fletta upp kennitölu" })).toBeVisible();

    // Client components format numbers the same way as the server: no hydration errors.
    expect(errors).toEqual([]);
  });

  test("a profile without an account in Icelandic", async ({ page }) => {
    const errors = watchErrors(page);
    const path = await demoProfilePath(page, "gunnar");
    await page.goto(path);
    await expect(page).toHaveTitle(`${PEOPLE.gunnar.name} (leigusali) — umsagnir · GossipRent`);
    const header = page.getByRole("main").locator("section").first();
    await expect(header.getByText("Án aðgangs", { exact: true })).toBeVisible();
    await expect(
      header.getByText(`Fyrsta umsögn í ${monthYear(daysAgo(demoFirstReviewedDaysAgo("gunnar")), "is-IS")}`, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(header.getByText(/^Viðkomandi er ekki með aðgang að GossipRent\./)).toBeVisible();
    await expect(header.getByRole("link", { name: "Stofnaðu aðgang með kennitölunni þinni" })).toHaveAttribute(
      "href",
      "/signup",
    );
    await expect(page.getByRole("link", { name: "Tilkynna þessa síðu" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Einkunn 2,5 af 5" }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// On a phone
// ---------------------------------------------------------------------------

test.describe("on a phone (390px wide)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("a profile has a “Review <name>” button that jumps to the review form", async ({ page }) => {
    const path = await demoProfilePath(page, "jon");
    await page.goto(path);
    const cta = page.getByRole("link", { name: `Review ${PEOPLE.jon.name}`, exact: true });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", "#your-review");
    // The form box starts below the fold on a phone.
    await expect(page.locator("#your-review")).not.toBeInViewport();
    await cta.click();
    await expect(page).toHaveURL(`${path}#your-review`);
    await expect(page.locator("#your-review")).toBeInViewport();
    await expect(page.getByRole("heading", { name: "Have you rented from this landlord?" })).toBeInViewport();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("the button reads “Review this property” on a property and “Edit your review” once you've written one", async ({
    page,
  }) => {
    await page.goto(await findPropertyPath(page, "Austurvegur", propertyLabel(PROPERTIES.austurvegur)));
    await expect(page.getByRole("link", { name: "Review this property" })).toBeVisible();

    // Þórdís reviewed Jón in the demo data.
    const jonPath = await demoProfilePath(page, "jon");
    await logInAs(page, "thordis");
    await page.goto(jonPath);
    const edit = page.getByRole("link", { name: "Edit your review" });
    await expect(edit).toBeVisible();
    await edit.click();
    await expect(page.getByRole("button", { name: "Update review" })).toBeInViewport();
  });

  test("no review button where you can't review", async ({ page }) => {
    const jonPath = await demoProfilePath(page, "jon");
    // Landlords can't review landlords (Helga is only a landlord).
    await logInAs(page, "helga");
    await page.goto(jonPath);
    await expect(page.getByRole("heading", { level: 1, name: PEOPLE.jon.name })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(`^Review ${escapeRegExp(PEOPLE.jon.name)}$|^Edit your review$`) })).toHaveCount(0);
    // Nor on your own profile.
    await page.goto(await myProfilePath(page));
    await expect(page.getByRole("heading", { level: 1, name: PEOPLE.helga.name })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Review |^Edit your review$/ })).toHaveCount(0);
  });

  test("the signed-in header's account link has an accessible name", async ({ page }) => {
    await logInAs(page, "kari");
    // On a phone only the avatar shows, so the name comes from aria-label.
    const account = page.getByRole("banner").getByRole("link", { name: "My account" });
    await expect(account).toBeVisible();
    await expect(account).toHaveAttribute("href", "/dashboard");
  });

  test("the mobile “Review” button moves keyboard focus into the review form", async ({ page }) => {
    const path = await demoProfilePath(page, "jon");
    await page.goto(path);
    const cta = page.getByRole("link", { name: `Review ${PEOPLE.jon.name}`, exact: true });
    await cta.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${path}#your-review`);
    // The next Tab lands inside the form, not back at the top of the page.
    await page.keyboard.press("Tab");
    const insideForm = await page.evaluate(() => Boolean(document.activeElement?.closest("#your-review")));
    expect(insideForm).toBe(true);
  });
});

test.describe("no sideways scrolling on phones", () => {
  test.use({ isMobile: true, hasTouch: true });

  /** Pages with long Icelandic names, cards, forms and empty states. */
  async function pagesToCheck(page: Page): Promise<string[]> {
    return [
      "/",
      "/landlords",
      "/renters",
      "/properties",
      "/landlords?q=zzz-no-such-landlord",
      "/search?q=Akureyri",
      "/search?kt=1",
      "/privacy",
      "/login",
      "/signup",
      "/no-such-page",
      await demoProfilePath(page, "olafur", "landlord"),
      await demoProfilePath(page, "leigufelag"),
      await demoProfilePath(page, "thordis"),
      await findPropertyPath(page, "Hamraborg", propertyLabel(PROPERTIES.hamraborg)),
    ];
  }

  for (const width of [390, 320]) {
    for (const language of ["en", "is"] as const) {
      test(`${width}px wide, in ${language === "en" ? "English" : "Icelandic"}`, async ({ page, context }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width, height: 800 });
        const paths = await pagesToCheck(page);
        await setLanguage(context, language);
        for (const path of paths) {
          await page.goto(path);
          await expect(page.locator("html")).toHaveAttribute("lang", language);
          expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(0);
        }
      });
    }
  }

  test("320px wide, signed in", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const paths = ["/", "/landlords", await demoProfilePath(page, "olafur", "renter"), "/search?q=Kopavogur"];
    await logInAs(page, "olafur");
    paths.push("/dashboard", "/reviews/new", "/properties/new");
    for (const path of paths) {
      await page.goto(path);
      expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(0);
    }
  });
});
