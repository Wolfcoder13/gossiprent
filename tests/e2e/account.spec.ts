import { expect, test, type Page } from "@playwright/test";
import {
  addProperty,
  cardMeta,
  cardSubtitle,
  closeAccount,
  closedNotice,
  CLOSED_NOTICE,
  confirmMessage,
  CANT_REMOVE,
  createActor,
  expectNoKennitala,
  fillLogin,
  fillSignup,
  firstName,
  FIX_FIELDS,
  formAlert,
  formatKennitala,
  formStatus,
  freshKennitala,
  idOf,
  KEPT_NAME,
  keptNameNotice,
  landlordLine,
  landlordLink,
  logIn,
  lookUpKennitala,
  makeProperty,
  makeReview,
  makeUser,
  myProfilePath,
  NAME_LOCKED,
  nameToken,
  NO_ACCOUNT_NOTE,
  NO_MATCH,
  noAccountBadge,
  personCard,
  postReview,
  propertyCard,
  propertyLabel,
  relinkForm,
  reviewCard,
  setLanguage,
  signUp,
  unconfirmedNote,
  type TestUser,
} from "./helpers";

/** Sign up again (same kennitala) and expect the dashboard; `kept` = the page kept its old name. */
async function signUpAgain(page: Page, user: TestUser, kept: boolean): Promise<void> {
  await page.goto("/signup");
  await fillSignup(page, user);
  await expect(page).toHaveURL(kept ? /\/dashboard\?name=kept$/ : /\/dashboard$/);
}

test.describe("dashboard", () => {
  test("shows your own kennitala, formatted; your public page never does", async ({ page, browser }) => {
    const user = makeUser("landlord");
    await signUp(page, user);
    const profile = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your profile" }) });
    await expect(profile.getByText(`Your kennitala: ${formatKennitala(user.kennitala)}`, { exact: true })).toBeVisible();
    await expect(profile.getByText("Only you can see it here. It's never shown publicly.")).toBeVisible();
    // It's not an editable field.
    await expect(profile.getByRole("textbox", { name: /kennitala/i })).toHaveCount(0);

    const path = await myProfilePath(page);
    const pages = [path, `/landlords?q=${encodeURIComponent(user.name)}`, `/search?q=${encodeURIComponent(user.name)}`];
    // Not on their own public page, nor in the directory or search...
    for (const url of pages) {
      await page.goto(url);
      expectNoKennitala(await page.content(), user.kennitala, url);
    }
    // ...nor for anyone else.
    const visitor = await browser.newContext();
    const visitorPage = await visitor.newPage();
    for (const url of pages) {
      await visitorPage.goto(url);
      await expect(visitorPage.getByRole("main").getByText(user.name).first(), url).toBeVisible();
      expectNoKennitala(await visitorPage.content(), user.kennitala, `${url} (visitor)`);
    }
    await visitor.close();
  });

  test("each “Reviews about you” section says you can't remove them", async ({ page }) => {
    await signUp(page, makeUser("both"));
    await expect(page.getByRole("heading", { name: "Reviews about you as a landlord (0)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reviews about you as a renter (0)" })).toBeVisible();
    await expect(page.getByText(CANT_REMOVE, { exact: true })).toHaveCount(2);
    for (const role of ["landlord", "renter"]) {
      const section = page.locator("section").filter({
        has: page.getByRole("heading", { name: `Reviews about you as a ${role}` }),
      });
      await expect(section.getByText(CANT_REMOVE, { exact: true }), role).toBeVisible();
    }
  });

  test("a renter adds the landlord role; reviews in that role then keep it", async ({ page, browser }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    const roles = page.locator("#roles");
    await expect(roles.getByText("Not a landlord", { exact: true })).toBeVisible();
    await roles.getByRole("button", { name: "I'm also a landlord" }).click();
    await expect(roles.getByRole("status")).toHaveText("Done. You're now listed as a landlord too.");
    await expect(page.getByRole("heading", { name: "Reviews about you as a landlord (0)" })).toBeVisible();
    // Nobody has reviewed either role yet, so either can go.
    await expect(roles.getByRole("button", { name: "Remove landlord role" })).toBeVisible();
    await expect(roles.getByRole("button", { name: "Remove renter role" })).toBeVisible();

    // A renter reviews them as a landlord: that role can't be removed any more.
    const renter = await createActor(browser, "renter");
    const landlordPath = await myProfilePath(page);
    await postReview(renter.page, landlordPath, makeReview(4), user.kennitala);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Reviews about you as a landlord (1)" })).toBeVisible();
    await expect(roles.getByText("Renters have reviewed you, so this role stays.")).toBeVisible();
    await expect(roles.getByRole("button", { name: "Remove landlord role" })).toHaveCount(0);
    await expect(roles.getByRole("button", { name: "Remove renter role" })).toBeVisible();
    await renter.context.close();
  });
});

