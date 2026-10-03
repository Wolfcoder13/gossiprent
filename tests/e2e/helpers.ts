import { expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { DEMO, DEMO_PASSWORD } from "../../src/db/demo-people";
import { isAdultKennitala, parseKennitalaInput } from "../../src/lib/kennitala";
import { placeName } from "../../src/lib/postcodes";
import { normalizeText, normalizeUnit } from "../../src/lib/text";

/**
 * Shared helpers for the end-to-end tests. The tests run in English (the
 * config's storageState sets the `lang=en` cookie); locators use the English
 * UI text from src/i18n/messages/en.
 */

/** Seeded demo data (src/db/demo-people.ts): `DEMO.people.sigrun.email`, `DEMO.properties.njalsgata`, `DEMO.reviews`. */
export { DEMO, DEMO_PASSWORD };

type DemoPeople = typeof DEMO.people;
export type DemoPersonKey = keyof DemoPeople;
/** Demo people who have an account (and so can log in). */
export type DemoAccountKey = {
  [K in DemoPersonKey]: DemoPeople[K] extends { email: string } ? K : never;
}[DemoPersonKey];

type Role = "landlord" | "renter";
/** What an account signs up as: one role, or both. */
type Roles = Role | "both";

export type TestUser = {
  role: Roles;
  name: string;
  email: string;
  password: string;
  /** 10 digits, no separator. */
  kennitala: string;
  city?: string;
};

// ---------------------------------------------------------------------------
// Unique values
// ---------------------------------------------------------------------------

let counter = 0;

/** A short token that's unique across test runs and within a run (letters and digits). */
export function uid(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

function inLetters(n: number): string {
  let out = "";
  do {
    out = LETTERS[n % 26] + out;
    n = Math.floor(n / 26);
  } while (n > 0);
  return out;
}

/**
 * A unique token made only of letters, capitalized ("Bqhzkxlwpcb"), for
 * people's names: a person's name may not contain digits.
 */
export function nameToken(): string {
  counter += 1;
  const random = Array.from({ length: 3 }, () => LETTERS[Math.floor(Math.random() * 26)]).join("");
  const token = `${inLetters(Date.now())}${inLetters(counter)}${random}`;
  return token[0].toUpperCase() + token.slice(1);
}

// ---------------------------------------------------------------------------
// Kennitalas
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
// Each day has 800 numbers: digits 7–9 (serial and the old check digit) from 200 to 999.
const PER_DAY = 800;
const KENNITALA_RANGES = {
  // Born 1960–1999 (the 10th digit, 9, is the century).
  adult: { from: Date.UTC(1960, 0, 1), days: 14_610 },
  // Born two to five years ago: a minor for as long as these tests exist.
  minor: { from: Date.now() - 5 * 365 * DAY, days: 3 * 365 },
  // Registered 1970–1999 (companies add 40 to the day).
  company: { from: Date.UTC(1970, 0, 1), days: 10_957 },
};
// The same numbering as tests/unit/support/harness.ts: consecutive slots from a
// starting point. The start moves on 100 slots a second, so a worker restarted
// after a failed test (which imports this file again) starts past every number
// the previous one used; a second parallel worker starts a million slots away.
const kennitalaStart = Math.floor(Date.now() / 10) + Number(process.env.TEST_PARALLEL_INDEX ?? 0) * 1_000_003;
let kennitalaCounter = 0;

function kennitalaAt(kind: keyof typeof KENNITALA_RANGES, index: number): string {
  const range = KENNITALA_RANGES[kind];
  const slot = index % (range.days * PER_DAY);
  const date = new Date(range.from + Math.floor(slot / PER_DAY) * DAY);
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = date.getUTCDate() + (kind === "company" ? 40 : 0);
  const year = date.getUTCFullYear();
  const serial = 200 + (slot % PER_DAY);
  return `${pad(day)}${pad(date.getUTCMonth() + 1)}${pad(year % 100)}${serial}${Math.floor(year / 100) % 10}`;
}

/**
 * A valid kennitala (10 digits, no separator) that no other call in this run
 * returns and that isn't in the demo data: an adult born 1960–1999 by default,
 * or a child (born 2–5 years ago), or a company (registered 1970–1999).
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

/** "0101302129" → "010130-2129", how the app echoes a kennitala back to the person who typed it. */
export function formatKennitala(kennitala: string): string {
  const digits = kennitala.replace(/\D/g, "");
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
}

/**
 * The ways a kennitala could appear in a page or URL ("0101302129",
 * "010130-2129", "010130 2129"), for checking that it doesn't.
 */
export function kennitalaVariants(kennitala: string): string[] {
  const digits = kennitala.replace(/\D/g, "");
  return [digits, `${digits.slice(0, 6)}-${digits.slice(6)}`, `${digits.slice(0, 6)} ${digits.slice(6)}`];
}

/** Not a kennitala (month 34), as in the app's own hints. */
export const NOT_A_KENNITALA = "123456-7890";

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

export type Locale = "is" | "en";

/** Each language's name for itself: the label of the button that switches to it. */
export const LANGUAGE_NAME: Record<Locale, string> = { is: "Íslenska", en: "English" };

/**
 * Give a browser context the Icelandic or English site (sets the httpOnly
 * `lang` cookie), or `null` for a visitor who hasn't chosen (no cookie: Icelandic,
 * plus the "This site is in Icelandic." bar unless the browser prefers Icelandic).
 * New contexts start in English (playwright.config.ts).
 */
export async function setLanguage(context: BrowserContext, locale: Locale | null): Promise<void> {
  await context.clearCookies({ name: "lang" });
  if (locale) {
    await context.addCookies([
      { name: "lang", value: locale, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" },
    ]);
  }
}

/**
 * The button that switches to `to` ("English" / "Íslenska") in the header
 * (role banner) or the footer (role contentinfo). Only the other language's
 * button is on a page.
 */
export function languageButton(page: Page, to: Locale, where: "header" | "footer" = "header"): Locator {
  return page
    .getByRole(where === "header" ? "banner" : "contentinfo")
    .getByRole("button", { name: LANGUAGE_NAME[to], exact: true });
}

/** Switch language with the header (or footer) button and wait for the page to come back in it. */
export async function switchLanguage(page: Page, to: Locale, where: "header" | "footer" = "header"): Promise<void> {
  await languageButton(page, to, where).click();
  await expect(page.locator("html")).toHaveAttribute("lang", to);
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

const FIRST_NAME: Record<Roles, string> = { landlord: "Lana", renter: "Remy", both: "Bo" };

/**
 * A brand-new user (not yet signed up) with a unique name, email and
 * kennitala (freshKennitala()). Names are letters only ("Remy Bqhzkxlwpcb").
 */
export function makeUser(role: Roles, overrides: Partial<TestUser> = {}): TestUser {
  const id = uid();
  return {
    role,
    name: `${FIRST_NAME[role]} ${nameToken()}`,
    email: `e2e-${role}-${id}@example.com`,
    password: `pw-${id}-secret`,
    kennitala: freshKennitala(),
    city: "Testbær",
    ...overrides,
  };
}

const ROLE_CHECKBOX: Record<Role, string> = { renter: "I'm a renter", landlord: "I'm a landlord" };

/** The sign-up form's "I'm a renter" / "I'm a landlord" checkbox (its name also includes its description). */
export function roleCheckbox(page: Page, role: Role): Locator {
  return page.getByRole("checkbox", { name: ROLE_CHECKBOX[role] });
}

/** Tick exactly the sign-up checkboxes for `roles` (and untick the other one). */
async function pickRoles(page: Page, roles: Roles): Promise<void> {
  for (const role of ["renter", "landlord"] as const) {
    const wanted = roles === "both" || roles === role;
    await roleCheckbox(page, role).setChecked(wanted);
    await expect(roleCheckbox(page, role)).toBeChecked({ checked: wanted });
  }
}

/** The sign-up form's "Kennitala" field. */
export function signupKennitalaInput(page: Page): Locator {
  return page.getByLabel("Kennitala", { exact: true });
}

/** Fill and submit the sign-up form on the current page. Doesn't wait for the result. */
export async function fillSignup(page: Page, user: TestUser): Promise<void> {
  await pickRoles(page, user.role);
  await signupKennitalaInput(page).fill(user.kennitala);
  await page.getByLabel("Name", { exact: true }).fill(user.name);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  if (user.city !== undefined) await page.getByLabel("City").fill(user.city);
  await page.getByRole("button", { name: "Create account" }).click();
}

/**
 * Sign up through the UI and wait for the dashboard ("Hi, <first name>").
 * Taking over a profile someone has already reviewed keeps that profile's
 * name: the dashboard is then /dashboard?name=kept and greets that name.
 */
export async function signUp(page: Page, user: TestUser): Promise<void> {
  await page.goto("/signup");
  await fillSignup(page, user);
  await expect(page).toHaveURL(/\/dashboard(\?name=kept)?$/);
  const keptName = new URL(page.url()).searchParams.get("name") === "kept";
  await expect(
    page.getByRole("heading", { level: 1, name: keptName ? /^Hi, / : `Hi, ${user.name.split(" ")[0]}` }),
  ).toBeVisible();
}

/** Fill and submit the login form on the current page. */
export async function fillLogin(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}

/** Log in through the UI and wait for the dashboard. */
export async function logIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await fillLogin(page, email, password);
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** Log in as one of the demo accounts: `logInAs(page, "sigrun")`. */
export async function logInAs(page: Page, key: DemoAccountKey): Promise<void> {
  await logIn(page, (DEMO.people[key] as { email: string }).email, DEMO_PASSWORD);
}

/** Log out with the header button and wait for the header's "Log in" link. */
export async function logOut(page: Page): Promise<void> {
  const header = page.getByRole("banner");
  await header.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(header.getByRole("link", { name: "Log in", exact: true })).toBeVisible();
}

/** A form's error banner (scoped to <main>: Next's route announcer is also role="alert"). */
export function formAlert(page: Page): Locator {
  return page.getByRole("main").getByRole("alert");
}

/**
 * A form's success banner. (On pages with a search box, that box has its own,
 * usually empty, role="status" line: scope to the form there.)
 */
export function formStatus(page: Page): Locator {
  return page.getByRole("main").getByRole("status");
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/**
 * The signed-in user's public profile path, read from the dashboard (their
 * landlord page if they're both).
 */
export async function myProfilePath(page: Page): Promise<string> {
  await page.goto("/dashboard");
  const href = await page.getByRole("link", { name: "View public profile" }).getAttribute("href");
  expect(href).toMatch(/^\/(landlords|renters)\/[0-9a-f-]{36}$/);
  return href!;
}

/** "/landlords/<id>" → "/renters/<id>" and back: the same person's other role page. */
export function otherRolePath(path: string): string {
  return path.startsWith("/landlords/") ? path.replace("/landlords/", "/renters/") : path.replace("/renters/", "/landlords/");
}

export type Actor = {
  user: TestUser;
  context: BrowserContext;
  page: Page;
  /** e.g. "/landlords/<uuid>" (the landlord page for someone with both roles). */
  profilePath: string;
};

/** Sign up a fresh user in their own browser context (separate cookies; English like every context). */
export async function createActor(
  browser: Browser,
  role: Roles,
  overrides: Partial<TestUser> = {},
): Promise<Actor> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const user = makeUser(role, overrides);
  await signUp(page, user);
  const profilePath = await myProfilePath(page);
  return { user, context, page, profilePath };
}

/** Find a person's profile path (with or without an account) by searching their directory. */
export async function findPersonPath(page: Page, role: Role, name: string): Promise<string> {
  await page.goto(`/${role}s?q=${encodeURIComponent(name)}`);
  const href = await page
    .getByRole("main")
    .getByRole("link", { name: new RegExp(escapeRegExp(name)) })
    .first()
    .getAttribute("href");
  expect(href).toMatch(new RegExp(`^/${role}s/[0-9a-f-]{36}$`));
  return href!;
}

/** A demo person's profile path, in `role` (default: their first role, landlord for Ólafur). */
export async function demoProfilePath(page: Page, key: DemoPersonKey, role?: Role): Promise<string> {
  const person = DEMO.people[key];
  return findPersonPath(page, role ?? person.roles[0], person.name);
}

/** Find a property page path by searching the properties directory. */
export async function findPropertyPath(page: Page, query: string, label: string): Promise<string> {
  await page.goto(`/properties?q=${encodeURIComponent(query)}`);
  const href = await page
    .getByRole("main")
    .getByRole("link", { name: new RegExp(escapeRegExp(label)) })
    .first()
    .getAttribute("href");
  expect(href).toMatch(/^\/properties\/[0-9a-f-]{36}$/);
  return href!;
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

const STAR_LABELS = ["", "Terrible", "Poor", "Okay", "Good", "Excellent"];

/** The radio input for `n` stars in the review form. */
export function starRadio(page: Page, n: number): Locator {
  return page.getByRole("radio", { name: `${n} ${n === 1 ? "star" : "stars"} (${STAR_LABELS[n]})` });
}

/** Pick a star rating by clicking its label (the radio itself is visually hidden). */
export async function pickStars(page: Page, n: number): Promise<void> {
  await page.locator("label").filter({ has: starRadio(page, n) }).click();
  await expect(starRadio(page, n)).toBeChecked();
}

export function reviewTitleInput(page: Page): Locator {
  return page.getByLabel("Headline");
}

export function reviewBodyInput(page: Page): Locator {
  return page.getByLabel("Your review", { exact: true });
}

/**
 * The "Landlord's kennitala" / "Renter's kennitala" field of a review form:
 * on a profile page (a new review only; an edit doesn't ask) and on
 * /reviews/new. Not the add-property form's "Landlord's kennitala (optional)"
 * (see landlordKennitalaInput).
 */
export function reviewKennitalaInput(page: Page): Locator {
  return page.getByRole("textbox", { name: /^(Landlord|Renter)'s kennitala$/ });
}

export async function fillReview(
  page: Page,
  review: { stars?: number; title: string; body: string },
): Promise<void> {
  if (review.stars) await pickStars(page, review.stars);
  await reviewTitleInput(page).fill(review.title);
  await reviewBodyInput(page).fill(review.body);
}

export type Review = { stars: number; title: string; body: string };

/** A review with a unique title and body. */
export function makeReview(stars: number, overrides: Partial<Review> = {}): Review {
  const id = uid();
  return {
    stars,
    title: `Headline ${id}`,
    body: `Review body ${id}: responsive, fair, and the deposit came back in full.`,
    ...overrides,
  };
}

/**
 * Write a new review on the subject page `path` (a landlord, renter or
 * property page) and wait for it to be saved. A new review of a person needs
 * that person's kennitala (`subjectKennitala`, e.g. `actor.user.kennitala` or
 * `DEMO.people.sigrun.kennitala`); a property review doesn't take one.
 */
export async function postReview(page: Page, path: string, review: Review, subjectKennitala?: string): Promise<void> {
  await page.goto(path);
  const kennitalaField = reviewKennitalaInput(page);
  const asksForKennitala = (await kennitalaField.count()) > 0;
  if (asksForKennitala && subjectKennitala === undefined) {
    throw new Error(`postReview(${path}): a new review of a person needs their kennitala (4th argument)`);
  }
  if (!asksForKennitala && subjectKennitala !== undefined) {
    throw new Error(`postReview(${path}): this review form doesn't ask for a kennitala`);
  }
  if (subjectKennitala !== undefined) await kennitalaField.fill(subjectKennitala);
  await fillReview(page, review);
  await page.getByRole("button", { name: "Post review" }).click();
  await expect(formStatus(page)).toHaveText("Thanks! Your review is live.");
  await expect(reviewCard(page, review.title)).toBeVisible();
}

/**
 * The first steps of /reviews/new: open the wizard for `kind`, enter the
 * kennitala and press "Continue". Doesn't wait for the answer.
 */
export async function startReviewByKennitala(page: Page, kind: Role, kennitala: string): Promise<void> {
  await page.goto(`/reviews/new?kind=${kind}`);
  await expect(page.getByRole("heading", { level: 2, name: `Review a ${kind}` })).toBeVisible();
  await reviewKennitalaInput(page).fill(kennitala);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}

/** The wizard's answer after "Continue": "This kennitala belongs to <name>" or "Nobody with this kennitala…". */
export function wizardSubjectHeading(page: Page): Locator {
  return page.getByRole("heading", {
    level: 3,
    name: /^(This kennitala belongs to |Nobody with this kennitala is on GossipRent yet\.)/,
  });
}

/**
 * Write a review of a landlord or renter through /reviews/new and return the
 * path of their profile (where the wizard ends up).
 * - `{ kennitala }`: someone already has the kennitala ("This kennitala belongs to …").
 * - `{ kennitala, name }`: nobody has it yet; the review creates their profile
 *   with `name` ("Full name", or "Company name" for a company's kennitala),
 *   after ticking "I've checked that this kennitala is right".
 */
export async function writeReviewByKennitala(
  page: Page,
  kind: Role,
  subject: { kennitala: string; name?: string },
  review: Review,
): Promise<string> {
  await startReviewByKennitala(page, kind, subject.kennitala);
  if (subject.name === undefined) {
    await expect(wizardSubjectHeading(page)).toHaveAccessibleName(/^This kennitala belongs to /);
  } else {
    await expect(wizardSubjectHeading(page)).toHaveAccessibleName(
      "Nobody with this kennitala is on GossipRent yet. Your review will create a page for them.",
    );
    await page.getByRole("textbox", { name: /^(Full name|Company name)$/ }).fill(subject.name);
    await page.getByRole("checkbox", { name: "I've checked that this kennitala is right" }).check();
  }
  await fillReview(page, review);
  await page.getByRole("button", { name: "Post review" }).click();
  await expect(page).toHaveURL(new RegExp(`/${kind}s/[0-9a-f-]{36}\\?saved=1(#your-review)?$`));
  await expect(formStatus(page)).toHaveText("Thanks! Your review is live.");
  await expect(reviewCard(page, review.title)).toBeVisible();
  return new URL(page.url()).pathname;
}

/** The big average number in the rating summary. */
export function summaryAverage(page: Page): Locator {
  return page.locator("p.text-5xl");
}

/** The "N reviews" line under the big average on a profile/property page. */
export function summaryCount(page: Page): Locator {
  return page.locator("p").filter({ hasText: /^([\d,]+ reviews?|No reviews yet)$/ }).first();
}

/** The number shown in one of the home page's stat tiles ("Reviews", "Landlords", "Renters", "Properties"). */
export async function homeStat(page: Page, label: string): Promise<number> {
  const tile = page.locator("dl > div").filter({ has: page.locator("dt", { hasText: label }) });
  return Number((await tile.locator("dd").innerText()).replace(/\D/g, ""));
}

/**
 * A person card's bottom row (directories, search), item by item: role badge,
 * "No account" for a profile without an account, "· Also a renter" /
 * "· Also a landlord". E.g. ["Landlord", "No account"].
 */
export async function cardMeta(card: Locator): Promise<string[]> {
  return (await card.locator(":scope > div").last().locator(":scope > *").allInnerTexts()).map((t) => t.trim());
}

/**
 * The line under a person card's name: the city, and for a landlord the
 * property count ("Reykjavík · 2 properties", "2 properties", "No properties yet"),
 * or null when there's none.
 */
export async function cardSubtitle(card: Locator): Promise<string | null> {
  const line = card.locator(":scope > div").first().locator("p").nth(1);
  return (await line.count()) > 0 ? (await line.innerText()).trim() : null;
}

/**
 * The cards on a directory page (or within `scope`), in order: a person's
 * name, or a property's street line ("Njálsgata 23, apt. 0201").
 */
export async function cardNames(scope: Page | Locator): Promise<string[]> {
  const root = "goto" in scope ? scope.locator("main") : scope;
  return root.locator("ul > li > a").evaluateAll((links) =>
    links.map((a) => {
      const first = a.querySelector("p");
      // A property card's address is two block spans: street line, then place.
      const street = first?.querySelector(":scope > span > span");
      return (street ?? first)?.textContent?.trim() ?? "";
    }),
  );
}

/** A review card (article) containing `text`. */
export function reviewCard(page: Page, text: string): Locator {
  return page.locator("article").filter({ hasText: text });
}

/** Accept the next window.confirm() and click `button`. */
export async function clickAndConfirm(page: Page, button: Locator): Promise<void> {
  page.once("dialog", (dialog) => {
    expect(dialog.type()).toBe("confirm");
    void dialog.accept();
  });
  await button.click();
}

/** Dismiss the next window.confirm() and click `button`. */
export async function clickAndCancel(page: Page, button: Locator): Promise<void> {
  page.once("dialog", (dialog) => void dialog.dismiss());
  await button.click();
}

// ---------------------------------------------------------------------------
// Kennitala lookup (home page and /search)
// ---------------------------------------------------------------------------

/** The "Look up a kennitala" section. */
export function lookupSection(page: Page): Locator {
  return page.getByRole("region", { name: "Look up a kennitala" });
}

/** Look a kennitala up with the form on the current page. Doesn't wait for the result. */
export async function lookUpKennitala(page: Page, kennitala: string): Promise<void> {
  const section = lookupSection(page);
  await section.getByLabel("Kennitala", { exact: true }).fill(kennitala);
  await section.getByRole("button", { name: "Look up", exact: true }).click();
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

export type NewProperty = {
  address: string;
  /** "Apartment (optional)": e.g. "0201" (shown "apt. 0201") or "2nd floor left". */
  unit?: string;
  /** The "Postcode" option's value, e.g. "101" (101 Reykjavík). */
  postalCode: string;
  description?: string;
};

/** A property with a unique Icelandic-style address ("E2e<id>gata 12", apt. 0201, 101 Reykjavík). */
export function makeProperty(overrides: Partial<NewProperty> = {}): NewProperty {
  const id = uid();
  return {
    address: `E2e${id}gata ${1 + Math.floor(Math.random() * 199)}`,
    unit: "0201",
    postalCode: "101",
    description: "Sunny test apartment with a balcony.",
    ...overrides,
  };
}

/**
 * The street line the app shows for a property (its page's h1, the first line
 * of its card), in English: "Njálsgata 23, apt. 0201" for a 3–4 digit
 * apartment, "Laugavegur 5, 2nd floor left" for other units, else the address.
 * Works for makeProperty() results and DEMO.properties alike.
 */
export function propertyLabel(property: { address: string; unit?: string | null }): string {
  const address = normalizeText(property.address);
  const unit = normalizeUnit(property.unit);
  if (!unit) return address;
  return /^\d{3,4}$/.test(unit) ? `${address}, apt. ${unit}` : `${address}, ${unit}`;
}

/** The place line under it: "101 Reykjavík". */
export function propertyPlace(property: { postalCode: string | number }): string {
  const code = Number(property.postalCode);
  return `${code} ${placeName(code)}`;
}

/** The whole address on one line, as review cards show it: "Njálsgata 23, apt. 0201, 101 Reykjavík". */
export function propertyAddressText(property: { address: string; unit?: string | null; postalCode: string | number }): string {
  return `${propertyLabel(property)}, ${propertyPlace(property)}`;
}

/**
 * A property's landlord, by kennitala (the add-property form and the creator's
 * "Change the landlord" form):
 * - `{ kennitala }`: someone already has it; "Check" must answer "This kennitala belongs to …".
 * - `{ kennitala, name }`: nobody has it yet; "Check" must say so, then the
 *   helper fills "Landlord's name" and ticks "I've checked that this kennitala is right".
 */
export type LandlordByKennitala = { kennitala: string; name?: string };

/**
 * Who the property belongs to, as the add-property form asks it:
 * - a LandlordByKennitala: the landlord fields (people who are only renters);
 * - { relation: "own" }: "Own or manage" (people with both roles);
 * - { relation: "rent", landlord? }: "Rent or used to rent", then optionally
 *   the landlord fields (people with both roles).
 * People who are only landlords don't get asked (pass nothing).
 */
export type PropertyOwner = LandlordByKennitala | { relation: "own" } | { relation: "rent"; landlord?: LandlordByKennitala };

const RELATION_LABEL = { own: "Own or manage", rent: "Rent or used to rent" } as const;

/** The "This is a place I…" radio group shown to people with both roles. */
export function relationGroup(page: Page): Locator {
  return page.getByRole("radiogroup", { name: "This is a place I…" });
}

export function relationRadio(page: Page, relation: "own" | "rent"): Locator {
  return relationGroup(page).getByRole("radio", { name: RELATION_LABEL[relation] });
}

/** "Landlord's kennitala (optional)" in the add-property form or the "Change the landlord" form. */
export function landlordKennitalaInput(scope: Page | Locator): Locator {
  return scope.getByRole("textbox", { name: /^Landlord's kennitala/ });
}

/** The "Check" button next to it (looks the kennitala up without saving). */
export function checkLandlordButton(scope: Page | Locator): Locator {
  return scope.getByRole("button", { name: "Check", exact: true });
}

/** "Landlord's name": only shown once "Check" (or a save) found the kennitala is new. */
export function landlordNameInput(scope: Page | Locator): Locator {
  return scope.getByRole("textbox", { name: "Landlord's name" });
}

/** "I've checked that this kennitala is right": shown with "Landlord's name". */
export function confirmNewLandlordCheckbox(scope: Page | Locator): Locator {
  return scope.getByRole("checkbox", { name: "I've checked that this kennitala is right" });
}

/** "Check"'s answer: "This kennitala belongs to <name>". */
export function landlordFoundAnswer(scope: Page | Locator, name?: string): Locator {
  return scope.getByText(name === undefined ? /^This kennitala belongs to / : `This kennitala belongs to ${name}`, {
    exact: name !== undefined,
  });
}

/** "Check"'s answer for a kennitala nobody has yet. */
export function landlordNotFoundAnswer(scope: Page | Locator): Locator {
  return scope.getByText("Nobody with this kennitala is on GossipRent yet. Enter the landlord's name to add them.", {
    exact: true,
  });
}

/** Fill the landlord fields within `scope` (see LandlordByKennitala). Presses "Check"; doesn't save. */
export async function fillLandlordFields(scope: Page | Locator, landlord: LandlordByKennitala): Promise<void> {
  await landlordKennitalaInput(scope).fill(landlord.kennitala);
  await checkLandlordButton(scope).click();
  if (landlord.name === undefined) {
    await expect(landlordFoundAnswer(scope)).toBeVisible();
    return;
  }
  await expect(landlordNotFoundAnswer(scope)).toBeVisible();
  await landlordNameInput(scope).fill(landlord.name);
  await confirmNewLandlordCheckbox(scope).check();
}

/** Fill the add-property form (on /properties/new) and submit it. */
export async function fillPropertyForm(page: Page, property: NewProperty, owner?: PropertyOwner): Promise<void> {
  await page.getByLabel("Address", { exact: true }).fill(property.address);
  await page.getByLabel("Apartment").fill(property.unit ?? "");
  await page.getByRole("combobox", { name: "Postcode" }).selectOption(property.postalCode);
  await page.getByLabel("Short description").fill(property.description ?? "");
  if (owner && "relation" in owner) {
    await relationRadio(page, owner.relation).check();
    if (owner.relation === "rent" && owner.landlord) await fillLandlordFields(page, owner.landlord);
  } else if (owner) {
    await fillLandlordFields(page, owner);
  }
  await page.getByRole("button", { name: "Add property" }).click();
}

/** Add a property through the UI and return its page path. */
export async function addProperty(page: Page, property: NewProperty, owner?: PropertyOwner): Promise<string> {
  await page.goto("/properties/new");
  await fillPropertyForm(page, property, owner);
  await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: propertyLabel(property) })).toBeVisible();
  return new URL(page.url()).pathname;
}

/**
 * The property creator's "Change the landlord" / "Link the landlord" form (a
 * <details>; click its summary to open it). Fill it with fillLandlordFields,
 * or leave the kennitala empty to remove the link, then press "Save landlord".
 */
export function relinkForm(page: Page): Locator {
  return page.locator("details").filter({
    has: page.locator("summary", { hasText: /^(Change|Link) the landlord$/ }),
  });
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
