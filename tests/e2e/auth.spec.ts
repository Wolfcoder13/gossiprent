import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  addProperty,
  cardMeta,
  cardSubtitle,
  createActor,
  DEMO,
  DEMO_PASSWORD,
  demoProfilePath,
  fillLogin,
  fillSignup,
  formAlert,
  formatKennitala,
  formStatus,
  freshKennitala,
  kennitalaVariants,
  logIn,
  logInAs,
  logOut,
  makeProperty,
  makeReview,
  makeUser,
  myProfilePath,
  nameToken,
  NOT_A_KENNITALA,
  roleCheckbox,
  setLanguage,
  signUp,
  signupKennitalaInput,
  uid,
  writeReviewByKennitala,
} from "./helpers";

const SESSION_COOKIE = "gossiprent_session";
const NO_MATCH = "That email and password don't match an account.";
const KENNITALA_TAKEN = "This kennitala already has an account.";
const KEPT_NAME = "People had already reviewed you, so your page keeps the name they used. If it's wrong, report it.";
const NAME_LOCKED = "Your name can't be changed after people have reviewed you. If it's wrong, report it.";

/** The "Kennitala" field's error (its accessible description is the hints, then the error). */
async function expectKennitalaError(page: Page, message: string): Promise<void> {
  const field = signupKennitalaInput(page);
  await expect(formAlert(page)).toHaveText("Please fix the highlighted fields.");
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(new RegExp(`${message.replace(/[.?]/g, "\\$&")}$`));
  await expect(page).toHaveURL(/\/signup$/);
}

/** The "Not you? Report it" link shown under the kennitala field. */
function notYouLink(page: Page): Locator {
  return page.getByRole("main").getByRole("link", { name: "Not you? Report it" });
}

/** The dashboard notice shown after taking over a profile that kept the reviewers' name. */
function keptNameNotice(page: Page): Locator {
  return page.getByRole("main").getByRole("status").filter({ hasText: "People had already reviewed you" });
}

function firstName(name: string): string {
  return name.split(" ")[0];
}

/**
 * The login/sign-up form's hidden return path (the header and footer language
 * switches have a hidden "next" of their own).
 */
function nextField(page: Page): Locator {
  return page.getByRole("main").locator('input[name="next"]');
}

