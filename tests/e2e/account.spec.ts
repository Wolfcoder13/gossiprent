import { expect, test } from "@playwright/test";
import {
  addProperty,
  cardMeta,
  clickAndConfirm,
  createActor,
  escapeRegExp,
  fillLogin,
  fillPropertyForm,
  fillReview,
  formAlert,
  formStatus,
  logIn,
  makeProperty,
  makeUser,
  myProfilePath,
  propertyLabel,
  reviewCard,
  signUp,
  uid,
} from "./helpers";

const NO_LANDLORD = "The landlord for this property isn't on GossipRent yet.";
const CLAIMED = "Done. You're now listed as this property's landlord.";
const CLOSED_NOTICE = "Your account is closed and the reviews you wrote have been deleted.";

test.describe("profile", () => {
  test("updating name, city, and bio changes the public profile", async ({ page }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    const path = await myProfilePath(page);

    // Prefilled with the current profile.
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(user.name);
    await expect(page.getByLabel("City")).toHaveValue(user.city!);
    await expect(page.getByLabel("Bio")).toHaveValue("");

    const newName = `Renamed E2e${uid()}`;
    await page.getByLabel("Name", { exact: true }).fill(`  ${newName}  `);
    await page.getByLabel("City").fill("Lakeside, MN");
    await page.getByLabel("Bio").fill("Quiet tenant who loves plants.\nAlways pays on the 1st.");
    await page.getByRole("button", { name: "Save profile" }).click();

    await expect(formStatus(page)).toHaveText("Profile saved.");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(newName);
    await expect(page.getByRole("heading", { level: 1, name: "Hi, Renamed" })).toBeVisible();

    // Still saved after a reload.
    await page.reload();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(newName);
    await expect(page.getByLabel("City")).toHaveValue("Lakeside, MN");
    await expect(page.getByLabel("Bio")).toHaveValue("Quiet tenant who loves plants.\nAlways pays on the 1st.");

    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: newName })).toBeVisible();
    await expect(page.getByText(/^Lakeside, MN · Member since/)).toBeVisible();
    await expect(page.getByText("Quiet tenant who loves plants.", { exact: false })).toBeVisible();

    // The directory and search use the new name.
    await page.goto(`/renters?q=${encodeURIComponent(newName)}`);
    await expect(page.getByRole("link", { name: new RegExp(newName) })).toHaveAttribute("href", path);
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

    await expect(formAlert(page)).toHaveText("Please fix the highlighted fields.");
    await expect(page.getByText("Name must be at least 2 characters.")).toBeVisible();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(" X ");
    await expect(page.getByLabel("City")).toHaveValue("Typed City");

    await page.reload();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(user.name);
    await expect(page.getByLabel("City")).toHaveValue(user.city!);
  });

  test("a new name shows on reviews you've already written", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const user = makeUser("renter");
    await signUp(page, user);
    await page.goto(landlord.profilePath);
    const title = `Rename check ${uid()}`;
    await fillReview(page, { stars: 4, title, body: "Solid landlord, answers the phone and fixes things." });
    await page.getByRole("button", { name: "Post review" }).click();
    await expect(reviewCard(page, title).getByRole("link", { name: user.name })).toBeVisible();

    const newName = `Renamed E2e${uid()}`;
    await page.goto("/dashboard");
    await page.getByLabel("Name", { exact: true }).fill(newName);
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(formStatus(page)).toHaveText("Profile saved.");

    await page.goto(landlord.profilePath);
    await expect(reviewCard(page, title).getByRole("link", { name: newName })).toBeVisible();
    await expect(page.getByText(user.name)).toHaveCount(0);
    await landlord.context.close();
  });
});

