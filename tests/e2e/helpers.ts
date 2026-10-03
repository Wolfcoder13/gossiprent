import { expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

/** Password of every seeded demo account. */
export const DEMO_PASSWORD = "password123";

/** Seeded demo data (src/db/seed.ts) that browsing tests rely on. */
export const DEMO = {
  landlords: {
    maria: { name: "Maria Gonzalez", email: "maria@example.com" },
    northgate: { name: "Northgate Property Group", email: "office@northgate.example.com" },
    sam: { name: "Sam Whitfield", email: "sam@example.com" },
    priya: { name: "Priya Raman", email: "priya@example.com" },
  },
  renters: {
    jordan: { name: "Jordan Ellis", email: "jordan@example.com" },
    aisha: { name: "Aisha Bello", email: "aisha@example.com" },
    tom: { name: "Tom Becker", email: "tom@example.com" },
    lena: { name: "Lena Kowalski", email: "lena@example.com" },
    marcus: { name: "Marcus Reed", email: "marcus@example.com" },
  },
} as const;

type Role = "landlord" | "renter";
/** What an account signs up as: one role, or both. */
type Roles = Role | "both";

type TestUser = {
  role: Roles;
  name: string;
  email: string;
  password: string;
  city?: string;
};

let counter = 0;

/** A short token that's unique across test runs and within a run. */
export function uid(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const FIRST_NAME: Record<Roles, string> = { landlord: "Lana", renter: "Remy", both: "Bo" };

/** A brand-new user (not yet signed up) with a unique name and email. */
export function makeUser(role: Roles, overrides: Partial<TestUser> = {}): TestUser {
  const id = uid();
  return {
    role,
    name: `${FIRST_NAME[role]} E2e${id}`,
    email: `e2e-${role}-${id}@example.com`,
    password: `pw-${id}-secret`,
    city: "Testville, TS",
    ...overrides,
  };
}

const ROLE_CHECKBOX: Record<Role, string> = { renter: "I'm a renter", landlord: "I'm a landlord" };

/** The sign-up form's "I'm a renter" / "I'm a landlord" checkbox. */
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

/** Fill and submit the sign-up form. Doesn't wait for the result. */
export async function fillSignup(page: Page, user: TestUser): Promise<void> {
  await pickRoles(page, user.role);
  await page.getByLabel("Name", { exact: true }).fill(user.name);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  if (user.city !== undefined) await page.getByLabel("City").fill(user.city);
  await page.getByRole("button", { name: "Create account" }).click();
}

/** Sign up through the UI and wait for the dashboard. */
export async function signUp(page: Page, user: TestUser): Promise<void> {
  await page.goto("/signup");
  await fillSignup(page, user);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: `Hi, ${user.name.split(" ")[0]}` })).toBeVisible();
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

/** A form's error banner (scoped to <main>: Next's route announcer is also role="alert"). */
export function formAlert(page: Page): Locator {
  return page.getByRole("main").getByRole("alert");
}

/** A form's success banner. */
export function formStatus(page: Page): Locator {
  return page.getByRole("main").getByRole("status");
}

export async function logOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
}

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

type Actor = {
  user: TestUser;
  context: BrowserContext;
  page: Page;
  /** e.g. "/landlords/<uuid>" */
  profilePath: string;
};

/** Sign up a fresh user in their own browser context (separate cookies). */
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

/** Find a person's profile path by searching their directory. */
export async function findPersonPath(page: Page, role: Role, name: string): Promise<string> {
  await page.goto(`/${role}s?q=${encodeURIComponent(name)}`);
  const href = await page.getByRole("link", { name: new RegExp(escapeRegExp(name)) }).first().getAttribute("href");
  expect(href).toMatch(new RegExp(`^/${role}s/[0-9a-f-]{36}$`));
  return href!;
}