test.describe("sign up", () => {
  test("as a renter", async ({ page }) => {
    const user = makeUser("renter");
    await signUp(page, user);

    await expect(page).toHaveTitle("My account · GossipRent");
    await expect(page.getByText(`Signed in as ${user.email}`)).toBeVisible();
    await expect(page.locator("main").getByText("Renter", { exact: true }).first()).toBeVisible();
    // No kept-name notice: nobody had reviewed this kennitala.
    await expect(keptNameNotice(page)).toHaveCount(0);
    // Renter quick actions.
    const quick = page.getByRole("region", { name: "Quick actions" });
    await expect(quick.getByRole("link", { name: "Review a landlord" })).toHaveAttribute("href", "/landlords");
    await expect(quick.getByRole("link", { name: "Review a property" })).toHaveAttribute("href", "/properties");
    await expect(quick.getByRole("link", { name: "Add the place you rent" })).toHaveAttribute("href", "/properties/new");
    await expect(quick.getByRole("link", { name: "Review a renter" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Reviews about you (0)" })).toBeVisible();
    await expect(page.getByText("No landlords have reviewed you yet")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reviews you've written (0)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Properties you added (0)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Reviews of your properties/ })).toHaveCount(0);

    // Signed-in header.
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "My account" })).toBeVisible();
    await expect(header.getByRole("button", { name: "Log out" })).toBeVisible();
    await expect(header.getByRole("link", { name: "Log in", exact: true })).toHaveCount(0);

    // Public renter profile, which never shows the email address or the kennitala.
    const path = await myProfilePath(page);
    expect(path).toMatch(/^\/renters\//);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: user.name })).toBeVisible();
    await expect(page.getByText(`${user.city} · Member since`)).toBeVisible();
    await expect(page.getByText("Identity not verified", { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText("No account", { exact: true })).toHaveCount(0);
    await expect(page.getByText(user.email)).toHaveCount(0);
    await expect(page.getByText("No reviews for", { exact: false })).toBeVisible();
    const html = await page.content();
    for (const variant of kennitalaVariants(user.kennitala)) expect(html).not.toContain(variant);

    // Listed in the renters directory.
    await page.goto(`/renters?q=${encodeURIComponent(user.name)}`);
    const card = page.getByRole("main").getByRole("link", { name: new RegExp(user.name) });
    await expect(card).toHaveAttribute("href", path);
    expect(await cardMeta(card)).toEqual(["Renter"]);
    expect(await cardSubtitle(card)).toBe(user.city);
  });

  test("as a landlord", async ({ page }) => {
    const user = makeUser("landlord", { city: undefined });
    await signUp(page, user);

    await expect(page.getByText(`Signed in as ${user.email}`)).toBeVisible();
    await expect(page.locator("main").getByText("Landlord", { exact: true }).first()).toBeVisible();
    const quick = page.getByRole("region", { name: "Quick actions" });
    await expect(quick.getByRole("link", { name: "Review a renter" })).toHaveAttribute("href", "/renters");
    await expect(quick.getByRole("link", { name: "Add a property" })).toHaveAttribute(
      "href",
      "/properties/new?as=landlord",
    );
    await expect(quick.getByRole("link", { name: "Review a landlord" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Reviews about you (0)" })).toBeVisible();
    await expect(page.getByText("No renters have reviewed you yet")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reviews of your properties (0)", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your properties (0)", exact: true })).toBeVisible();
    await expect(page.getByText("You haven't listed any properties")).toBeVisible();

    const path = await myProfilePath(page);
    expect(path).toMatch(/^\/landlords\//);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: user.name })).toBeVisible();
    // No city given.
    await expect(page.getByText(/^Member since [A-Z][a-z]+ \d{4}$/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Properties (0)" })).toBeVisible();

    await page.goto(`/landlords?q=${encodeURIComponent(user.name)}`);
    const card = page.getByRole("main").getByRole("link", { name: new RegExp(user.name) });
    await expect(card).toHaveAttribute("href", path);
    expect(await cardSubtitle(card)).toBe("No properties yet");
    expect(await cardMeta(card)).toEqual(["Landlord"]);
  });

  test("?role= preselects one role; the other can still be ticked too", async ({ page }) => {
    await page.goto("/signup?role=landlord");
    await expect(page).toHaveTitle("Sign up · GossipRent");
    await expect(roleCheckbox(page, "landlord")).toBeChecked();
    await expect(roleCheckbox(page, "renter")).not.toBeChecked();
    // Ticking one keeps the other.
    await roleCheckbox(page, "renter").check();
    await expect(roleCheckbox(page, "landlord")).toBeChecked();
    await expect(roleCheckbox(page, "renter")).toBeChecked();

    await page.goto("/signup?role=renter");
    await expect(roleCheckbox(page, "renter")).toBeChecked();
    await expect(roleCheckbox(page, "landlord")).not.toBeChecked();

    for (const role of ["admin", "both", ""]) {
      await page.goto(`/signup?role=${role}`);
      await expect(roleCheckbox(page, "renter"), role).not.toBeChecked();
      await expect(roleCheckbox(page, "landlord"), role).not.toBeChecked();
    }
  });

  test("the kennitala field explains what it's for and suits a numeric keyboard", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();
    await expect(
      page.getByText("Free, and it only takes a minute. Your email and kennitala are never shown publicly."),
    ).toBeVisible();
    const field = signupKennitalaInput(page);
    await expect(field).toHaveAccessibleDescription(
      "10 digits, e.g. 123456-7890 Your kennitala (Icelandic ID number) links reviews to the right person, even when people share a name. It's never shown publicly. You can't remove reviews other people write about you.",
    );
    await expect(field).toHaveAttribute("type", "text");
    await expect(field).toHaveAttribute("inputmode", "numeric");
    await expect(field).toHaveAttribute("autocomplete", "off");
    await expect(field).toHaveAttribute("required", "");
    // The name hint says a reviewed person's page keeps its name.
    await expect(page.getByLabel("Name", { exact: true })).toHaveAccessibleDescription(
      "Shown on your profile and reviews. If someone has already reviewed you, your page keeps the name they used.",
    );
    // The fields come in this order.
    const labels = await page.locator("main form label").allInnerTexts();
    expect(labels.map((label) => label.split("\n")[0].trim()).slice(2)).toEqual([
      "Kennitala",
      "Name",
      "Email",
      "Password",
      "City (optional)",
    ]);
  });

  test("a kennitala typed with a space or a hyphen works, and only the dashboard shows it", async ({
    page,
    browser,
  }) => {
    const kennitala = freshKennitala();
    const spaced = `${kennitala.slice(0, 6)} ${kennitala.slice(6)}`;
    const user = makeUser("renter", { kennitala: spaced });
    await signUp(page, user);
    await expect(page.getByText(`Your kennitala: ${formatKennitala(kennitala)}`, { exact: true })).toBeVisible();
    await expect(page.getByText("Only you can see it here. It's never shown publicly.")).toBeVisible();
    // Signing up didn't put it in the URL.
    for (const variant of kennitalaVariants(kennitala)) expect(page.url()).not.toContain(variant);

    // The same number with a hyphen is the same person: it already has an account now.
    const copy = makeUser("renter", { kennitala: ` ${formatKennitala(kennitala)} ` });
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto("/signup");
    await fillSignup(otherPage, copy);
    await expectKennitalaError(otherPage, KENNITALA_TAKEN);
    await other.close();
  });

  test("shows every validation error and keeps what was typed (except the password)", async ({ page }) => {
    await page.goto("/signup");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(formAlert(page)).toHaveText("Please fix the highlighted fields.");
    await expect(page.getByText("Choose at least one: renter, landlord, or both.")).toBeVisible();
    // Each checkbox is marked invalid and described by the error (aria-invalid
    // isn't allowed on a fieldset/group).
    const roles = page.getByRole("group", { name: "I'm joining as a…" });
    await expect(roles).not.toHaveAttribute("aria-invalid");
    for (const role of ["renter", "landlord"] as const) {
      await expect(roleCheckbox(page, role), role).toHaveAttribute("aria-invalid", "true");
      await expect(roleCheckbox(page, role), role).toHaveAccessibleDescription(
        "Choose at least one: renter, landlord, or both.",
      );
    }
    // ...and the cards get the error colour.
    const renterCard = page.locator("label").filter({ has: roleCheckbox(page, "renter") });
    const errorBorder = await renterCard.evaluate((el) => getComputedStyle(el).borderTopColor);
    await expect(page.getByText("Enter a kennitala.")).toBeVisible();
    await expect(signupKennitalaInput(page)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Name must be at least 2 characters.")).toBeVisible();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByText("Password must be at least 8 characters.")).toBeVisible();
    await expect(page).toHaveURL(/\/signup$/);

    // Fix some fields but not others.
    const name = `Jóna ${nameToken()}`;
    await roleCheckbox(page, "landlord").check();
    await signupKennitalaInput(page).fill(NOT_A_KENNITALA);
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password").fill("short");
    await page.getByLabel("City").fill("Akureyri");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("That isn't a valid kennitala. Enter 10 digits, e.g. 123456-7890.")).toBeVisible();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByText("Password must be at least 8 characters.")).toBeVisible();
    await expect(page.getByText("Enter a kennitala.")).toHaveCount(0);
    await expect(page.getByText("Name must be at least 2 characters.")).toHaveCount(0);
    await expect(page.getByText("Choose at least one: renter, landlord, or both.")).toHaveCount(0);
    for (const role of ["renter", "landlord"] as const) {
      await expect(roleCheckbox(page, role), role).not.toHaveAttribute("aria-invalid");
      await expect(roleCheckbox(page, role), role).not.toHaveAttribute("aria-describedby");
    }
    // The (still unticked) renter card is back to its normal border.
    expect(await renterCard.evaluate((el) => getComputedStyle(el).borderTopColor)).not.toBe(errorBorder);
    await expect(signupKennitalaInput(page)).toHaveValue(NOT_A_KENNITALA);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(name);
    await expect(page.getByLabel("Email")).toHaveValue("not-an-email");
    await expect(page.getByLabel("City")).toHaveValue("Akureyri");
    await expect(page.getByLabel("Password")).toHaveValue("");
    await expect(roleCheckbox(page, "landlord")).toBeChecked();
    await expect(roleCheckbox(page, "renter")).not.toBeChecked();
    // Errors are wired up for screen readers.
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Email")).toHaveAccessibleDescription("Enter a valid email address.");

    // A name with digits isn't a person's name.
    const user = makeUser("landlord", { name });
    await signupKennitalaInput(page).fill(user.kennitala);
    await page.getByLabel("Name", { exact: true }).fill("Agent 007");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(
      page.getByText("Use only letters, spaces, hyphens, apostrophes and periods in a name."),
    ).toBeVisible();
    await expect(page.getByText("That isn't a valid kennitala.", { exact: false })).toHaveCount(0);
    await expect(signupKennitalaInput(page)).toHaveValue(user.kennitala);

    // Everything fixed: the account is created.
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { level: 1, name: "Hi, Jóna" })).toBeVisible();
    await expect(page.getByText(`Your kennitala: ${formatKennitala(user.kennitala)}`)).toBeVisible();
  });

  test("rejects an email that's already registered, ignoring case and spaces", async ({ page }) => {
    await page.goto("/signup");
    const user = makeUser("renter", {
      name: "Copycat Sigrún",
      email: `  ${DEMO.people.sigrun.email.toUpperCase()}  `,
      password: "another-password",
    });
    await fillSignup(page, user);
    await expect(page.getByText("An account with this email already exists. Try logging in instead.")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await expect(signupKennitalaInput(page)).not.toHaveAttribute("aria-invalid");
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Copycat Sigrún");
    await expect(signupKennitalaInput(page)).toHaveValue(user.kennitala);
    await expect(roleCheckbox(page, "renter")).toBeChecked();
    await expect(roleCheckbox(page, "landlord")).not.toBeChecked();

    // Nothing was saved for that kennitala: it can still sign up, with its own email.
    await page.getByLabel("Email").fill(`e2e-own-${uid()}@example.com`);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { level: 1, name: "Hi, Copycat" })).toBeVisible();
  });

  test("stores the email in lower case so you can log in with any casing", async ({ page }) => {
    const id = uid();
    const user = makeUser("renter", { email: `E2E-Mixed-${id}@Example.COM` });
    await signUp(page, user);
    await expect(page.getByText(`Signed in as e2e-mixed-${id.toLowerCase()}@example.com`)).toBeVisible();
    await logOut(page);
    await logIn(page, `e2e-mixed-${id}@example.com`, user.password);
    await expect(page.getByRole("heading", { level: 1, name: `Hi, ${firstName(user.name)}` })).toBeVisible();
  });
});

test.describe("sign up: kennitalas that can't have an account", () => {
  test("a company's kennitala is refused", async ({ page }) => {
    await page.goto("/signup");
    const user = makeUser("landlord", { kennitala: freshKennitala("company") });
    await fillSignup(page, user);
    await expectKennitalaError(page, "Company accounts aren't available yet.");
    await expect(notYouLink(page)).toHaveCount(0);
    // What was typed is kept.
    await expect(signupKennitalaInput(page)).toHaveValue(user.kennitala);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(user.name);
    await expect(page.getByLabel("Email")).toHaveValue(user.email);
    await expect(roleCheckbox(page, "landlord")).toBeChecked();

    // No account was made.
    await page.goto("/login");
    await fillLogin(page, user.email, user.password);
    await expect(formAlert(page)).toHaveText(NO_MATCH);
  });

  test("a company's profile without an account can't be taken over", async ({ page }) => {
    const company = DEMO.people.leigufelag;
    await page.goto("/signup");
    await fillSignup(page, makeUser("landlord", { kennitala: company.kennitala }));
    await expectKennitalaError(page, "Company accounts aren't available yet.");

    // Its page is unchanged.
    const path = await demoProfilePath(page, "leigufelag");
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: company.name })).toBeVisible();
    await expect(page.getByRole("main").getByText("No account", { exact: true })).toBeVisible();
  });

  test("someone under 18 can't sign up", async ({ page }) => {
    await page.goto("/signup");
    const user = makeUser("renter", { kennitala: freshKennitala("minor") });
    await fillSignup(page, user);
    await expectKennitalaError(page, "You must be 18 or older to sign up.");
    await expect(notYouLink(page)).toHaveCount(0);
    await expect(signupKennitalaInput(page)).toHaveValue(user.kennitala);

    await page.goto("/login");
    await fillLogin(page, user.email, user.password);
    await expect(formAlert(page)).toHaveText(NO_MATCH);
  });

  test("a kennitala that already has an account is refused, with a way to report it", async ({ page, browser }) => {
    const sigrun = DEMO.people.sigrun;
    await page.goto("/signup");
    const user = makeUser("renter", { kennitala: formatKennitala(sigrun.kennitala) });
    await fillSignup(page, user);
    await expectKennitalaError(page, KENNITALA_TAKEN);
    // The report link sits under the field, not in the banner.
    await expect(notYouLink(page)).toHaveAttribute("href", "/report?target=account");
    await expect(formAlert(page).getByRole("link")).toHaveCount(0);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(user.name);
    await expect(page.getByLabel("Email")).toHaveValue(user.email);
    await expect(page.getByLabel("Password")).toHaveValue("");

    // Sigrún's account is untouched.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await logInAs(otherPage, "sigrun");
    await expect(otherPage.getByRole("heading", { level: 1, name: "Hi, Sigrún" })).toBeVisible();
    await expect(otherPage.getByText(`Signed in as ${sigrun.email}`)).toBeVisible();
    await other.close();

    // "Not you? Report it" opens the account report form, with the reason picked.
    await notYouLink(page).click();
    await expect(page).toHaveURL(/\/report\?target=account$/);
    await expect(page.getByRole("heading", { level: 1, name: "Report a problem" })).toBeVisible();
    await expect(page.getByText("For example, someone else has signed up with your kennitala.")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Reason" })).toHaveValue("identity_claimed");

    // The email typed with the refused kennitala is still free.
    await page.goto("/signup");
    await fillSignup(page, { ...user, kennitala: freshKennitala() });
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("without JavaScript, a refused kennitala shows the error and the report link", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/signup");
    const user = makeUser("landlord", { kennitala: DEMO.people.jon.kennitala });
    await fillSignup(page, user);
    await expect(page.getByText(KENNITALA_TAKEN, { exact: true })).toBeVisible();
    await expect(notYouLink(page)).toHaveAttribute("href", "/report?target=account");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(user.name);

    // ...and an under-18 kennitala.
    await signupKennitalaInput(page).fill(freshKennitala("minor"));
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("You must be 18 or older to sign up.", { exact: true })).toBeVisible();
    await expect(notYouLink(page)).toHaveCount(0);
    await context.close();
  });

  test("in Icelandic", async ({ page, context }) => {
    await setLanguage(context, "is");
    await page.goto("/signup");
    await expect(page.getByRole("heading", { level: 1, name: "Stofnaðu aðgang" })).toBeVisible();
    await page.getByRole("checkbox", { name: "Ég er leigjandi" }).check();
    await page.getByLabel("Kennitala", { exact: true }).fill(DEMO.people.kari.kennitala);
    await page.getByLabel("Nafn", { exact: true }).fill(`Jón ${nameToken()}`);
    await page.getByLabel("Netfang").fill(`e2e-is-${uid()}@example.com`);
    await page.getByLabel("Lykilorð").fill("password-123");
    await page.getByRole("button", { name: "Stofna aðgang" }).click();
    await expect(formAlert(page)).toHaveText("Lagaðu merktu reitina.");
    await expect(page.getByText("Aðgangur er þegar til fyrir þessa kennitölu.")).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Ekki þú? Tilkynna það" })).toHaveAttribute(
      "href",
      "/report?target=account",
    );

    await page.getByLabel("Kennitala", { exact: true }).fill(freshKennitala("company"));
    await page.getByLabel("Lykilorð").fill("password-123");
    await page.getByRole("button", { name: "Stofna aðgang" }).click();
    await expect(page.getByText("Ekki er enn hægt að stofna aðgang fyrir fyrirtæki.")).toBeVisible();

    await page.getByLabel("Kennitala", { exact: true }).fill(freshKennitala("minor"));
    await page.getByLabel("Lykilorð").fill("password-123");
    await page.getByRole("button", { name: "Stofna aðgang" }).click();
    await expect(page.getByText("Þú þarft að hafa náð 18 ára aldri til að stofna aðgang.")).toBeVisible();

    await page.getByLabel("Kennitala", { exact: true }).fill(NOT_A_KENNITALA);
    await page.getByLabel("Lykilorð").fill("password-123");
    await page.getByRole("button", { name: "Stofna aðgang" }).click();
    await expect(
      page.getByText("Þetta er ekki gild kennitala. Sláðu inn 10 tölustafi, t.d. 123456-7890."),
    ).toBeVisible();
  });
});