test.describe("closing an account", () => {
  test("the dashboard explains what closing does", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Close account" }) });
    await expect(section).toContainText("Deletes your login and the reviews you wrote.");
    await expect(section).toContainText("Reviews other people wrote about you stay public on your profile, marked as closed.");
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
    await expect.poll(() => message).toContain("Close your account?");
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText(`Signed in as ${user.email}`)).toBeVisible();
  });

  test("a reviewed renter's profile stays up, marked closed, with the reviews about them; their own reviews go", async ({
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
    const byRenterOfProperty = `Property by renter ${uid()}`;
    await fillReview(page, { stars: 4, title: byRenterOfProperty, body: "Warm in winter and the landlord is close by." });
    await page.getByRole("button", { name: "Post review" }).click();
    await expect(reviewCard(page, byRenterOfProperty)).toBeVisible();

    const byRenter = `By renter ${uid()}`;
    await page.goto(landlord.profilePath);
    await fillReview(page, { stars: 2, title: byRenter, body: "Took weeks to fix the heating, but polite." });
    await page.getByRole("button", { name: "Post review" }).click();
    await expect(reviewCard(page, byRenter)).toBeVisible();

    const aboutRenter = `About renter ${uid()}`;
    await landlord.page.goto(renterPath);
    await fillReview(landlord.page, { stars: 5, title: aboutRenter, body: "Paid on time and left the place spotless." });
    await landlord.page.getByRole("button", { name: "Post review" }).click();
    await expect(reviewCard(landlord.page, aboutRenter)).toBeVisible();

    // Close the account.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Close account" })).toBeVisible();
    await clickAndConfirm(page, page.getByRole("button", { name: "Close my account" }));
    await expect(page).toHaveURL(/\/\?account=deleted$/);
    await expect(formStatus(page)).toHaveText(CLOSED_NOTICE);
    await expect(page.getByRole("banner").getByRole("link", { name: "Log in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);

    // Signed out, and the login no longer works.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await fillLogin(page, user.email, user.password);
    await expect(formAlert(page)).toHaveText("That email and password don't match an account.");

    // The profile is still there, marked as closed, with the review about them but no bio.
    const response = await page.goto(renterPath);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: user.name })).toBeVisible();
    await expect(page.getByText("Account closed", { exact: true })).toBeVisible();
    await expect(page.getByText(`${user.name} closed their account. Reviews written about them are still shown.`)).toBeVisible();
    await expect(page.getByText("Night-shift nurse, very quiet.")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Reviews (1)", exact: true })).toBeVisible();
    await expect(reviewCard(page, aboutRenter)).toBeVisible();
    // ...and it's still listed (marked closed) in the directory.
    await page.goto(`/renters?q=${encodeURIComponent(user.name)}`);
    const card = page.getByRole("link", { name: new RegExp(user.name) });
    await expect(card).toHaveAttribute("href", renterPath);
    await expect(card).toContainText("Account closed");
    await expect(card).toContainText("5 · 1 review");
    expect(await cardMeta(card)).toEqual(["Renter", "· Account closed"]);

    // The reviews they wrote are gone.
    await landlord.page.goto(landlord.profilePath);
    await expect(reviewCard(landlord.page, byRenter)).toHaveCount(0);
    await expect(landlord.page.getByText(`No reviews for ${landlord.user.name} yet`)).toBeVisible();
    await landlord.page.goto(propertyPath);
    await expect(reviewCard(landlord.page, byRenterOfProperty)).toHaveCount(0);
    await expect(landlord.page.getByText("No reviews for this property yet")).toBeVisible();
    // The landlord's own review of them is kept.
    await landlord.page.goto("/dashboard");
    await expect(landlord.page.getByRole("heading", { name: "Reviews about you (0)" })).toBeVisible();
    await expect(landlord.page.getByRole("heading", { name: "Reviews you've written (1)" })).toBeVisible();
    await expect(reviewCard(landlord.page, aboutRenter)).toContainText(`Reviewed ${user.name}`);

    // The property they added stays listed.
    await page.goto(propertyPath);
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(property.address) })).toBeVisible();

    // The email address can be used again, for a brand-new, empty profile.
    const again = { ...user, name: `Back Again ${uid()}` };
    await signUp(page, again);
    await expect(page.getByRole("heading", { name: "Reviews about you (0)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reviews you've written (0)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Properties you added (0)" })).toBeVisible();
    const newPath = await myProfilePath(page);
    expect(newPath).not.toBe(renterPath);
    await page.goto(newPath);
    await expect(page.getByRole("heading", { level: 1, name: again.name })).toBeVisible();
    await expect(page.getByText("Account closed", { exact: true })).toHaveCount(0);
    await expect(page.getByText(`No reviews for ${again.name} yet`)).toBeVisible();
    // The old, closed profile keeps its review.
    await page.goto(renterPath);
    await expect(page.getByRole("heading", { level: 1, name: user.name })).toBeVisible();
    await expect(reviewCard(page, aboutRenter)).toBeVisible();
    await landlord.context.close();
  });

  test("the closed account's other sessions are signed out too", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const renter = await createActor(browser, "renter");
    // Someone reviewed them, so the profile is kept (soft delete).
    await landlord.page.goto(renter.profilePath);
    await fillReview(landlord.page, { stars: 3, title: `About ${uid()}`, body: "Fine tenant, a bit noisy at times." });
    await landlord.page.getByRole("button", { name: "Post review" }).click();
    await expect(formStatus(landlord.page)).toHaveText("Thanks! Your review is live.");

    await logIn(page, renter.user.email, renter.user.password);
    await clickAndConfirm(page, page.getByRole("button", { name: "Close my account" }));
    await expect(page).toHaveURL(/\/\?account=deleted$/);

    await renter.page.goto("/dashboard");
    await expect(renter.page).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await landlord.context.close();
    await renter.context.close();
  });

  test("an account nobody reviewed is deleted outright", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const user = makeUser("renter");
    await signUp(page, user);
    const renterPath = await myProfilePath(page);
    const byRenter = `By renter ${uid()}`;
    await page.goto(landlord.profilePath);
    await fillReview(page, { stars: 4, title: byRenter, body: "Quick to answer and fair with the deposit." });
    await page.getByRole("button", { name: "Post review" }).click();
    await expect(reviewCard(page, byRenter)).toBeVisible();

    await page.goto("/dashboard");
    await clickAndConfirm(page, page.getByRole("button", { name: "Close my account" }));
    await expect(page).toHaveURL(/\/\?account=deleted$/);
    await expect(formStatus(page)).toHaveText(CLOSED_NOTICE);

    expect((await page.goto(renterPath))?.status()).toBe(404);
    await page.goto(`/renters?q=${encodeURIComponent(user.name)}`);
    await expect(page.getByText(`0 renters matching “${user.name}”`)).toBeVisible();
    await page.goto(landlord.profilePath);
    await expect(reviewCard(page, byRenter)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Reviews (0)", exact: true })).toBeVisible();

    await signUp(page, { ...user, name: `Back Again ${uid()}` });
    await landlord.context.close();
  });

  test("a landlord nobody reviewed is deleted; their properties stay listed, without a landlord", async ({ page }) => {
    const landlord = makeUser("landlord");
    await signUp(page, landlord);
    const property = makeProperty();
    const propertyPath = await addProperty(page, property);
    await expect(page.getByText(`Landlord: ${landlord.name}`)).toBeVisible();

    await page.goto("/dashboard");
    await clickAndConfirm(page, page.getByRole("button", { name: "Close my account" }));
    await expect(page).toHaveURL(/\/\?account=deleted$/);

    await page.goto(propertyPath);
    await expect(page.getByText("The landlord for this property isn't on GossipRent yet.")).toBeVisible();
    await page.goto(`/landlords?q=${encodeURIComponent(landlord.name)}`);
    await expect(page.getByText(`0 landlords matching “${landlord.name}”`)).toBeVisible();
  });

  test("a reviewed landlord's closed profile keeps its reviews and can't be picked for new properties", async ({
    page,
    browser,
  }) => {
    const landlord = await createActor(browser, "landlord");
    const renter = await createActor(browser, "renter");
    const about = `About landlord ${uid()}`;
    await renter.page.goto(landlord.profilePath);
    await fillReview(renter.page, { stars: 1, title: about, body: "Kept the whole deposit for no reason at all." });
    await renter.page.getByRole("button", { name: "Post review" }).click();
    await expect(formStatus(renter.page)).toHaveText("Thanks! Your review is live.");

    await landlord.page.goto("/dashboard");
    await clickAndConfirm(landlord.page, landlord.page.getByRole("button", { name: "Close my account" }));
    await expect(landlord.page).toHaveURL(/\/\?account=deleted$/);

    await page.goto(landlord.profilePath);
    await expect(page.getByText("Account closed", { exact: true })).toBeVisible();
    await expect(reviewCard(page, about)).toBeVisible();
    await expect(page.getByRole("img", { name: "Rated 1 out of 5 stars" }).first()).toBeVisible();

    // A renter adding the place they rent can't link the closed landlord.
    await renter.page.goto("/properties/new");
    await expect(renter.page.getByLabel("Landlord").locator("option", { hasText: landlord.user.name })).toHaveCount(0);
    await landlord.context.close();
    await renter.context.close();
  });
});

