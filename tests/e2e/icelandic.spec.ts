import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import {
  DEMO,
  findPersonPath,
  FIX_FIELDS,
  formAlert,
  horizontalOverflow,
  LANGUAGE_NAME,
  languageButton,
  makeUser,
  NOT_A_KENNITALA,
  setLanguage,
  signUp,
  summaryAverage,
  switchLanguage,
  watchErrors,
  type Locale,
} from "./helpers";

/*
 * The site in Icelandic, its default language, and the switch to English.
 *
 * Every other spec runs in English (playwright.config.ts gives each context a
 * `lang=en` cookie). This one starts without the cookie, like a first-time
 * visitor, and sets it only where a test says so.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const NO_COOKIES = { cookies: [], origins: [] };

/** A context with its own cookies, as a visitor whose browser is set to `locale` (e.g. "en-US"). */
async function newVisitor(
  browser: Browser,
  options: { locale?: string; javaScriptEnabled?: boolean; lang?: Locale | null } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    storageState: NO_COOKIES,
    javaScriptEnabled: options.javaScriptEnabled ?? true,
    locale: options.locale,
  });
  await setLanguage(context, options.lang ?? null);
  return { context, page: await context.newPage() };
}

function htmlLang(page: Page): Locator {
  return page.locator("html");
}

/** The English line above the header for visitors who haven't picked a language. */
function hintText(page: Page): Locator {
  return page.getByText("This site is in Icelandic.", { exact: true });
}

function hintButton(page: Page): Locator {
  return page.getByRole("button", { name: "Switch to English", exact: true });
}

/** The hint's other button, in Icelandic, for visitors who want to stay in Icelandic. */
function stayButton(page: Page): Locator {
  return page.getByRole("button", { name: "Halda áfram á íslensku", exact: true });
}

function mainNav(page: Page, locale: Locale): Locator {
  return page.getByRole("navigation", { name: locale === "is" ? "Aðalvalmynd" : "Main" });
}

/** The visitor's `lang` cookie, if any. */
async function langCookie(context: BrowserContext) {
  return (await context.cookies()).find((cookie) => cookie.name === "lang");
}

/** Icelandic plural category: "one" for 1, 21, 31, 101… but not 11 or 111. */
function isOne(n: number): boolean {
  return n % 10 === 1 && n % 100 !== 11;
}

function reviewsIs(n: number): string {
  return `${n} ${isOne(n) ? "umsögn" : "umsagnir"}`;
}

/** An English decimal ("4.5") as Icelandic writes it ("4,5"). */
function decimalIs(value: string): string {
  return value.replace(".", ",");
}

const JON_QUERY = "/landlords?q=J%C3%B3n&sort=name";

/** The path and query are what they were: /landlords?q=Jón&sort=name. */
async function expectOnJonQuery(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/landlords\?/);
  const url = new URL(page.url());
  expect(url.pathname).toBe("/landlords");
  expect(Object.fromEntries(url.searchParams)).toEqual({ q: "Jón", sort: "name" });
}

/** The directory summary for /landlords?q=Jón, in either language. */
async function expectJonDirectory(page: Page, locale: Locale): Promise<void> {
  const main = page.getByRole("main");
  const search = main.getByRole("searchbox");
  await expect(search).toHaveValue("Jón");
  const sort = main.getByRole("combobox");
  if (locale === "is") {
    await expect(main.getByRole("heading", { level: 1, name: "Leigusalar" })).toBeVisible();
    const summary = main.getByText(/^\d+ leigusal(i passar|ar passa) við „Jón“ · Hreinsa leit$/);
    await expect(summary).toBeVisible();
    const count = Number((await summary.innerText()).match(/^\d+/)![0]);
    await expect(summary).toHaveText(
      isOne(count)
        ? `${count} leigusali passar við „Jón“ · Hreinsa leit`
        : `${count} leigusalar passa við „Jón“ · Hreinsa leit`,
    );
    await expect(sort.locator("option:checked")).toHaveText("A–Ö");
    await expect(main.getByRole("button", { name: "Leita", exact: true })).toBeVisible();
  } else {
    await expect(main.getByRole("heading", { level: 1, name: "Landlords" })).toBeVisible();
    await expect(main.getByText(/^\d+ landlords? matching “Jón” · Clear search$/)).toBeVisible();
    await expect(sort.locator("option:checked")).toHaveText("A–Z");
    await expect(main.getByRole("button", { name: "Search", exact: true })).toBeVisible();
  }
  await expect(main.getByRole("link", { name: new RegExp(DEMO.people.jon.name) })).toBeVisible();
}

// ---------------------------------------------------------------------------
// Icelandic by default
// ---------------------------------------------------------------------------