test.describe("sign up: taking over a profile without an account", () => {
  test("a reviewed profile keeps its name and reviews, and the dashboard says why", async ({ page, browser }) => {
    // A renter reviews someone who isn't on GossipRent yet, creating their page.
    const reviewer = await createActor(browser, "renter");
    const kennitala = freshKennitala();
    const reviewedName = `Gudrun ${nameToken()}`;
    const review = makeReview(4);
    const path = await writeReviewByKennitala(reviewer.page, "landlord", { kennitala, name: reviewedName }, review);
    const id = path.split("/").pop();

    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: reviewedName })).toBeVisible();
    await expect(page.getByRole("main").getByText("No account", { exact: true })).toBeVisible();
    await expect(page.getByText(/^First reviewed [A-Z][a-z]+ \d{4}$/)).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Sign up with your kennitala" })).toHaveAttribute(
      "href",
      "/signup",
    );

    // That person signs up with their kennitala, under the name they use themselves.
    const user = makeUser("landlord", { kennitala, name: `Runa ${nameToken()}` });
    await page.getByRole("main").getByRole("link", { name: "Sign up with your kennitala" }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await fillSignup(page, user);
    await expect(page).toHaveURL(/\/dashboard\?name=kept$/);
    // The page kept the name the reviewer used.
    await expect(page.getByRole("heading", { level: 1, name: `Hi, ${firstName(reviewedName)}` })).toBeVisible();
    await expect(page.getByText(`Signed in as ${user.email}`)).toBeVisible();
    await expect(keptNameNotice(page)).toHaveText(KEPT_NAME);
    await expect(keptNameNotice(page).getByRole("link", { name: "report it" })).toHaveAttribute(
      "href",
      `/report?target=profile&id=${id}`,
    );
    // The review about them is on the dashboard.
    await expect(page.getByRole("heading", { name: "Reviews about you (1)" })).toBeVisible();
    await expect(page.locator("article").filter({ hasText: review.title })).toBeVisible();
    // The profile form explains why the name can't change.
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(reviewedName);
    await expect(page.getByLabel("Name", { exact: true })).toHaveAccessibleDescription(NAME_LOCKED);
    // It's the same page as before.
    expect(await myProfilePath(page)).toBe(path);
    // The notice is only shown right after signing up.
    await expect(keptNameNotice(page)).toHaveCount(0);

    // The public page now belongs to an account.
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: reviewedName })).toBeVisible();
    await expect(page.getByRole("main").getByText("No account", { exact: true })).toHaveCount(0);
    await expect(page.getByText(`${user.city} · Member since`)).toBeVisible();
    await expect(page.getByText("Identity not verified", { exact: true })).toBeVisible();
    await expect(page.getByText(/^First reviewed/)).toHaveCount(0);
    await expect(page.locator("article").filter({ hasText: review.title })).toBeVisible();
    await expect(page.getByText(user.name)).toHaveCount(0);

    // The account logs in with the email and password chosen at sign-up.
    await logOut(page);
    await logIn(page, user.email, user.password);
    await expect(page.getByRole("heading", { level: 1, name: `Hi, ${firstName(reviewedName)}` })).toBeVisible();
    await reviewer.context.close();
  });

  test("the roles it was reviewed in stay, and the ticked ones are added", async ({ page, browser }) => {
    // A landlord reviews a renter who isn't on GossipRent yet.
    const reviewer = await createActor(browser, "landlord");
    const kennitala = freshKennitala();
    const reviewedName = `Rosa ${nameToken()}`;
    const review = makeReview(5);
    const renterPath = await writeReviewByKennitala(
      reviewer.page,
      "renter",
      { kennitala, name: reviewedName },
      review,
    );

    // They sign up ticking only "I'm a landlord".
    const user = makeUser("landlord", { kennitala });
    await signUp(page, user);
    await expect(page).toHaveURL(/\/dashboard\?name=kept$/);
    await expect(page.getByRole("main").getByText("Landlord", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("main").getByText("Renter", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reviews about you as a landlord (0)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reviews about you as a renter (1)" })).toBeVisible();
    // Both roles get the quick actions.
    const quick = page.getByRole("region", { name: "Quick actions" });
    await expect(quick.getByRole("link", { name: "Review a landlord" })).toBeVisible();
    await expect(quick.getByRole("link", { name: "Review a renter" })).toBeVisible();
    // The renter role can't be removed (a landlord reviewed them); the new one can.
    const roles = page.locator("#roles");
    await expect(roles.getByText("Landlords have reviewed you, so this role stays.")).toBeVisible();
    await expect(roles.getByRole("button", { name: "Remove renter role" })).toHaveCount(0);
    await expect(roles.getByRole("button", { name: "Remove landlord role" })).toBeVisible();

    // The public profile has both roles: the renter page with the review, and a landlord page.
    const landlordPath = await myProfilePath(page);
    expect(landlordPath).toBe(renterPath.replace("/renters/", "/landlords/"));
    await page.goto(renterPath);
    await expect(page.getByRole("heading", { level: 1, name: reviewedName })).toBeVisible();
    await expect(page.locator("article").filter({ hasText: review.title })).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Ratings by role" });
    await expect(tabs.getByRole("link", { name: /^As a landlord/ })).toHaveAttribute("href", landlordPath);
    await reviewer.context.close();
  });

  test("a landlord a renter linked to a property takes the profile over with the property", async ({
    page,
    browser,
  }) => {
    const renter = await createActor(browser, "renter");
    const kennitala = freshKennitala();
    const linkedName = `Larus ${nameToken()}`;
    const propertyPath = await addProperty(renter.page, makeProperty(), { kennitala, name: linkedName });
    await expect(renter.page.getByText(`Landlord: ${linkedName}`)).toBeVisible();
    await expect(renter.page.getByText("Added by a renter, not confirmed")).toBeVisible();

    // The landlord signs up with that kennitala: the page keeps the name the renter typed.
    const user = makeUser("landlord", { kennitala });
    await signUp(page, user);
    await expect(page).toHaveURL(/\/dashboard\?name=kept$/);
    await expect(page.getByRole("heading", { level: 1, name: `Hi, ${firstName(linkedName)}` })).toBeVisible();
    await expect(keptNameNotice(page)).toHaveText(KEPT_NAME);
    await expect(page.getByRole("heading", { name: "Your properties (1)", exact: true })).toBeVisible();

    // The property now has a confirmed landlord, who can unlink it.
    await page.goto(propertyPath);
    await expect(page.getByText(`Landlord: ${linkedName}`)).toBeVisible();
    await expect(page.getByText("Added by a renter, not confirmed")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Not my property" })).toBeVisible();
    await renter.context.close();
  });

  test("a fresh account without the kept name doesn't show the notice", async ({ page }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    await page.goto("/dashboard?name=kept");
    await expect(page.getByRole("heading", { level: 1, name: `Hi, ${firstName(user.name)}` })).toBeVisible();
    await expect(keptNameNotice(page)).toHaveCount(0);
    await expect(page.getByLabel("Name", { exact: true })).not.toHaveAccessibleDescription(NAME_LOCKED);
  });
});

test.describe("log in and out", () => {
  test("a demo user can log in and out", async ({ page }) => {
    const kari = DEMO.people.kari;
    await page.goto("/login");
    await expect(page).toHaveTitle("Log in · GossipRent");
    await fillLogin(page, kari.email, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { level: 1, name: "Hi, Kári" })).toBeVisible();
    await expect(page.getByText(`Signed in as ${kari.email}`)).toBeVisible();
    await expect(page.getByText(`Your kennitala: ${formatKennitala(kari.kennitala)}`)).toBeVisible();
    // Kári's demo reviews show up on the dashboard.
    await expect(page.getByRole("heading", { name: /^Reviews you've written \(\d+\)$/ })).toBeVisible();
    await expect(page.locator("article").filter({ hasText: "Rakinn var lengi óviðgerður" })).toBeVisible();

    // The session survives a reload and new tabs.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Hi, Kári" })).toBeVisible();
    const tab = await page.context().newPage();
    await tab.goto("/dashboard");
    await expect(tab.getByRole("heading", { level: 1, name: "Hi, Kári" })).toBeVisible();
    await tab.close();

    await logOut(page);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("banner").getByRole("link", { name: "Sign up" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  });

  test("the session cookie is httpOnly and stops working after logout", async ({ page, browser }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    const cookie = (await page.context().cookies()).find((c) => c.name === SESSION_COOKIE);
    expect(cookie, "session cookie").toBeDefined();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.sameSite).toBe("Lax");
    expect(cookie!.value.length).toBeGreaterThanOrEqual(40);

    await logOut(page);
    expect((await page.context().cookies()).find((c) => c.name === SESSION_COOKIE)).toBeUndefined();

    // Replaying the old cookie must not log anyone in: the session was deleted server-side.
    const replay = await browser.newContext();
    await replay.addCookies([cookie!]);
    const replayPage = await replay.newPage();
    await replayPage.goto("/dashboard");
    await expect(replayPage).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await replay.close();
  });

  test("a wrong password or unknown email shows a generic error and keeps the email", async ({ page }) => {
    const kari = DEMO.people.kari;
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
    await fillLogin(page, kari.email, "wrong-password");
    await expect(formAlert(page)).toHaveText(NO_MATCH);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel("Email")).toHaveValue(kari.email);
    await expect(page.getByLabel("Password")).toHaveValue("");

    await fillLogin(page, `nobody-${uid()}@example.com`, DEMO_PASSWORD);
    await expect(formAlert(page)).toHaveText(NO_MATCH);
    await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);
  });

  test("validates the login form", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByText("Enter your password.")).toBeVisible();
  });

  test("email is case-insensitive and trimmed at login", async ({ page }) => {
    await page.goto("/login");
    await fillLogin(page, "  KARI@Example.com ", DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { level: 1, name: "Hi, Kári" })).toBeVisible();
  });

  test("signed-in users visiting /login or /signup go to their dashboard", async ({ page }) => {
    await signUp(page, makeUser("landlord"));
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/signup");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/login?next=%2Frenters");
    await expect(page).toHaveURL(/\/renters$/);
  });

  test("rate limiting is off on the test server: many wrong passwords don't lock the account", async ({ page }) => {
    // With limits on, the 11th try within 15 minutes would get "Too many attempts".
    const user = makeUser("renter");
    await signUp(page, user);
    await logOut(page);
    await page.goto("/login");
    for (let i = 1; i <= 12; i++) {
      await fillLogin(page, user.email, `wrong-password-${i}`);
      await expect(formAlert(page), `attempt ${i}`).toHaveText(NO_MATCH);
      // The form is reset once the answer is in (the email is put back).
      await expect(page.getByLabel("Password"), `attempt ${i}`).toHaveValue("");
      await expect(page.getByLabel("Email"), `attempt ${i}`).toHaveValue(user.email);
    }
    await fillLogin(page, user.email, user.password);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("Too many attempts", { exact: false })).toHaveCount(0);
  });
});