test.describe("profile", () => {
  test("updating name, city, and bio changes the public profile", async ({ page }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    const path = await myProfilePath(page);

    // Prefilled with the current profile.
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(user.name);
    await expect(page.getByLabel("City")).toHaveValue(user.city!);
    await expect(page.getByLabel("Bio")).toHaveValue("");
    // Nobody has reviewed them, so the name isn't locked.
    await expect(page.getByText(NAME_LOCKED)).toHaveCount(0);

    const newName = `Renamed ${nameToken()}`;
    await page.getByLabel("Name", { exact: true }).fill(`  ${newName}  `);
    await page.getByLabel("City").fill("Hafnarfjörður");
    await page.getByLabel("Bio").fill("Quiet renter who loves plants.\nWorks from home.");
    await page.getByRole("button", { name: "Save profile" }).click();

    await expect(formStatus(page)).toHaveText("Profile saved.");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(newName);
    await expect(page.getByRole("heading", { level: 1, name: "Hi, Renamed" })).toBeVisible();

    // Still saved after a reload.
    await page.reload();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(newName);
    await expect(page.getByLabel("City")).toHaveValue("Hafnarfjörður");
    await expect(page.getByLabel("Bio")).toHaveValue("Quiet renter who loves plants.\nWorks from home.");

    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: newName })).toBeVisible();
    await expect(page.getByText(/^Hafnarfjörður · Member since/)).toBeVisible();
    await expect(page.getByText("Quiet renter who loves plants.", { exact: false })).toBeVisible();

    // The directory and search use the new name, and the new city (also typed without accents).
    await page.goto(`/renters?q=${encodeURIComponent(newName)}`);
    await expect(personCard(page, newName)).toHaveAttribute("href", path);
    await page.goto(`/renters?q=${encodeURIComponent(`${newName.split(" ")[1]} hafnarfjordur`)}`);
    await expect(personCard(page, newName)).toHaveAttribute("href", path);
    await page.goto(`/renters?q=${encodeURIComponent(user.name)}`);
    await expect(page.getByText(`0 renters matching “${user.name}”`)).toBeVisible();
  });

  test("clearing optional fields removes them", async ({ page }) => {
    await signUp(page, makeUser("landlord"));
    const path = await myProfilePath(page);
    await page.getByLabel("Bio").fill("Temporary bio");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(formStatus(page)).toHaveText("Profile saved.");

    await page.getByLabel("City").fill("   ");
    await page.getByLabel("Bio").fill("");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(formStatus(page)).toHaveText("Profile saved.");
    await expect(page.getByLabel("City")).toHaveValue("");

    await page.goto(path);
    await expect(page.getByText(/^Member since [A-Z][a-z]+ \d{4}$/)).toBeVisible();
    await expect(page.getByText("Temporary bio")).toHaveCount(0);
  });

  test("an invalid name isn't saved and the typed values are kept", async ({ page }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    await page.getByLabel("Name", { exact: true }).fill(" X ");
    await page.getByLabel("City").fill("Typed City");
    await page.getByLabel("Bio").fill("x".repeat(20));
    await page.getByRole("button", { name: "Save profile" }).click();

    await expect(formAlert(page)).toHaveText(FIX_FIELDS);
    await expect(page.getByText("Name must be at least 2 characters.")).toBeVisible();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(" X ");
    await expect(page.getByLabel("City")).toHaveValue("Typed City");

    // A person's name has no digits.
    await page.getByLabel("Name", { exact: true }).fill("Remy 2000");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Use only letters, spaces, hyphens, apostrophes and periods in a name.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(user.name);
    await expect(page.getByLabel("City")).toHaveValue(user.city!);
  });

  test("a kennitala in the bio is refused", async ({ page }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    const bio = `Ask me anything, kt. ${formatKennitala(freshKennitala())}`;
    await page.getByLabel("Bio").fill(bio);
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(formAlert(page)).toHaveText(FIX_FIELDS);
    await expect(page.getByLabel("Bio")).toHaveAccessibleDescription(
      /Don't include a kennitala here\. ID numbers are never shown on GossipRent\.$/,
    );
    await expect(page.getByLabel("Bio")).toHaveValue(bio);
    // Not saved.
    await page.reload();
    await expect(page.getByLabel("Bio")).toHaveValue("");
  });

  test("a new name shows on reviews you've already written", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const user = makeUser("renter");
    await signUp(page, user);
    const review = makeReview(4, { body: "Solid landlord, answers the phone and fixes things." });
    await postReview(page, landlord.profilePath, review, landlord.user.kennitala);
    await expect(reviewCard(page, review.title).getByRole("link", { name: user.name })).toBeVisible();

    const newName = `Renamed ${nameToken()}`;
    await page.goto("/dashboard");
    await page.getByLabel("Name", { exact: true }).fill(newName);
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(formStatus(page)).toHaveText("Profile saved.");

    await page.goto(landlord.profilePath);
    await expect(reviewCard(page, review.title).getByRole("link", { name: newName })).toBeVisible();
    await expect(page.getByText(user.name)).toHaveCount(0);
    await landlord.context.close();
  });

  test("once someone has reviewed you, your name can't change, but the rest can", async ({ page, browser }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    const path = await myProfilePath(page);
    const id = idOf(path);
    const landlord = await createActor(browser, "landlord");
    await postReview(landlord.page, path, makeReview(5), user.kennitala);

    await page.goto("/dashboard");
    const name = page.getByLabel("Name", { exact: true });
    await expect(name).toHaveAccessibleDescription(NAME_LOCKED);
    const profile = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your profile" }) });
    await expect(profile.getByRole("link", { name: "report it" })).toHaveAttribute(
      "href",
      `/report?target=profile&id=${id}`,
    );

    // A new name is refused.
    await name.fill(`Renamed ${nameToken()}`);
    await page.getByLabel("City").fill("Selfoss");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(formAlert(page)).toHaveText(FIX_FIELDS);
    await expect(name).toHaveAttribute("aria-invalid", "true");
    // The same sentence as the hint, now also as the field's error.
    await expect(name).toHaveAccessibleDescription(`${NAME_LOCKED} ${NAME_LOCKED}`);
    await expect(profile.getByText(NAME_LOCKED, { exact: true })).toHaveCount(2);
    await page.reload();
    await expect(name).toHaveValue(user.name);
    await expect(page.getByLabel("City")).toHaveValue(user.city!);

    // The same name with a new city and bio saves.
    await page.getByLabel("City").fill("Selfoss");
    await page.getByLabel("Bio").fill("Works nights, very quiet.");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(formStatus(page)).toHaveText("Profile saved.");
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: user.name })).toBeVisible();
    await expect(page.getByText(/^Selfoss · Member since/)).toBeVisible();
    await expect(page.getByText("Works nights, very quiet.")).toBeVisible();
    await landlord.context.close();
  });
});