/** Find a property page path by searching the properties directory. */
export async function findPropertyPath(page: Page, query: string, label: string): Promise<string> {
  await page.goto(`/properties?q=${encodeURIComponent(query)}`);
  const href = await page
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

export async function fillReview(
  page: Page,
  review: { stars?: number; title: string; body: string },
): Promise<void> {
  if (review.stars) await pickStars(page, review.stars);
  await reviewTitleInput(page).fill(review.title);
  await reviewBodyInput(page).fill(review.body);
}

type Review = { stars: number; title: string; body: string };

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

/** Write a review on the subject page `path` and wait for it to be saved. */
export async function postReview(page: Page, path: string, review: Review): Promise<void> {
  await page.goto(path);
  await fillReview(page, review);
  await page.getByRole("button", { name: "Post review" }).click();
  await expect(formStatus(page)).toHaveText("Thanks! Your review is live.");
  await expect(reviewCard(page, review.title)).toBeVisible();
}

/** The big average number in the rating summary. */
export function summaryAverage(page: Page): Locator {
  return page.locator("p.text-5xl");
}

/** The "N reviews" line under the big average on a profile/property page. */
export function summaryCount(page: Page): Locator {
  return page.locator("p").filter({ hasText: /^(\d+ reviews?|No reviews yet)$/ }).first();
}

/** The number shown in one of the home page's stat tiles. */
export async function homeStat(page: Page, label: string): Promise<number> {
  const tile = page.locator("dl > div").filter({ has: page.locator("dt", { hasText: label }) });
  return Number((await tile.locator("dd").innerText()).replace(/,/g, ""));
}

/**
 * A directory card's meta line, item by item: role badge, property count,
 * "· Also a …", "· Account closed".
 */
export async function cardMeta(card: Locator): Promise<string[]> {
  return (await card.locator(":scope > div").last().locator(":scope > *").allInnerTexts()).map((t) => t.trim());
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
// Properties
// ---------------------------------------------------------------------------

type NewProperty = {
  address: string;
  unit?: string;
  city: string;
  region: string;
  postalCode?: string;
  description?: string;
};

export function makeProperty(overrides: Partial<NewProperty> = {}): NewProperty {
  const id = uid();
  return {
    address: `${100 + Math.floor(Math.random() * 9000)} E2e${id} St`,
    unit: "4A",
    city: "Testville",
    region: "TS",
    postalCode: "12345",
    description: "Sunny test apartment with a balcony.",
    ...overrides,
  };
}

/** "123 Main St, Unit 4A" — how the app labels a property. */
export function propertyLabel(p: NewProperty): string {
  return p.unit ? `${p.address}, Unit ${p.unit}` : p.address;
}

/**
 * Who the property belongs to, as the add-property form asks it:
 * - a landlord's name: pick them in the "Landlord" list (renters);
 * - { relation: "own" }: "Own or manage" (people with both roles);
 * - { relation: "rent", landlord? }: "Rent or used to rent", then optionally
 *   pick the landlord (people with both roles).
 */
type PropertyOwner = string | { relation: "own" } | { relation: "rent"; landlord?: string };

const RELATION_LABEL = { own: "Own or manage", rent: "Rent or used to rent" } as const;

/** The "This is a place I…" radio group shown to people with both roles. */
export function relationGroup(page: Page): Locator {
  return page.getByRole("radiogroup", { name: "This is a place I…" });
}

export function relationRadio(page: Page, relation: "own" | "rent"): Locator {
  return relationGroup(page).getByRole("radio", { name: RELATION_LABEL[relation] });
}

/**
 * The add-property form's "Landlord" list. (Not getByLabel("Landlord"): for
 * people with both roles that also matches the "Own or manage … your
 * landlord profile" radio.)
 */
export function landlordSelect(page: Page): Locator {
  return page.getByRole("combobox", { name: /^Landlord\b/ });
}

/** Pick `landlordName` in the add-property form's "Landlord" list. */
export async function pickLandlord(page: Page, landlordName: string): Promise<void> {
  const select = landlordSelect(page);
  const option = select.locator("option", { hasText: landlordName });
  await select.selectOption(await option.getAttribute("value"));
}

/** Fill the add-property form (on /properties/new) and submit it. */
export async function fillPropertyForm(
  page: Page,
  property: NewProperty,
  owner?: PropertyOwner,
): Promise<void> {
  await page.getByLabel("Street address").fill(property.address);
  await page.getByLabel("Unit").fill(property.unit ?? "");
  await page.getByLabel("City", { exact: true }).fill(property.city);
  await page.getByLabel("State / region").fill(property.region);
  await page.getByLabel("ZIP / postal code").fill(property.postalCode ?? "");
  await page.getByLabel("Short description").fill(property.description ?? "");
  if (typeof owner === "string") {
    await pickLandlord(page, owner);
  } else if (owner) {
    await relationRadio(page, owner.relation).check();
    if (owner.relation === "rent" && owner.landlord) await pickLandlord(page, owner.landlord);
  }
  await page.getByRole("button", { name: "Add property" }).click();
}

/** Add a property through the UI and return its page path. */
export async function addProperty(
  page: Page,
  property: NewProperty,
  owner?: PropertyOwner,
): Promise<string> {
  await page.goto("/properties/new");
  await fillPropertyForm(page, property, owner);
  await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: propertyLabel(property) })).toBeVisible();
  return new URL(page.url()).pathname;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