test.describe("redirects through login", () => {
  test("/dashboard sends you to log in and then back", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await fillLogin(page, DEMO.people.sigrun.email, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { level: 1, name: "Hi, Sigrún" })).toBeVisible();
  });

  test("/properties/new sends you to log in and then back", async ({ page }) => {
    await page.goto("/properties/new");
    await expect(page).toHaveURL(/\/login\?next=%2Fproperties%2Fnew$/);
    await fillLogin(page, DEMO.people.asdis.email, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/properties\/new$/);
    await expect(page.getByRole("heading", { level: 1, name: "Add a property" })).toBeVisible();
  });

  test("/reviews/new?kind=landlord sends you to log in and then back", async ({ page }) => {
    await page.goto("/reviews/new?kind=landlord");
    await expect(page).toHaveURL(/\/login\?next=%2Freviews%2Fnew%3Fkind%3Dlandlord$/);
    // The sign-up link keeps the way back too.
    await expect(page.getByRole("main").getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      `/signup?next=${encodeURIComponent("/reviews/new?kind=landlord")}`,
    );
    await fillLogin(page, DEMO.people.birta.email, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/reviews\/new\?kind=landlord$/);
    await expect(page.getByRole("heading", { level: 2, name: "Review a landlord" })).toBeVisible();
  });

  test("logging in from a profile page returns to it", async ({ page }) => {
    const path = await demoProfilePath(page, "sigrun");
    await page.goto(path);
    await page.locator("main").getByRole("link", { name: "Log in" }).click();
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent(path)}`);
    await fillLogin(page, DEMO.people.eva.email, DEMO_PASSWORD);
    await expect(page).toHaveURL(path);
    // Eva already reviewed Sigrún, so she sees her own review in the form.
    await expect(page.getByRole("heading", { name: "Your review" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Update review" })).toBeVisible();
  });

  test("signing up from a profile page returns to it, ready to review", async ({ page }) => {
    const jon = DEMO.people.jon;
    const path = await demoProfilePath(page, "jon");
    await page.goto(path);
    await page.getByRole("link", { name: "Sign up as a renter" }).click();
    await expect(page).toHaveURL(`/signup?role=renter&next=${encodeURIComponent(path)}`);
    await expect(roleCheckbox(page, "renter")).toBeChecked();
    await expect(roleCheckbox(page, "landlord")).not.toBeChecked();

    // The "Log in" link on the sign-up page keeps the return path too.
    await expect(page.locator("main").getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      `/login?next=${encodeURIComponent(path)}`,
    );

    const user = makeUser("renter");
    await signupKennitalaInput(page).fill(user.kennitala);
    await page.getByLabel("Name", { exact: true }).fill(user.name);
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(path);
    await expect(page.getByRole("heading", { name: `Review ${jon.name}` })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Landlord's kennitala" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Post review" })).toBeVisible();
  });

  test("taking over a reviewed profile from a sign-up link with ?next= goes there", async ({ page, browser }) => {
    const reviewer = await createActor(browser, "renter");
    const kennitala = freshKennitala();
    const path = await writeReviewByKennitala(
      reviewer.page,
      "landlord",
      { kennitala, name: `Hekla ${nameToken()}` },
      makeReview(3),
    );
    await page.goto(`/signup?next=${encodeURIComponent("/renters")}`);
    await fillSignup(page, makeUser("landlord", { kennitala }));
    // Not the dashboard, so no kept-name notice: just the page asked for.
    await expect(page).toHaveURL(/\/renters$/);
    expect(await myProfilePath(page)).toBe(path);
    await reviewer.context.close();
  });

  for (const evil of [
    "//evil.example",
    "https://evil.example/",
    "/\\evil.example",
    "javascript:alert(1)",
    // Dot-segments that a browser resolves to "//evil.example".
    "/.//evil.example",
    "/a/..//evil.example",
    "/%2e//evil.example",
  ]) {
    test(`ignores an off-site ?next=${evil}`, async ({ page, baseURL }) => {
      await page.goto(`/login?next=${encodeURIComponent(evil)}`);
      await expect(nextField(page)).toHaveValue("/dashboard");
      await fillLogin(page, DEMO.people.thordis.email, DEMO_PASSWORD);
      await expect(page).toHaveURL(`${baseURL}/dashboard`);
    });
  }
});

test.describe("open redirect regressions", () => {
  test("a signed-in visitor sent to /login?next=/.//evil.example stays on this site", async ({
    page,
    baseURL,
    request,
  }) => {
    await logInAs(page, "thordis");
    await page.goto("/login?next=/.//evil.example");
    await expect(page).toHaveURL(`${baseURL}/dashboard`);

    // The raw redirect never points off-site, whatever the encoding.
    const cookies = await page.context().cookies();
    const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    for (const next of ["/.//evil.example", "/a/..//evil.example", "/%2e//evil.example", "/.%2F/evil.example"]) {
      const response = await request.get(`/login?next=${encodeURIComponent(next)}`, {
        headers: { cookie },
        maxRedirects: 0,
      });
      expect(response.status(), next).toBe(307);
      const location = response.headers()["location"];
      expect(new URL(location, baseURL).origin, `${next} -> ${location}`).toBe(new URL(baseURL!).origin);
      expect(location, next).not.toMatch(/^\/\//);
    }
  });

  test("a tampered hidden next field is also checked by the server", async ({ page, baseURL }) => {
    await page.goto("/login");
    await nextField(page).evaluate((input) => {
      (input as HTMLInputElement).value = "/.//evil.example";
    });
    await fillLogin(page, DEMO.people.thordis.email, DEMO_PASSWORD);
    await expect(page).toHaveURL(`${baseURL}/dashboard`);
  });

  test("signing up with ?next=/.//evil.example ends on this site", async ({ page, baseURL }) => {
    await page.goto("/signup?next=/.//evil.example");
    await expect(nextField(page)).toHaveValue("/dashboard");
    await expect(page.locator("main").getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    // Tamper with the hidden field as well, to reach the server-side check.
    await nextField(page).evaluate((input) => {
      (input as HTMLInputElement).value = "/a/..//evil.example";
    });
    await fillSignup(page, makeUser("renter"));
    await expect(page).toHaveURL(`${baseURL}/dashboard`);
  });

  test("a non-ASCII return path works instead of crashing", async ({ page, baseURL }) => {
    const next = "/search?q=Kópavogur";
    const response = await page.goto(`/login?next=${encodeURIComponent(next)}`);
    expect(response?.status()).toBe(200);
    await fillLogin(page, DEMO.people.thordis.email, DEMO_PASSWORD);
    await expect(page).toHaveURL(`${baseURL}/search?q=K%C3%B3pavogur`);
    await expect(page.getByRole("heading", { level: 1, name: "Results for “Kópavogur”" })).toBeVisible();

    // Signed in already: the server-side redirect is a valid, encoded Location.
    const again = await page.goto(`/login?next=${encodeURIComponent("/search?q=東京")}`);
    expect(again?.status()).toBe(200);
    await expect(page).toHaveURL(`${baseURL}/search?q=%E6%9D%B1%E4%BA%AC`);
  });

  test("dot segments inside this site still work as a return path", async ({ page, baseURL }) => {
    await page.goto(`/login?next=${encodeURIComponent("/landlords/../renters")}`);
    await expect(nextField(page)).toHaveValue("/renters");
    await fillLogin(page, DEMO.people.thordis.email, DEMO_PASSWORD);
    await expect(page).toHaveURL(`${baseURL}/renters`);
  });
});

test.describe("changing your password", () => {
  function passwordSection(page: Page): Locator {
    return page.locator("section").filter({ has: page.getByRole("heading", { name: "Password & sessions" }) });
  }

  /** The three password fields ("New password" alone would also match "Confirm new password"). */
  function passwordFields(section: Locator) {
    return {
      current: section.getByLabel("Current password", { exact: true }),
      next: section.getByLabel("New password", { exact: true }),
      confirm: section.getByLabel("Confirm new password", { exact: true }),
    };
  }

  test("a wrong current password is rejected and the old password keeps working", async ({ page }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    const section = passwordSection(page);
    const fields = passwordFields(section);
    await expect(section).toContainText("Changing your password signs you out everywhere else.");
    await fields.current.fill("not-my-password");
    await fields.next.fill("brand-new-password");
    await fields.confirm.fill("brand-new-password");
    await section.getByRole("button", { name: "Change password" }).click();
    await expect(section.getByRole("alert")).toHaveText("Please fix the highlighted fields.");
    await expect(section.getByText("That isn't your current password.")).toBeVisible();
    await expect(fields.current).toHaveAttribute("aria-invalid", "true");
    await expect(fields.current).toHaveAccessibleDescription("That isn't your current password.");
    await expect(fields.current).toBeFocused();

    await logOut(page);
    await logIn(page, user.email, user.password);
    await logOut(page);
    await page.goto("/login");
    await fillLogin(page, user.email, "brand-new-password");
    await expect(formAlert(page)).toHaveText(NO_MATCH);
  });

  test("validates the new password", async ({ page }) => {
    const user = makeUser("landlord");
    await signUp(page, user);
    const section = passwordSection(page);
    const fields = passwordFields(section);
    await expect(fields.confirm).toHaveAttribute("type", "password");
    await expect(fields.confirm).toHaveAttribute("autocomplete", "new-password");
    await section.getByRole("button", { name: "Change password" }).click();
    await expect(section.getByText("Enter your current password.")).toBeVisible();
    await expect(section.getByText("Password must be at least 8 characters.")).toBeVisible();
    await fields.current.fill(user.password);
    await fields.next.fill("short");
    await fields.confirm.fill("short");
    await section.getByRole("button", { name: "Change password" }).click();
    await expect(section.getByText("Password must be at least 8 characters.")).toBeVisible();
    await expect(section.getByText("Enter your current password.")).toHaveCount(0);
    await expect(section.getByText("The new passwords don't match.")).toHaveCount(0);
    await expect(fields.next).toBeFocused();
    // Passwords are never put back into the form.
    await expect(fields.current).toHaveValue("");
    await expect(fields.next).toHaveValue("");
    await expect(fields.confirm).toHaveValue("");
  });

  test("a confirmation that doesn't match is rejected and the old password keeps working", async ({ page }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    const section = passwordSection(page);
    const fields = passwordFields(section);
    await fields.current.fill(user.password);
    await fields.next.fill("brand-new-password");
    await fields.confirm.fill("brand-new-passwrod");
    await section.getByRole("button", { name: "Change password" }).click();
    await expect(section.getByRole("alert")).toHaveText("Please fix the highlighted fields.");
    await expect(fields.confirm).toHaveAttribute("aria-invalid", "true");
    await expect(fields.confirm).toHaveAccessibleDescription("The new passwords don't match.");
    await expect(fields.confirm).toBeFocused();
    // Only the confirmation is flagged.
    await expect(fields.current).not.toHaveAttribute("aria-invalid", "true");
    await expect(fields.next).not.toHaveAttribute("aria-invalid", "true");
    await expect(section.getByText("That isn't your current password.")).toHaveCount(0);
    await expect(fields.confirm).toHaveValue("");

    // Nothing changed.
    await logOut(page);
    await logIn(page, user.email, user.password);
    await logOut(page);
    await page.goto("/login");
    await fillLogin(page, user.email, "brand-new-password");
    await expect(formAlert(page)).toHaveText(NO_MATCH);
  });

  test("success: new password works, old one doesn't, and other sessions are signed out", async ({
    page,
    browser,
  }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    // The same account, signed in on another device.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await logIn(otherPage, user.email, user.password);
    // And someone else entirely, who must stay signed in.
    const bystander = await browser.newContext();
    const bystanderPage = await bystander.newPage();
    await logInAs(bystanderPage, "kari");

    const newPassword = `changed-${uid()}`;
    await page.goto("/dashboard");
    const section = passwordSection(page);
    const fields = passwordFields(section);
    await fields.current.fill(user.password);
    await fields.next.fill(newPassword);
    await fields.confirm.fill(newPassword);
    await section.getByRole("button", { name: "Change password" }).click();
    const status = section.getByRole("status");
    await expect(status).toHaveText("Password changed. You've been signed out on your other devices.");
    await expect(status).toBeFocused();
    await expect(fields.current).toHaveValue("");
    await expect(fields.confirm).toHaveValue("");

    // This browser stays signed in.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: `Hi, ${firstName(user.name)}` })).toBeVisible();
    // The other device is signed out.
    await otherPage.goto("/dashboard");
    await expect(otherPage).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await bystanderPage.goto("/dashboard");
    await expect(bystanderPage.getByRole("heading", { level: 1, name: "Hi, Kári" })).toBeVisible();

    // Old password no longer works; the new one does (also with odd email casing).
    await fillLogin(otherPage, user.email, user.password);
    await expect(formAlert(otherPage)).toHaveText(NO_MATCH);
    await fillLogin(otherPage, user.email.toUpperCase(), newPassword);
    await expect(otherPage).toHaveURL(/\/dashboard$/);
    await other.close();
    await bystander.close();
  });
});

test.describe("signing out other devices", () => {
  const SIGNED_OUT = "You've been signed out on all your other devices.";

  function signOutSection(page: Page): Locator {
    return page.locator("form").filter({ has: page.getByRole("button", { name: "Sign out other devices" }) });
  }

  test("ends every other session for the account and keeps this one", async ({ page, browser }) => {
    const user = makeUser("landlord");
    await signUp(page, user);
    const devices = await Promise.all([browser.newContext(), browser.newContext()]);
    const devicePages: Page[] = [];
    for (const device of devices) {
      const devicePage = await device.newPage();
      await logIn(devicePage, user.email, user.password);
      devicePages.push(devicePage);
    }
    const bystander = await browser.newContext();
    const bystanderPage = await bystander.newPage();
    await logInAs(bystanderPage, "sigrun");

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Sign out other devices" }).click();
    // The message shows right by the button, without leaving the page.
    const status = signOutSection(page).getByRole("status");
    await expect(status).toHaveText(SIGNED_OUT);
    await expect(status).toBeFocused();
    await expect(page).toHaveURL(/\/dashboard$/);
    // It's the only message on the page (the password form has none).
    await expect(formStatus(page)).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: `Hi, ${firstName(user.name)}` })).toBeVisible();
    // A one-off message: it's gone after a reload.
    await expect(page.getByText(SIGNED_OUT)).toHaveCount(0);

    for (const devicePage of devicePages) {
      await devicePage.goto("/dashboard");
      await expect(devicePage).toHaveURL(/\/login\?next=%2Fdashboard$/);
    }
    await bystanderPage.goto("/dashboard");
    await expect(bystanderPage.getByRole("heading", { level: 1, name: "Hi, Sigrún" })).toBeVisible();

    // The password didn't change: the other devices can sign in again.
    await fillLogin(devicePages[0], user.email, user.password);
    await expect(devicePages[0]).toHaveURL(/\/dashboard$/);
    for (const context of [...devices, bystander]) await context.close();
  });

  test("works without JavaScript", async ({ browser }) => {
    const user = makeUser("renter");
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    // Signing up works without JavaScript too.
    await page.goto("/signup");
    await fillSignup(page, user);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText(`Your kennitala: ${formatKennitala(user.kennitala)}`)).toBeVisible();
    await logIn(otherPage, user.email, user.password);

    await page.getByRole("button", { name: "Sign out other devices" }).click();
    await expect(signOutSection(page).getByRole("status")).toHaveText(SIGNED_OUT);
    await expect(page).toHaveURL(/\/dashboard$/);
    await otherPage.goto("/dashboard");
    await expect(otherPage).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await context.close();
    await other.close();
  });

  test("a stale tab of a signed-out device is asked to log in again", async ({ page, browser }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await logIn(otherPage, user.email, user.password);
    // Signed out remotely while this tab still shows the dashboard.
    await page.getByRole("button", { name: "Sign out other devices" }).click();
    await expect(signOutSection(page).getByRole("status")).toHaveText(SIGNED_OUT);
    // Its next action finds no session.
    await otherPage.getByRole("button", { name: "Sign out other devices" }).click();
    const alert = signOutSection(otherPage).getByRole("alert");
    await expect(alert).toHaveText("Please log in again.");
    await expect(alert).toBeFocused();
    await otherPage.reload();
    await expect(otherPage).toHaveURL(/\/login\?next=%2Fdashboard$/);
    // The signed-in tab is unaffected.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: `Hi, ${firstName(user.name)}` })).toBeVisible();
    await other.close();
  });
});