test.describe("closing a landlord account that has properties", () => {
  // Regression: closing a reviewed landlord's account (a soft delete) used to
  // leave every property pointing at the closed profile, so nobody could ever
  // claim or unlink them.
  test("their properties can be claimed by whoever manages them now", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const renter = await createActor(browser, "renter");
    const property = makeProperty();
    const propertyPath = await addProperty(landlord.page, property);
    // A renter lists another place and links this landlord to it.
    const linked = makeProperty();
    await renter.page.goto("/properties/new");
    await fillPropertyForm(renter.page, linked, landlord.user.name);
    await expect(renter.page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
    const linkedPath = new URL(renter.page.url()).pathname;
    // A review about the landlord means closing keeps the profile.
    await renter.page.goto(landlord.profilePath);
    const about = `About ${uid()}`;
    await fillReview(renter.page, { stars: 2, title: about, body: "Slow to fix anything, but friendly." });
    await renter.page.getByRole("button", { name: "Post review" }).click();
    await expect(formStatus(renter.page)).toHaveText("Thanks! Your review is live.");

    await landlord.page.goto("/dashboard");
    await clickAndConfirm(landlord.page, landlord.page.getByRole("button", { name: "Close my account" }));
    await expect(landlord.page).toHaveURL(/\/\?account=deleted$/);

    // The closed profile is kept, with the review, but no longer manages anything.
    await page.goto(landlord.profilePath);
    await expect(page.getByText("Account closed", { exact: true })).toBeVisible();
    await expect(reviewCard(page, about)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Properties (0)" })).toBeVisible();
    for (const path of [propertyPath, linkedPath]) {
      await page.goto(path);
      await expect(page.getByText(NO_LANDLORD), path).toBeVisible();
      await expect(page.getByText(`Landlord: ${landlord.user.name}`), path).toHaveCount(0);
    }
    await page.goto(`/properties?q=${encodeURIComponent(property.address)}`);
    await expect(page.getByRole("link", { name: new RegExp(escapeRegExp(propertyLabel(property))) })).toContainText(
      "Landlord not on GossipRent yet",
    );

    // The same person signs up again (or a new manager takes over) and claims them.
    const manager = { ...landlord.user, name: `New Manager ${uid()}` };
    await signUp(page, manager);
    for (const path of [propertyPath, linkedPath]) {
      await page.goto(path);
      await page.getByRole("button", { name: "I manage this property" }).click();
      await expect(formStatus(page)).toHaveText(CLAIMED);
      await expect(page.getByText(`Landlord: ${manager.name}`)).toBeVisible();
      await expect(page.getByRole("button", { name: "Not my property" })).toBeVisible();
    }
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Your properties (2)", exact: true })).toBeVisible();
    await landlord.context.close();
    await renter.context.close();
  });
});

test.describe("the account-closed notice", () => {
  test("only shows to signed-out visitors", async ({ page }) => {
    await page.goto("/?account=deleted");
    await expect(formStatus(page)).toHaveText(CLOSED_NOTICE);
    // Someone signed in (e.g. following an old link) isn't told their account is closed.
    await signUp(page, makeUser("renter"));
    await page.goto("/?account=deleted");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByText(CLOSED_NOTICE)).toHaveCount(0);
  });
});
