import { expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

/** Password of every seeded demo account. */
export const DEMO_PASSWORD = "password123";

/** Seeded demo data (src/db/seed.ts) that browsing tests rely on. */
export const DEMO = {
  landlords: {
    maria: { name: "Maria Gonzalez", email: "maria@example.com", city: "Austin, TX" },
    northgate: { name: "Northgate Property Group", email: "office@northgate.example.com", city: "Chicago, IL" },
    sam: { name: "Sam Whitfield", email: "sam@example.com", city: "Portland, OR" },
    priya: { name: "Priya Raman", email: "priya@example.com", city: "Denver, CO" },
  },
  renters: {
    jordan: { name: "Jordan Ellis", email: "jordan@example.com", city: "Austin, TX" },
    aisha: { name: "Aisha Bello", email: "aisha@example.com", city: "Chicago, IL" },
    tom: { name: "Tom Becker", email: "tom@example.com", city: "Portland, OR" },
    lena: { name: "Lena Kowalski", email: "lena@example.com", city: "Chicago, IL" },
    marcus: { name: "Marcus Reed", email: "marcus@example.com", city: "Denver, CO" },
  },
} as const;

export type Role = "landlord" | "renter";

export type TestUser = {
  role: Role;
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

/** A brand-new user (not yet signed up) with a unique name and email. */
export function makeUser(role: Role, overrides: Partial<TestUser> = {}): TestUser {
  const id = uid();
  return {
    role,
    name: `${role === "landlord" ? "Lana" : "Remy"} E2e${id}`,
    email: `e2e-${role}-${id}@example.com`,
    password: `pw-${id}-secret`,
    city: "Testville, TS",
    ...overrides,
  };
}

/** Fill and submit the sign-up form. Doesn't wait for the result. */
export async function fillSignup(page: Page, user: TestUser): Promise<void> {
  const roleLabel = user.role === "landlord" ? "I'm a landlord" : "I'm a renter";
  await page.locator("label", { hasText: roleLabel }).click();
  await expect(page.getByRole("radio", { name: roleLabel })).toBeChecked();
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

/** The signed-in user's public profile path, read from the dashboard. */
export async function myProfilePath(page: Page): Promise<string> {
  await page.goto("/dashboard");
  const href = await page.getByRole("link", { name: "View public profile" }).getAttribute("href");
  expect(href).toMatch(/^\/(landlords|renters)\/[0-9a-f-]{36}$/);
  return href!;
}

export type Actor = {
  user: TestUser;
  context: BrowserContext;
  page: Page;
  /** e.g. "/landlords/<uuid>" */
  profilePath: string;
};

/** Sign up a fresh user in their own browser context (separate cookies). */
export async function createActor(
  browser: Browser,
  role: Role,
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

export type NewProperty = {
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

/** Fill the add-property form (on /properties/new) and submit it. */
export async function fillPropertyForm(
  page: Page,
  property: NewProperty,
  landlordName?: string,
): Promise<void> {
  await page.getByLabel("Street address").fill(property.address);
  await page.getByLabel("Unit").fill(property.unit ?? "");
  await page.getByLabel("City", { exact: true }).fill(property.city);
  await page.getByLabel("State / region").fill(property.region);
  await page.getByLabel("ZIP / postal code").fill(property.postalCode ?? "");
  await page.getByLabel("Short description").fill(property.description ?? "");
  if (landlordName) {
    const select = page.getByLabel("Landlord");
    const option = select.locator("option", { hasText: landlordName });
    await select.selectOption(await option.getAttribute("value"));
  }
  await page.getByRole("button", { name: "Add property" }).click();
}

/** Add a property through the UI and return its page path. */
export async function addProperty(
  page: Page,
  property: NewProperty,
  landlordName?: string,
): Promise<string> {
  await page.goto("/properties/new");
  await fillPropertyForm(page, property, landlordName);
  await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: propertyLabel(property) })).toBeVisible();
  return new URL(page.url()).pathname;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