test.describe("closing an account", () => {
  test("the dashboard explains what closing does", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Close account" }) });
    await expect(section).toContainText(
      "Deletes your login and the reviews you wrote. Reviews other people wrote about you stay on the site.",
    );
    await expect(section).toContainText("If you sign up again with the same kennitala, you get your page back.");
    await expect(section.getByRole("button", { name: "Close my account" })).toBeVisible();
  });

  test("cancelling the confirmation keeps the account", async ({ page }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    let message = "";
    page.once("dialog", (dialog) => {
      message = dialog.message();
      void dialog.dismiss();
    });
    await page.getByRole("button", { name: "Close my account" }).click();
    await expect
      .poll(() => message)
      .toBe(
        "Close your account? Your login and the reviews you wrote will be permanently deleted. Reviews other people wrote about you stay on the site.",
      );
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText(`Signed in as ${user.email}`)).toBeVisible();
  });

  test("a reviewed renter's page stays up without an account, with the reviews about them; their own reviews go", async ({
    page,
    browser,
  }) => {
    const landlord = await createActor(browser, "landlord");
    const user = makeUser("renter");
    await signUp(page, user);
    const renterPath = await myProfilePath(page);
    await page.getByLabel("Bio").fill("Night-shift nurse, very quiet.");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(formStatus(page)).toHaveText("Profile saved.");

    // The renter adds a property and reviews the landlord and the property; the landlord reviews the renter.
    const property = makeProperty();
    const propertyPath = await addProperty(page, property);
    const byRenterOfProperty = makeReview(4, { body: "Warm in winter and the landlord lives close by." });
    await postReview(page, propertyPath, byRenterOfProperty);
    const byRenter = makeReview(2, { body: "Took weeks to fix the heating, but polite." });
    await postReview(page, landlord.profilePath, byRenter, landlord.user.kennitala);
    const aboutRenter = makeReview(5, { body: "Looked after the flat and left it spotless." });
    await postReview(landlord.page, renterPath, aboutRenter, user.kennitala);

    // Close the account.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Close account" })).toBeVisible();
    await closeAccount(page);
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "Log in", exact: true })).toBeVisible();
    await expect(header.getByRole("button", { name: "Log out" })).toHaveCount(0);

    // Signed out, and the login no longer works.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await fillLogin(page, user.email, user.password);
    await expect(formAlert(page)).toHaveText(NO_MATCH);

    // The page is still there, now a profile without an account, with the review about them but no bio.
    const response = await page.goto(renterPath);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: user.name })).toBeVisible();
    await expect(noAccountBadge(page)).toBeVisible();
    await expect(page.getByText(NO_ACCOUNT_NOTE, { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Sign up with your kennitala" })).toHaveAttribute(
      "href",
      "/signup",
    );
    await expect(page.getByText(/^First reviewed [A-Z][a-z]+ \d{4}$/)).toBeVisible();
    await expect(page.getByText(/Member since/)).toHaveCount(0);
    await expect(page.getByText("Identity not verified")).toHaveCount(0);
    await expect(page.getByText("Night-shift nurse, very quiet.")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Reviews (1)", exact: true })).toBeVisible();
    await expect(reviewCard(page, aboutRenter.title)).toBeVisible();
    // ...and it's still listed, marked "No account", in the directory (without the city).
    await page.goto(`/renters?q=${encodeURIComponent(user.name)}`);
    const card = personCard(page, user.name);
    await expect(card).toHaveAttribute("href", renterPath);
    await expect(card).toContainText("5 · 1 review");
    expect(await cardMeta(card)).toEqual(["Renter", "No account"]);
    expect(await cardSubtitle(card)).toBeNull();

    // The reviews they wrote are gone.
    await landlord.page.goto(landlord.profilePath);
    await expect(reviewCard(landlord.page, byRenter.title)).toHaveCount(0);
    await expect(landlord.page.getByText(`No reviews for ${landlord.user.name} yet`)).toBeVisible();
    await landlord.page.goto(propertyPath);
    await expect(reviewCard(landlord.page, byRenterOfProperty.title)).toHaveCount(0);
    await expect(landlord.page.getByText("No reviews for this property yet")).toBeVisible();
    // The landlord's own review of them is kept.
    await landlord.page.goto("/dashboard");
    await expect(landlord.page.getByRole("heading", { name: "Reviews about you (0)" })).toBeVisible();
    await expect(landlord.page.getByRole("heading", { name: "Reviews you've written (1)" })).toBeVisible();
    await expect(reviewCard(landlord.page, aboutRenter.title)).toContainText(`Reviewed ${user.name}`);

    // The property they added stays listed.
    await page.goto(propertyPath);
    await expect(page.getByRole("heading", { level: 1, name: propertyLabel(property) })).toBeVisible();

    // Signing up again with the same kennitala takes the page back, with the
    // review about them; it keeps the name the review was written under.
    const again = { ...user, name: `Back ${nameToken()}` };
    await signUpAgain(page, again, true);
    await expect(page.getByRole("heading", { level: 1, name: `Hi, ${firstName(user.name)}` })).toBeVisible();
    await expect(keptNameNotice(page)).toHaveText(KEPT_NAME);
    await expect(page.getByRole("heading", { name: "Reviews about you (1)" })).toBeVisible();
    await expect(reviewCard(page, aboutRenter.title)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reviews you've written (0)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Properties you added (1)" })).toBeVisible();
    await expect(page.getByLabel("Bio")).toHaveValue("");
    expect(await myProfilePath(page)).toBe(renterPath);
    await page.goto(renterPath);
    await expect(page.getByRole("heading", { level: 1, name: user.name })).toBeVisible();
    await expect(noAccountBadge(page)).toHaveCount(0);
    await expect(page.getByText(`${again.city} · Member since`)).toBeVisible();
    await expect(reviewCard(page, aboutRenter.title)).toBeVisible();
    await landlord.context.close();
  });

  test("the closed account's other sessions are signed out too", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const renter = await createActor(browser, "renter");
    // Someone reviewed them, so the page is kept.
    await postReview(landlord.page, renter.profilePath, makeReview(3), renter.user.kennitala);

    await logIn(page, renter.user.email, renter.user.password);
    await closeAccount(page);

    await renter.page.goto("/dashboard");
    await expect(renter.page).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await landlord.context.close();
    await renter.context.close();
  });

  test("an account nobody reviewed and with no properties is deleted outright", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const user = makeUser("renter");
    await signUp(page, user);
    const renterPath = await myProfilePath(page);
    const byRenter = makeReview(4, { body: "Quick to answer and fair with the deposit." });
    await postReview(page, landlord.profilePath, byRenter, landlord.user.kennitala);

    await closeAccount(page);

    expect((await page.goto(renterPath))?.status()).toBe(404);
    await page.goto(`/renters?q=${encodeURIComponent(user.name)}`);
    await expect(page.getByText(`0 renters matching “${user.name}”`)).toBeVisible();
    await page.goto(landlord.profilePath);
    await expect(reviewCard(page, byRenter.title)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Reviews (0)", exact: true })).toBeVisible();

    // The same kennitala can sign up again: a new page, under the new name.
    const again = { ...user, name: `Back ${nameToken()}` };
    await signUpAgain(page, again, false);
    await expect(page.getByRole("heading", { level: 1, name: "Hi, Back" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reviews you've written (0)" })).toBeVisible();
    const newPath = await myProfilePath(page);
    expect(newPath).not.toBe(renterPath);
    await page.goto(newPath);
    await expect(page.getByRole("heading", { level: 1, name: again.name })).toBeVisible();
    await landlord.context.close();
  });

  test("a landlord nobody reviewed keeps a page for their property; signing up again takes it back under a new name", async ({
    page,
  }) => {
    const landlord = makeUser("landlord");
    await signUp(page, landlord);
    const landlordPath = await myProfilePath(page);
    const property = makeProperty();
    const propertyPath = await addProperty(page, property);
    await expect(landlordLine(page, landlord.name)).toBeVisible();
    await expect(unconfirmedNote(page)).toHaveCount(0);

    await closeAccount(page);

    // The property keeps its landlord, now a profile without an account. They
    // listed it themselves, so it doesn't say a renter named them.
    await page.goto(propertyPath);
    await expect(landlordLine(page, landlord.name)).toBeVisible();
    await expect(landlordLink(page, landlord.name)).toHaveAttribute("href", landlordPath);
    await expect(unconfirmedNote(page)).toHaveCount(0);
    await page.goto(landlordPath);
    await expect(page.getByRole("heading", { level: 1, name: landlord.name })).toBeVisible();
    await expect(noAccountBadge(page)).toBeVisible();
    // The note doesn't claim a review created the page or that someone else typed the name.
    await expect(page.getByText(NO_ACCOUNT_NOTE, { exact: true })).toBeVisible();
    await expect(page.getByText(/first review was written/)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Properties (1)" })).toBeVisible();
    await expect(page.getByText(/^First reviewed/)).toHaveCount(0);
    await expect(page.getByText(/Member since/)).toHaveCount(0);
    await page.goto(`/landlords?q=${encodeURIComponent(landlord.name)}`);
    const card = personCard(page, landlord.name);
    expect(await cardMeta(card)).toEqual(["Landlord", "No account"]);
    expect(await cardSubtitle(card)).toBe("1 property");
    await page.goto(`/properties?q=${encodeURIComponent(property.address)}`);
    await expect(propertyCard(page, property)).toContainText(`Landlord: ${landlord.name}`);
    await expect(propertyCard(page, property)).not.toContainText("(not confirmed)");

    // Nobody else described them by name, so signing up again uses the new one.
    const again = { ...landlord, name: `Newname ${nameToken()}` };
    await signUpAgain(page, again, false);
    await expect(page.getByRole("heading", { level: 1, name: "Hi, Newname" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your properties (1)", exact: true })).toBeVisible();
    await expect(page.getByLabel("Name", { exact: true })).not.toHaveAccessibleDescription(NAME_LOCKED);
    expect(await myProfilePath(page)).toBe(landlordPath);
    await page.goto(propertyPath);
    await expect(landlordLine(page, again.name)).toBeVisible();
    await expect(unconfirmedNote(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Not my property" })).toBeVisible();
  });

  test("a reviewed landlord's closed page keeps its reviews and can still be found by kennitala", async ({
    page,
    browser,
  }) => {
    const landlord = await createActor(browser, "landlord");
    const renter = await createActor(browser, "renter");
    const about = makeReview(1, { body: "Kept the whole deposit for no reason at all." });
    await postReview(renter.page, landlord.profilePath, about, landlord.user.kennitala);

    await closeAccount(landlord.page);

    await page.goto(landlord.profilePath);
    await expect(noAccountBadge(page)).toBeVisible();
    await expect(reviewCard(page, about.title)).toBeVisible();
    await expect(page.getByRole("img", { name: "Rated 1 out of 5 stars" }).first()).toBeVisible();

    // Looking the kennitala up still finds the page.
    await renter.page.goto("/search");
    await lookUpKennitala(renter.page, landlord.user.kennitala);
    await expect(renter.page).toHaveURL(landlord.profilePath);
    // A renter adding the place they rent can still link them by kennitala.
    const property = makeProperty();
    const propertyPath = await addProperty(renter.page, property, { kennitala: landlord.user.kennitala });
    // A renter named them and they have no account: not confirmed.
    await expect(landlordLine(renter.page, landlord.user.name)).toBeVisible();
    await expect(unconfirmedNote(renter.page)).toBeVisible();
    await page.goto(landlord.profilePath);
    await expect(page.getByRole("heading", { name: "Properties (1)" })).toBeVisible();
    await page.goto(propertyPath);
    await expect(landlordLink(page, landlord.user.name)).toHaveAttribute("href", landlord.profilePath);
    await landlord.context.close();
    await renter.context.close();
  });
});

test.describe("closing a landlord account that has properties", () => {
  test("their properties stay linked; signing up again takes them back", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const renter = await createActor(browser, "renter");
    const property = makeProperty();
    const propertyPath = await addProperty(landlord.page, property);
    // A renter lists another place and links this landlord to it.
    const linkedPath = await addProperty(renter.page, makeProperty(), { kennitala: landlord.user.kennitala });
    // While the landlord has an account, the renter can't change the link.
    await expect(relinkForm(renter.page)).toHaveCount(0);
    // A review about the landlord.
    const about = makeReview(2, { body: "Slow to fix anything, but friendly." });
    await postReview(renter.page, landlord.profilePath, about, landlord.user.kennitala);

    await closeAccount(landlord.page);

    // The page is kept, with the review and both properties.
    await page.goto(landlord.profilePath);
    await expect(noAccountBadge(page)).toBeVisible();
    await expect(reviewCard(page, about.title)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Properties (2)" })).toBeVisible();
    // The one they listed themselves isn't "not confirmed"; the one a renter named them for is.
    await page.goto(propertyPath);
    await expect(landlordLine(page, landlord.user.name)).toBeVisible();
    await expect(unconfirmedNote(page)).toHaveCount(0);
    await page.goto(linkedPath);
    await expect(landlordLine(page, landlord.user.name)).toBeVisible();
    await expect(unconfirmedNote(page)).toBeVisible();
    await page.goto(`/properties?q=${encodeURIComponent(property.address)}`);
    await expect(propertyCard(page, property)).toContainText(`Landlord: ${landlord.user.name}`);
    await expect(propertyCard(page, property)).not.toContainText("(not confirmed)");
    // The renter who added the second place may now change its landlord.
    await renter.page.goto(linkedPath);
    await expect(renter.page.locator("summary", { hasText: "Change the landlord" })).toBeVisible();

    // The same person signs up again and gets the page and the properties back,
    // under the name the review was written under.
    const again = { ...landlord.user, name: `Newname ${nameToken()}` };
    await signUpAgain(page, again, true);
    await expect(page.getByRole("heading", { level: 1, name: `Hi, ${firstName(landlord.user.name)}` })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your properties (2)", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reviews about you (1)" })).toBeVisible();
    expect(await myProfilePath(page)).toBe(landlord.profilePath);
    for (const path of [propertyPath, linkedPath]) {
      await page.goto(path);
      await expect(landlordLine(page, landlord.user.name), path).toBeVisible();
      await expect(unconfirmedNote(page), path).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Not my property" }), path).toBeVisible();
    }
    // The landlord has an account again, so the renter can't change the link any more.
    await renter.page.goto(linkedPath);
    await expect(relinkForm(renter.page)).toHaveCount(0);
    await landlord.context.close();
    await renter.context.close();
  });
});

test.describe("in Icelandic", () => {
  test("the dashboard shows the kennitala, saves the profile and closes the account", async ({ page, context }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    await setLanguage(context, "is");
    await page.goto("/dashboard");
    await expect(page.locator("html")).toHaveAttribute("lang", "is");
    await expect(page).toHaveTitle("Mínar síður · GossipRent");
    await expect(page.getByRole("heading", { level: 1, name: `Hæ, ${firstName(user.name)}` })).toBeVisible();
    await expect(page.getByText(`Netfang: ${user.email}`)).toBeVisible();
    await expect(page.getByText(`Kennitalan þín: ${formatKennitala(user.kennitala)}`, { exact: true })).toBeVisible();
    await expect(page.getByText("Aðeins þú sérð hana hér. Hún er aldrei birt opinberlega.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Umsagnir um þig (0)" })).toBeVisible();
    await expect(
      page.getByText(
        "Þú getur ekki fjarlægt umsagnir sem aðrir skrifa um þig, en þú getur tilkynnt umsögn sem brýtur reglurnar.",
      ),
    ).toBeVisible();

    await page.getByLabel("Staður").fill("Ísafjörður");
    await page.getByRole("button", { name: "Vista", exact: true }).click();
    await expect(formStatus(page)).toHaveText("Vistað.");
    await expect(page.getByLabel("Staður")).toHaveValue("Ísafjörður");

    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Eyða aðgangi" }) });
    await expect(section).toContainText(
      "Eyðir innskráningunni þinni og umsögnunum sem þú skrifaðir. Umsagnir sem aðrir skrifuðu um þig verða áfram á vefnum.",
    );
    await expect(section).toContainText("Ef þú stofnar aðgang aftur með sömu kennitölu færðu síðuna þína til baka.");
    const message = await confirmMessage(page, section.getByRole("button", { name: "Eyða aðgangi" }));
    await expect(page).toHaveURL(/\/\?account=deleted$/);
    expect(message).toBe(
      "Eyða aðganginum? Innskráningunni þinni og umsögnunum sem þú skrifaðir verður eytt varanlega. Umsagnir sem aðrir skrifuðu um þig verða áfram á vefnum.",
    );
    await expect(
      page
        .getByRole("main")
        .getByRole("status")
        .filter({ hasText: "Aðganginum þínum hefur verið lokað og umsögnunum sem þú skrifaðir hefur verið eytt." }),
    ).toBeVisible();
  });
});

test.describe("the account-closed notice", () => {
  test("only shows to signed-out visitors", async ({ page }) => {
    await page.goto("/?account=deleted");
    await expect(closedNotice(page)).toHaveText(CLOSED_NOTICE);
    // Someone signed in (e.g. following an old link) isn't told their account is closed.
    await signUp(page, makeUser("renter"));
    await page.goto("/?account=deleted");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByText(CLOSED_NOTICE)).toHaveCount(0);
  });
});