test.describe("Icelandic by default", () => {
  // A browser set to Icelandic, so there's no English hint either.
  test.use({ locale: "is-IS" });

  test("a first visit is in Icelandic: page language, title, navigation, home page and footer", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await expect(htmlLang(page)).toHaveAttribute("lang", "is");
    await expect(page).toHaveTitle("GossipRent — umsagnir um leigusala og leigjendur");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /^Leigjendur skrifa umsagnir um leigusala sína/,
    );
    await expect(hintText(page)).toHaveCount(0);

    // Header: navigation, account links, and the switch to English (labelled in English).
    const header = page.getByRole("banner");
    const nav = mainNav(page, "is");
    for (const [name, href] of [
      ["Leigusalar", "/landlords"],
      ["Leigjendur", "/renters"],
      ["Eignir", "/properties"],
      ["Skrifa umsögn", "/reviews/new"],
    ]) {
      await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
    }
    await expect(header.getByRole("link", { name: "Skrá inn", exact: true })).toHaveAttribute("href", "/login");
    await expect(header.getByRole("link", { name: "Nýskráning", exact: true })).toHaveAttribute("href", "/signup");
    await expect(languageButton(page, "en")).toHaveAttribute("lang", "en");
    await expect(languageButton(page, "is")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Fara beint í efni" })).toHaveAttribute("href", "#main");
    await expect(header.getByText(/^(Log in|Sign up|Landlords)$/)).toHaveCount(0);

    // Home page copy.
    const main = page.getByRole("main");
    await expect(main.getByText("Umsagnir um leigusala og leigjendur", { exact: true })).toBeVisible();
    await expect(main.getByRole("heading", { level: 1, name: "Leigðu með opin augun." })).toBeVisible();
    await expect(main.getByRole("searchbox", { name: "Leita að leigusölum, leigjendum og eignum" })).toHaveAttribute(
      "placeholder",
      "Nafn, heimilisfang eða póstnúmer",
    );
    await expect(main.getByRole("button", { name: "Leita", exact: true })).toBeVisible();
    await expect(main.getByRole("region", { name: "Fletta upp kennitölu" })).toBeVisible();
    for (const label of ["Umsagnir", "Leigusalar", "Leigjendur", "Eignir"]) {
      await expect(main.locator("dl dt", { hasText: label })).toHaveText(label);
    }
    for (const title of [
      "Skrifaðu umsögn um leigusalann þinn",
      "Skrifaðu umsögn um eignina sem þú leigir",
      "Skrifaðu umsögn um leigjendur þína",
    ]) {
      await expect(main.getByRole("heading", { level: 3, name: title })).toBeVisible();
    }
    // The latest reviews say what they're about in Icelandic ("Umsögn um leigusala: Sigrún …").
    // Only landlords and properties: renters' pages aren't indexed, so reviews of them stay off this page.
    const latest = main.getByRole("region", { name: "Nýjustu umsagnir" });
    await expect(latest.locator("article").first()).toBeVisible();
    await expect(latest.getByText(/^Umsögn um leigjanda: /)).toHaveCount(0);
    for (const card of await latest.locator("article").all()) {
      await expect(card.getByText(/^Umsögn um (leigusala|eign): /)).toBeVisible();
      await expect(card.getByRole("img", { name: /^Einkunn [1-5] af 5$/ })).toBeVisible();
      await expect(card.getByRole("link", { name: "Tilkynna", exact: true })).toBeVisible();
    }
    await expect(
      main.getByRole("heading", { name: "Hefur þú haft leigusala eða leigjanda sem vert er að segja frá?" }),
    ).toBeVisible();
    await expect(main.getByRole("link", { name: "Ég er leigjandi" })).toHaveAttribute("href", "/signup?role=renter");

    // Footer: links, the switch, and the disclaimer.
    const footer = page.getByRole("contentinfo");
    for (const [name, href] of [
      ["Leigusalar", "/landlords"],
      ["Leigjendur", "/renters"],
      ["Eignir", "/properties"],
      ["Persónuvernd", "/privacy"],
    ]) {
      await expect(footer.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
    }
    await expect(languageButton(page, "en", "footer")).toHaveAttribute("lang", "en");
    await expect(
      footer.getByText("Umsagnir lýsa skoðunum höfunda sinna. Ekki er gengið úr skugga um hver fólk er.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(footer.getByText(`© ${new Date().getFullYear()} GossipRent.`, { exact: true })).toBeVisible();

    // Just visiting doesn't pick a language for you.
    expect(await langCookie(context)).toBeUndefined();
  });

  test("every page's title and heading are in Icelandic", async ({ page }) => {
    const pages: [path: string, title: string, heading: string][] = [
      ["/landlords", "Leigusalar · GossipRent", "Leigusalar"],
      ["/renters", "Leigjendur · GossipRent", "Leigjendur"],
      ["/properties", "Eignir · GossipRent", "Eignir"],
      ["/search", "Leit · GossipRent", "Leit"],
      ["/login", "Innskráning · GossipRent", "Gaman að sjá þig aftur"],
      ["/signup", "Nýskráning · GossipRent", "Stofnaðu aðgang"],
      ["/privacy", "Persónuvernd · GossipRent", "Persónuvernd"],
      ["/report?target=account", "Tilkynna vandamál · GossipRent", "Tilkynna vandamál"],
    ];
    for (const [path, title, heading] of pages) {
      await page.goto(path);
      await expect(page, path).toHaveTitle(title);
      await expect(page.getByRole("heading", { level: 1, name: heading }), path).toBeVisible();
      await expect(htmlLang(page), path).toHaveAttribute("lang", "is");
    }

    // A profile and a property page.
    const sigrun = DEMO.people.sigrun;
    await page.goto(await findPersonPath(page, "landlord", sigrun.name));
    await expect(page).toHaveTitle(`${sigrun.name} (leigusali) — umsagnir · GossipRent`);
    await expect(page.getByText("Auðkenni ekki staðfest", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Tilkynna þessa síðu" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Hefur þú leigt af þessum leigusala?" })).toBeVisible();

    await page.goto("/properties?q=Nj%C3%A1lsgata");
    await page.getByRole("main").getByRole("link", { name: /Njálsgata 23, íbúð 0201/ }).click();
    await expect(page).toHaveTitle("Njálsgata 23, íbúð 0201, 101 Reykjavík — umsagnir · GossipRent");
    await expect(page.getByRole("heading", { level: 1, name: "Njálsgata 23, íbúð 0201" })).toBeVisible();
    await expect(page.getByText("101 Reykjavík", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(`Leigusali: ${sigrun.name}`, { exact: true })).toBeVisible();

    // The not-found page.
    const response = await page.goto("/no-such-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Þessi síða fannst ekki" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Á forsíðu" })).toHaveAttribute("href", "/");
  });
});

// ---------------------------------------------------------------------------
// The English hint
// ---------------------------------------------------------------------------

test.describe("the English hint", () => {
  test("a browser that prefers English is offered English, and the hint's button switches", async ({
    page,
    context,
  }) => {
    // Playwright's browser asks for American English (Accept-Language: en-US).
    await page.goto(JON_QUERY);
    await expect(htmlLang(page)).toHaveAttribute("lang", "is");
    await expectJonDirectory(page, "is");

    // One English line above the header, marked as English for screen readers.
    await expect(hintText(page)).toBeVisible();
    await expect(page.locator('[lang="en"]').filter({ has: hintText(page) })).toHaveCount(1);
    await expect(hintButton(page)).toBeVisible();
    // ...with a way to stay in Icelandic, in Icelandic.
    await expect(stayButton(page)).toBeVisible();
    await expect(stayButton(page)).toHaveAttribute("lang", "is");
    const hintBox = await hintText(page).boundingBox();
    const headerBox = await page.getByRole("banner").boundingBox();
    expect(hintBox!.y).toBeLessThan(headerBox!.y);

    await hintButton(page).click();
    await expect(htmlLang(page)).toHaveAttribute("lang", "en");
    await expectOnJonQuery(page);
    await expectJonDirectory(page, "en");
    await expect(hintText(page)).toHaveCount(0);
    await expect(languageButton(page, "is")).toBeVisible();

    // The choice is remembered: an httpOnly cookie for a year, for the whole site.
    const cookie = await langCookie(context);
    // (Secure too: the tests run the production build, and Chromium treats localhost as secure.)
    expect(cookie).toMatchObject({ value: "en", httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    const days = (cookie!.expires * 1000 - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(360);
    expect(days).toBeLessThan(370);

    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
    await expect(hintText(page)).toHaveCount(0);
  });

  test("“Halda áfram á íslensku” keeps the Icelandic page and puts the hint away for good", async ({ page, context }) => {
    await page.goto(JON_QUERY);
    await expect(hintText(page)).toBeVisible();
    const historyLength = await page.evaluate(() => history.length);

    await stayButton(page).click();
    await expect(hintText(page)).toHaveCount(0);
    await expect(htmlLang(page)).toHaveAttribute("lang", "is");
    await expectOnJonQuery(page);
    await expectJonDirectory(page, "is");
    // The same page, replaced in the history rather than added to it.
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    // Icelandic is now a choice, remembered like any other.
    expect(await langCookie(context)).toMatchObject({ value: "is", httpOnly: true, sameSite: "Lax", path: "/" });
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 1, name: "Persónuvernd" })).toBeVisible();
    await expect(hintText(page)).toHaveCount(0);
    // The header still offers English.
    await expect(languageButton(page, "en")).toBeVisible();
  });

  test("only visitors who haven't picked a language and don't prefer Icelandic see it", async ({
    browser,
    request,
  }) => {
    // Browsers set to a language.
    for (const [locale, hint] of [
      ["en-GB", true],
      ["pl-PL", true],
      ["is-IS", false],
      ["is", false],
    ] as const) {
      const { context, page } = await newVisitor(browser, { locale });
      await page.goto("/");
      await expect(htmlLang(page), locale).toHaveAttribute("lang", "is");
      await expect(hintText(page), locale).toHaveCount(hint ? 1 : 0);
      await expect(hintButton(page), locale).toHaveCount(hint ? 1 : 0);
      await expect(stayButton(page), locale).toHaveCount(hint ? 1 : 0);
      await context.close();
    }

    // The ranking in the Accept-Language header, and a language already picked.
    const cases: { acceptLanguage: string; cookie?: string; hint: boolean; html: Locale }[] = [
      { acceptLanguage: "en-US,en;q=0.9,is;q=0.8", hint: true, html: "is" },
      { acceptLanguage: "is-IS,is;q=0.9,en;q=0.8", hint: false, html: "is" },
      { acceptLanguage: "en;q=0.5, is", hint: false, html: "is" },
      { acceptLanguage: "is;q=0, en", hint: true, html: "is" },
      { acceptLanguage: "", hint: true, html: "is" },
      { acceptLanguage: "en-GB,en;q=0.9", cookie: "lang=is", hint: false, html: "is" },
      { acceptLanguage: "en-GB,en;q=0.9", cookie: "lang=en", hint: false, html: "en" },
      // A cookie for a language the site doesn't have counts as no choice.
      { acceptLanguage: "en-GB,en;q=0.9", cookie: "lang=de", hint: true, html: "is" },
    ];
    for (const { acceptLanguage, cookie, hint, html } of cases) {
      const label = `Accept-Language: ${acceptLanguage}; Cookie: ${cookie ?? "none"}`;
      const response = await request.get("/", {
        headers: { "Accept-Language": acceptLanguage, ...(cookie ? { Cookie: cookie } : {}) },
      });
      const body = await response.text();
      expect(body, label).toContain(`<html lang="${html}"`);
      expect(body.includes("This site is in Icelandic."), label).toBe(hint);
    }
  });
});

// ---------------------------------------------------------------------------
// The language switch
// ---------------------------------------------------------------------------

test.describe("the language switch", () => {
  test("the header button switches to English and back, keeping the path and query", async ({ page }) => {
    await page.goto("/");
    await page.goto(JON_QUERY);
    await expectJonDirectory(page, "is");
    const historyLength = await page.evaluate(() => history.length);

    await expect(languageButton(page, "en")).toHaveAttribute("lang", "en");
    await switchLanguage(page, "en");
    await expectOnJonQuery(page);
    await expectJonDirectory(page, "en");
    await expect(page).toHaveTitle("Landlords · GossipRent");
    await expect(mainNav(page, "en").getByRole("link", { name: "Landlords", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // The page in the other language replaces this one in the history.
    expect(await page.evaluate(() => history.length)).toBe(historyLength);

    await expect(languageButton(page, "is")).toHaveAttribute("lang", "is");
    await switchLanguage(page, "is");
    await expectOnJonQuery(page);
    await expectJonDirectory(page, "is");
    await expect(page).toHaveTitle("Leigusalar · GossipRent");
    expect(await page.evaluate(() => history.length)).toBe(historyLength);

    // Back goes to the page before, not to the same page in the other language.
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Leigðu með opin augun." })).toBeVisible();
  });

  test("the footer button switches too, and forms on the page follow the language", async ({ page }) => {
    await page.goto("/signup?role=landlord&next=%2Fproperties%2Fnew");
    await expect(page.getByLabel("Nafn", { exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Ég er leigusali/ })).toBeChecked();

    await switchLanguage(page, "en", "footer");
    await expect(page).toHaveURL("/signup?role=landlord&next=%2Fproperties%2Fnew");
    await expect(page.getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();
    // The form is a client component: it re-renders with the English dictionary.
    await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Nafn", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: /I'm a landlord/ })).toBeChecked();
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
    // ...and the server answers in English.
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(formAlert(page)).toHaveText(FIX_FIELDS);
    await expect(page.getByText("Enter a kennitala.", { exact: true })).toBeVisible();

    await switchLanguage(page, "is", "footer");
    await expect(page).toHaveURL("/signup?role=landlord&next=%2Fproperties%2Fnew");
    await expect(page.getByRole("heading", { level: 1, name: "Stofnaðu aðgang" })).toBeVisible();
    await page.getByRole("button", { name: "Stofna aðgang" }).click();
    await expect(formAlert(page)).toHaveText("Lagaðu merktu reitina.");
    await expect(page.getByText("Sláðu inn kennitölu.", { exact: true })).toBeVisible();
  });

  test("on a phone the header button reads “EN” but is still called “English”", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    for (const [to, short] of [
      ["en", "EN"],
      ["is", "IS"],
    ] as const) {
      // Found by its accessible name ("English" / "Íslenska")...
      const button = languageButton(page, to);
      await expect(button).toBeVisible();
      await expect(button).toHaveAttribute("lang", to);
      // ...but what shows is the short code; the full name is visually hidden.
      const visible = button.locator('span[aria-hidden="true"]');
      await expect(visible).toHaveText(short);
      await expect(visible).toBeVisible();
      const fullName = await button.getByText(LANGUAGE_NAME[to], { exact: true }).boundingBox();
      expect(fullName!.width).toBeLessThanOrEqual(1);
      await switchLanguage(page, to);
    }
    await expect(page.getByRole("heading", { level: 1, name: "Leigðu með opin augun." })).toBeVisible();
  });

  test("without JavaScript, the header, footer and hint buttons switch and keep the path and query", async ({
    browser,
  }) => {
    const { context, page } = await newVisitor(browser, { javaScriptEnabled: false, locale: "en-US" });
    await page.goto(JON_QUERY);
    await expectJonDirectory(page, "is");
    await expect(hintText(page)).toBeVisible();

    await languageButton(page, "en").click();
    await expect(htmlLang(page)).toHaveAttribute("lang", "en");
    await expectOnJonQuery(page);
    await expectJonDirectory(page, "en");
    await expect(hintText(page)).toHaveCount(0);

    await languageButton(page, "is", "footer").click();
    await expect(htmlLang(page)).toHaveAttribute("lang", "is");
    await expectOnJonQuery(page);
    await expectJonDirectory(page, "is");
    // Picking Icelandic is a choice too: no more hint.
    await expect(hintText(page)).toHaveCount(0);
    expect(await langCookie(context)).toMatchObject({ value: "is", httpOnly: true });

    await languageButton(page, "en", "footer").click();
    await expect(htmlLang(page)).toHaveAttribute("lang", "en");
    await expectOnJonQuery(page);

    // The hint's "stay in Icelandic" button.
    await context.clearCookies({ name: "lang" });
    await page.goto(JON_QUERY);
    await stayButton(page).click();
    await expect(hintText(page)).toHaveCount(0);
    await expect(htmlLang(page)).toHaveAttribute("lang", "is");
    await expectOnJonQuery(page);
    expect(await langCookie(context)).toMatchObject({ value: "is", httpOnly: true });

    // The hint's English button, on a page with a path and a query of its own.
    await context.clearCookies({ name: "lang" });
    await page.goto("/search?q=Akureyri");
    await expect(page.getByRole("heading", { level: 1, name: "Niðurstöður fyrir „Akureyri“" })).toBeVisible();
    await hintButton(page).click();
    await expect(htmlLang(page)).toHaveAttribute("lang", "en");
    await expect(page).toHaveURL("/search?q=Akureyri");
    await expect(page.getByRole("heading", { level: 1, name: "Results for “Akureyri”" })).toBeVisible();
    await context.close();
  });

  test("a tampered switch can't leave the site or set a language the site doesn't have", async ({
    page,
    context,
    baseURL,
  }) => {
    const next = page.locator('header form input[name="next"]');
    for (const evil of ["https://evil.example/", "//evil.example/x", "/\\evil.example"]) {
      await page.goto("/landlords");
      await next.evaluate((input: HTMLInputElement, value) => (input.value = value), evil);
      await languageButton(page, "en").click();
      await expect(htmlLang(page)).toHaveAttribute("lang", "en");
      expect(new URL(page.url()).origin, evil).toBe(new URL(baseURL!).origin);
      await expect(page, evil).toHaveURL(/\/$/);
      await setLanguage(context, null);
    }

    // An unknown language is ignored: still Icelandic, no cookie, but back on the page.
    await page.goto("/landlords?sort=name");
    await page
      .locator('header form button[name="locale"]')
      .evaluate((button: HTMLButtonElement) => (button.value = "de"));
    await languageButton(page, "en").click();
    await expect(page).toHaveURL("/landlords?sort=name");
    await expect(htmlLang(page)).toHaveAttribute("lang", "is");
    await expect(page.getByRole("heading", { level: 1, name: "Leigusalar" })).toBeVisible();
    expect(await langCookie(context)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Icelandic formatting
// ---------------------------------------------------------------------------

/** A profile's big average ("4.5" / "4,5") and review count, from its rating summary. */
async function ratingSummary(page: Page): Promise<{ average: string; count: string }> {
  return {
    average: (await summaryAverage(page).innerText()).trim(),
    count: (await page.locator("p.text-5xl ~ p").innerText()).trim(),
  };
}

/** The "N reviews" counts of a profile's 5★…1★ rows, read from the English page. */
async function breakdownCounts(page: Page): Promise<number[]> {
  const rows = page.getByRole("list", { name: "Rating breakdown" }).getByRole("listitem");
  await expect(rows).toHaveCount(5);
  return (await rows.allTextContents()).map((text) => Number(text.match(/(\d+) reviews?$/)![1]));
}

test.describe("Icelandic formatting", () => {
  test("ratings use a decimal comma and counts use Icelandic plurals", async ({ page, context }) => {
    // Read each seeded landlord's numbers in English, then expect them in Icelandic.
    let decimals = 0;
    for (const key of ["sigrun", "gunnar"] as const) {
      const person = DEMO.people[key];
      const path = await findPersonPath(page, "landlord", person.name);

      await setLanguage(context, "en");
      await page.goto(path);
      const en = await ratingSummary(page);
      const count = Number(en.count.match(/^(\d+) reviews?$/)![1]);
      const rows = await breakdownCounts(page);
      if (en.average.includes(".")) decimals += 1;

      await setLanguage(context, "is");
      await page.goto(path);
      await expect(summaryAverage(page)).toHaveText(decimalIs(en.average));
      await expect(page.locator("p.text-5xl ~ p")).toHaveText(reviewsIs(count));
      await expect(page.getByRole("img", { name: `Einkunn ${decimalIs(en.average)} af 5` }).first()).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: `Umsagnir (${count})` })).toBeVisible();
      const breakdown = page.getByRole("list", { name: "Skipting einkunna" }).getByRole("listitem");
      for (const [i, stars] of [5, 4, 3, 2, 1].entries()) {
        const label = stars === 1 ? "1 stjarna" : `${stars} stjörnur`;
        await expect(breakdown.nth(i), `${person.name}, ${stars}★`).toHaveText(
          new RegExp(`^${label}\\s*${reviewsIs(rows[i]).replace(" ", "\\s*")}$`),
        );
      }

      // The directory card: "4,5 · 2 umsagnir".
      await page.goto(`/landlords?q=${encodeURIComponent(person.name)}`);
      const card = page.getByRole("main").getByRole("link", { name: new RegExp(person.name) });
      await expect(card).toContainText(`${decimalIs(en.average)} · ${reviewsIs(count)}`);
    }
    // At least one of them has a half-star average, so the decimal comma was really checked.
    expect(decimals).toBeGreaterThan(0);

    // Someone with both roles: the tabs show each role's rating and count.
    const olafur = DEMO.people.olafur;
    const path = await findPersonPath(page, "landlord", olafur.name);
    await setLanguage(context, "en");
    await page.goto(path);
    const tabsEn = page.getByRole("navigation", { name: "Ratings by role" }).getByRole("link");
    const tabs: { role: string; average: string; count: number }[] = [];
    for (const tab of await tabsEn.all()) {
      const text = (await tab.textContent())!.replace(/\s+/g, " ").trim();
      const match = text.match(/^As a (landlord|renter) \(([\d.]+)★ stars, (\d+) reviews?\)$/)!;
      expect(match, text).not.toBeNull();
      tabs.push({ role: match[1], average: match[2], count: Number(match[3]) });
    }
    expect(tabs.map((tab) => tab.role)).toEqual(["landlord", "renter"]);

    await setLanguage(context, "is");
    await page.goto(path);
    const tabsIs = page.getByRole("navigation", { name: "Einkunnir eftir hlutverki" }).getByRole("link");
    await expect(tabsIs).toHaveCount(2);
    for (const [i, tab] of tabs.entries()) {
      const role = tab.role === "landlord" ? "Sem leigusali" : "Sem leigjandi";
      await expect(tabsIs.nth(i)).toHaveText(`${role} (${decimalIs(tab.average)}★ af 5, ${reviewsIs(tab.count)})`);
    }
    await expect(page.getByRole("heading", { name: `${olafur.name}: einkunn sem leigusali` })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: `Umsagnir sem leigusali (${tabs[0].count})` })).toBeVisible();
  });

  test("the directory count follows the Icelandic plural rule", async ({ page, context }) => {
    for (const [path, english, one, other] of [
      ["/landlords", /^\d+ landlords?$/, "leigusali", "leigusalar"],
      ["/renters", /^\d+ renters?$/, "leigjandi", "leigjendur"],
      ["/properties", /^\d+ propert(y|ies)$/, "eign", "eignir"],
    ] as const) {
      await setLanguage(context, "en");
      await page.goto(path);
      const summary = page.getByRole("main").getByText(english);
      const count = Number((await summary.innerText()).match(/^\d+/)![0]);

      await setLanguage(context, "is");
      await page.goto(path);
      const expected = `${count} ${isOne(count) ? one : other}`;
      await expect(page.getByRole("main").getByText(expected, { exact: true })).toBeVisible();
    }
    // The plural rule itself: 21 is singular, 11 isn't.
    expect([1, 21, 31, 101, 121].every(isOne)).toBe(true);
    expect([0, 2, 11, 12, 111].some(isOne)).toBe(false);
  });

  test("the browser formats numbers like the server: no hydration errors, same text after client navigation", async ({
    page,
  }) => {
    // Not every browser has Icelandic number data (this Chromium doesn't); the
    // client must still write "4,5" where the server did, or React reports a
    // hydration mismatch and replaces the server's HTML.
    const errors = watchErrors(page);
    const sigrun = DEMO.people.sigrun;
    const sigrunPath = await findPersonPath(page, "landlord", sigrun.name);
    const olafurPath = await findPersonPath(page, "renter", DEMO.people.olafur.name);
    const browserHasIcelandic = await page.evaluate(() => Intl.NumberFormat.supportedLocalesOf(["is-IS"]).length > 0);
    test.info().annotations.push({ type: "browser has Icelandic number data", description: String(browserHasIcelandic) });
    const paths = ["/", "/landlords", "/renters?sort=name", "/properties", "/search?q=Reykjav%C3%ADk", sigrunPath, olafurPath];
    for (const path of paths) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expect(htmlLang(page), path).toHaveAttribute("lang", "is");
    }

    // Server-rendered…
    await page.goto("/landlords");
    const card = page.getByRole("main").getByRole("link", { name: new RegExp(sigrun.name) });
    // "4,5 · 2 umsagnir"
    const rating = card.getByText(/^\d(,\d)? · \d+ (umsögn|umsagnir)$/);
    const serverText = (await rating.innerText()).trim();
    // …and rendered in the browser after a client-side navigation.
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await mainNav(page, "is").getByRole("link", { name: "Leigusalar", exact: true }).click();
    await expect(page).toHaveURL("/landlords");
    await expect(rating).toHaveText(serverText);
    await card.click();
    await expect(page).toHaveURL(sigrunPath);
    await expect(summaryAverage(page)).toHaveText(serverText.split(" · ")[0]);
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });

  test("dates use Icelandic month names in lower case", async ({ page, context }) => {
    const sigrun = DEMO.people.sigrun;
    const path = await findPersonPath(page, "landlord", sigrun.name);

    await setLanguage(context, "en");
    await page.goto(path);
    await expect(page.getByText(/^Reykjavík · Member since [A-Z][a-z]+ \d{4}$/)).toBeVisible();
    const dateEn = page.locator("article time").first();
    await expect(dateEn).toHaveText(/^\d{1,2} [A-Z][a-z]{2,3} \d{4}$/);

    await setLanguage(context, "is");
    await page.goto(path);
    await expect(page.getByText(/^Reykjavík · Á GossipRent síðan í [a-záéíóúýðþæö]+ \d{4}$/)).toBeVisible();
    // "3. okt. 2026", "15. maí 2026".
    for (const time of await page.locator("article time").all()) {
      await expect(time).toHaveText(/^\d{1,2}\. [a-záéíóúýðþæö]+\.? \d{4}$/);
    }
    // A profile without an account says when it was first reviewed.
    await page.goto(await findPersonPath(page, "landlord", DEMO.people.gunnar.name));
    await expect(page.getByText(/^Fyrsta umsögn í [a-záéíóúýðþæö]+ \d{4}$/)).toBeVisible();
    await expect(page.getByText("Án aðgangs", { exact: true }).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Forms in Icelandic
// ---------------------------------------------------------------------------

test.describe("forms in Icelandic", () => {
  test("sign-up errors are in Icelandic", async ({ page }) => {
    await page.goto("/signup");
    await page.getByRole("button", { name: "Stofna aðgang" }).click();
    await expect(formAlert(page)).toHaveText("Lagaðu merktu reitina.");
    const main = page.getByRole("main");
    for (const message of [
      "Veldu að minnsta kosti eitt: leigjandi, leigusali eða hvort tveggja.",
      "Sláðu inn kennitölu.",
      "Nafn þarf að vera minnst 2 stafir.",
      "Sláðu inn gilt netfang.",
      "Lykilorð þarf að vera minnst 8 stafir.",
    ]) {
      await expect(main.getByText(message, { exact: true })).toBeVisible();
    }
    // Focus goes to the first field to fix.
    await expect(page.getByRole("checkbox", { name: /Ég er leigjandi/ })).toBeFocused();

    // A number that isn't a kennitala, and a name with digits in it.
    await page.getByRole("checkbox", { name: /Ég er leigjandi/ }).check();
    await page.getByLabel("Kennitala", { exact: true }).fill(NOT_A_KENNITALA);
    await page.getByLabel("Nafn", { exact: true }).fill("Jón 2");
    await page.getByLabel("Netfang").fill("jon@example.com");
    await page.getByLabel("Lykilorð").fill("password123");
    await page.getByRole("button", { name: "Stofna aðgang" }).click();
    await expect(
      main.getByText("Þetta er ekki gild kennitala. Sláðu inn 10 tölustafi, t.d. 123456-7890.", { exact: true }),
    ).toBeVisible();
    await expect(
      main.getByText("Nafn má aðeins innihalda bókstafi, bil, bandstrik, úrfellingarmerki og punkta.", { exact: true }),
    ).toBeVisible();
    // What was typed is kept (except the password).
    await expect(page.getByLabel("Kennitala", { exact: true })).toHaveValue(NOT_A_KENNITALA);
    await expect(page.getByLabel("Netfang")).toHaveValue("jon@example.com");
    await expect(page.getByLabel("Lykilorð")).toHaveValue("");
    await expect(htmlLang(page)).toHaveAttribute("lang", "is");
  });

  test("a wrong password, a company kennitala and a logged-out lookup are answered in Icelandic", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Netfang").fill(DEMO.people.sigrun.email);
    await page.getByLabel("Lykilorð").fill("not-the-password");
    await page.getByRole("button", { name: "Skrá inn", exact: true }).first().click();
    await expect(formAlert(page)).toHaveText("Netfangið og lykilorðið passa ekki við neinn aðgang.");
    await expect(page.getByLabel("Netfang")).toHaveValue(DEMO.people.sigrun.email);

    await page.goto("/signup");
    const user = makeUser("renter");
    await page.getByRole("checkbox", { name: /Ég er leigjandi/ }).check();
    await page.getByLabel("Kennitala", { exact: true }).fill(DEMO.people.leigufelag.kennitala);
    await page.getByLabel("Nafn", { exact: true }).fill(user.name);
    await page.getByLabel("Netfang").fill(user.email);
    await page.getByLabel("Lykilorð").fill(user.password);
    await page.getByRole("button", { name: "Stofna aðgang" }).click();
    await expect(
      page.getByRole("main").getByText("Ekki er enn hægt að stofna aðgang fyrir fyrirtæki.", { exact: true }),
    ).toBeVisible();

    await page.goto("/");
    const lookup = page.getByRole("region", { name: "Fletta upp kennitölu" });
    await expect(lookup.getByText("Þú þarft að skrá þig inn til að fletta upp kennitölu.")).toBeVisible();
    await lookup.getByLabel("Kennitala", { exact: true }).fill(DEMO.people.gunnar.kennitala);
    await lookup.getByRole("button", { name: "Fletta upp", exact: true }).click();
    const alert = lookup.getByRole("alert");
    await expect(alert).toContainText("Skráðu þig inn til að fletta upp kennitölu.");
    await expect(alert.getByRole("link", { name: "Skrá inn" })).toHaveAttribute("href", "/login?next=%2F");
  });
});

// ---------------------------------------------------------------------------
// On a phone
// ---------------------------------------------------------------------------

/**
 * Everything that makes a narrow header fail: the page scrolling sideways, a
 * header element showing a scrollbar or sticking out of the screen, or the
 * main nav's links not fitting inside it.
 */
async function headerProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const width = window.innerWidth;
    const pageOverflow = document.scrollingElement!.scrollWidth - width;
    if (pageOverflow > 0) problems.push(`the page scrolls sideways by ${pageOverflow}px`);
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}[${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30)}]`;
    const header = document.querySelector("header")!;
    for (const el of [header, ...header.querySelectorAll<HTMLElement>("*")]) {
      const style = getComputedStyle(el);
      const scrolls = /(auto|scroll)/.test(style.overflowX + style.overflowY);
      if (scrolls && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) {
        problems.push(`scrollbar on ${name(el)}`);
      }
      const box = el.getBoundingClientRect();
      // Skip visually hidden text (1×1 px).
      if (box.width > 1 && (box.left < -0.5 || box.right > width + 0.5)) problems.push(`off screen: ${name(el)}`);
    }
    const nav = header.querySelector("nav")!;
    if (nav.scrollWidth > nav.clientWidth || nav.scrollHeight > nav.clientHeight) {
      problems.push(`nav overflows: ${nav.scrollWidth}x${nav.scrollHeight} in ${nav.clientWidth}x${nav.clientHeight}`);
    }
    return problems;
  });
}

/** The vertical centre of an element. */
async function middle(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  expect(box, String(locator)).not.toBeNull();
  return box!.y + box!.height / 2;
}

/** The logo, the language switch and the account controls share one row. */
async function expectOneTopRow(page: Page, controls: Locator[]): Promise<void> {
  const logo = await middle(page.getByRole("banner").getByRole("link", { name: "GossipRent", exact: true }));
  for (const control of controls) {
    expect(Math.abs((await middle(control)) - logo), String(control)).toBeLessThan(6);
  }
}

/** The tops of the main nav's links: one distinct value means one line. */
async function navLines(page: Page): Promise<number> {
  const tops = await mainNav(page, "is")
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => Math.round(link.getBoundingClientRect().top)));
  return new Set(tops).size;
}

test.describe("on a phone, in Icelandic", () => {
  const SIGNED_OUT = ["/", "/landlords", "/properties", "/privacy", "/search?q=Reykjav%C3%ADk", "/signup"];
  const SIGNED_IN = ["/dashboard", "/reviews/new", "/renters", "/search?q=Akureyri"];

  for (const width of [390, 320]) {
    test(`the header fits at ${width}px, signed out and signed in`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 800 });
      await setLanguage(context, "is");
      const header = page.getByRole("banner");

      for (const path of SIGNED_OUT) {
        await page.goto(path);
        await expect(mainNav(page, "is")).toBeVisible();
        expect(await headerProblems(page), `${path} (signed out)`).toEqual([]);
        await expectOneTopRow(page, [
          languageButton(page, "en"),
          header.getByRole("link", { name: "Skrá inn", exact: true }),
          header.getByRole("link", { name: "Nýskráning", exact: true }),
        ]);
        // At 390px the four links fit on one line; at 320px they may wrap, but never scroll.
        if (width >= 390) expect(await navLines(page), path).toBe(1);
      }

      // Sign up (in English, as the helpers do), then look again in Icelandic.
      await setLanguage(context, "en");
      await signUp(page, makeUser("both"));
      await setLanguage(context, "is");
      for (const path of SIGNED_IN) {
        await page.goto(path);
        await expect(mainNav(page, "is")).toBeVisible();
        expect(await headerProblems(page), `${path} (signed in)`).toEqual([]);
        await expectOneTopRow(page, [
          languageButton(page, "en"),
          header.getByRole("link", { name: "Mínar síður" }),
          header.getByRole("button", { name: "Skrá út", exact: true }),
        ]);
        if (width >= 390) expect(await navLines(page), path).toBe(1);
      }
    });
  }

  test("the English hint fits above the header at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of ["/", "/landlords?q=J%C3%B3n&sort=name", "/properties"]) {
      await page.goto(path);
      await expect(hintButton(page)).toBeVisible();
      expect(await headerProblems(page), path).toEqual([]);
      expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(0);
      for (const button of [hintButton(page), stayButton(page)]) {
        await expect(button, path).toBeInViewport({ ratio: 1 });
        const box = await button.boundingBox();
        expect(box!.x + box!.width, path).toBeLessThanOrEqual(320);
      }
    }
    await hintButton(page).click();
    await expect(htmlLang(page)).toHaveAttribute("lang", "en");
    await expect(page).toHaveURL("/properties");
  });
});
