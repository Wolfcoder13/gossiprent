import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  addProperty,
  cardMeta,
  clickAndCancel,
  clickAndConfirm,
  createActor,
  DEMO,
  DEMO_PASSWORD,
  escapeRegExp,
  fillPropertyForm,
  fillReview,
  findPersonPath,
  formAlert,
  formStatus,
  homeStat,
  landlordSelect,
  logIn,
  makeProperty,
  makeReview,
  makeUser,
  myProfilePath,
  otherRolePath,
  pickLandlord,
  postReview,
  propertyLabel,
  relationGroup,
  relationRadio,
  reviewCard,
  signUp,
  summaryAverage,
  summaryCount,
} from "./helpers";

/** The "Your roles" card on the dashboard. */
function rolesCard(page: Page): Locator {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Your roles" }) });
}

/** The "As a landlord / As a renter" tabs on a profile. */
function roleTabs(page: Page): Locator {
  return page.getByRole("navigation", { name: "Ratings by role" });
}

function roleTab(page: Page, label: "As a landlord" | "As a renter"): Locator {
  return roleTabs(page).getByRole("link", { name: new RegExp(`^${label} `) });
}

function heading(page: Page, name: string): Locator {
  return page.getByRole("heading", { name, exact: true });
}

const ADDED_LANDLORD = "Done. You're now listed as a landlord too.";
const ADDED_RENTER = "Done. You're now listed as a renter too.";
const REMOVED_LANDLORD = "Done. You're no longer listed as a landlord.";
const REMOVED_RENTER = "Done. You're no longer listed as a renter.";
const KEPT_LANDLORD = "Renters have reviewed you, so this role stays.";
const KEPT_RENTER = "Landlords have reviewed you, so this role stays.";

test.describe("signing up as both", () => {
  test("ticking both boxes makes a renter-and-landlord account", async ({ page }) => {
    const user = makeUser("both");
    await signUp(page, user);

    // Both badges, and the quick actions of both roles.
    const signedInAs = page.getByText(`Signed in as ${user.email}`);
    await expect(signedInAs).toBeVisible();
    const badges = signedInAs.locator("..");
    await expect(badges.getByText("Landlord", { exact: true })).toBeVisible();
    await expect(badges.getByText("Renter", { exact: true })).toBeVisible();
    const actions = page.getByRole("region", { name: "Quick actions" });
    await expect(actions.getByRole("link", { name: "Review a landlord" })).toHaveAttribute("href", "/landlords");
    await expect(actions.getByRole("link", { name: "Review a renter" })).toHaveAttribute("href", "/renters");
    await expect(actions.getByRole("link", { name: "Review a property" })).toHaveAttribute("href", "/properties");
    await expect(actions.getByRole("link", { name: "Add a property" })).toHaveAttribute(
      "href",
      "/properties/new?as=landlord",
    );

    // A separate "reviews about you" section (and rating) for each role.
    await expect(heading(page, "Reviews about you as a landlord (0)")).toBeVisible();
    await expect(heading(page, "Reviews about you as a renter (0)")).toBeVisible();
    await expect(page.getByText("No renters have reviewed you yet")).toBeVisible();
    await expect(page.getByText("No landlords have reviewed you yet")).toBeVisible();
    await expect(heading(page, "Reviews of your properties (0)")).toBeVisible();
    await expect(heading(page, "Your properties (0)")).toBeVisible();
    await expect(heading(page, "Places you added as a renter (0)")).toBeVisible();
    await expect(heading(page, "Reviews you've written (0)")).toBeVisible();

    // Either role can be removed (nobody has reviewed them yet), landlord listed first.
    const roles = rolesCard(page);
    await expect(roles.getByRole("listitem")).toHaveText([/^Landlord\s*Remove landlord role$/, /^Renter\s*Remove renter role$/]);
    await expect(roles.getByRole("button", { name: "Remove landlord role" })).toBeVisible();
    await expect(roles.getByRole("button", { name: "Remove renter role" })).toBeVisible();
    await expect(roles.getByRole("button", { name: /^I'm also a/ })).toHaveCount(0);
    await expect(roles.getByText(/so this role stays/)).toHaveCount(0);

    // Two public pages, linked by tabs; "View public profile" opens the landlord one.
    const landlordPath = await myProfilePath(page);
    expect(landlordPath).toMatch(/^\/landlords\//);
    const renterPath = otherRolePath(landlordPath);
    await page.goto(landlordPath);
    await expect(page.getByRole("heading", { level: 1, name: user.name })).toBeVisible();
    await expect(roleTab(page, "As a landlord")).toHaveText("As a landlord (no reviews)");
    await expect(roleTab(page, "As a landlord")).toHaveAttribute("aria-current", "page");
    await expect(roleTab(page, "As a renter")).toHaveText("As a renter (no reviews)");
    await expect(roleTab(page, "As a renter")).toHaveAttribute("href", renterPath);
    await expect(roleTab(page, "As a renter")).not.toHaveAttribute("aria-current", "page");
    await expect(page.getByText("This is your public profile.", { exact: false })).toBeVisible();

    // Listed in both directories, each card linking to that role's page.
    await page.goto(`/landlords?q=${encodeURIComponent(user.name)}`);
    const asLandlord = page.getByRole("link", { name: new RegExp(escapeRegExp(user.name)) });
    await expect(asLandlord).toHaveAttribute("href", landlordPath);
    expect(await cardMeta(asLandlord)).toEqual(["Landlord", "· Also a renter"]);
    await page.goto(`/renters?q=${encodeURIComponent(user.name)}`);
    const asRenter = page.getByRole("link", { name: new RegExp(escapeRegExp(user.name)) });
    await expect(asRenter).toHaveAttribute("href", renterPath);
    expect(await cardMeta(asRenter)).toEqual(["Renter", "· Also a landlord"]);
  });

  test("directory cards: role, property count, then the other role", async ({ page }) => {
    const user = makeUser("both");
    await signUp(page, user);
    await addProperty(page, makeProperty(), { relation: "own" });
    await addProperty(page, makeProperty(), { relation: "own" });
    // A place they rent doesn't count as one of their properties.
    await addProperty(page, makeProperty(), { relation: "rent" });
    await page.goto(`/landlords?q=${encodeURIComponent(user.name)}`);
    const asLandlord = page.getByRole("link", { name: new RegExp(escapeRegExp(user.name)) });
    expect(await cardMeta(asLandlord)).toEqual(["Landlord", "· 2 properties", "· Also a renter"]);
    await page.goto(`/renters?q=${encodeURIComponent(user.name)}`);
    const asRenter = page.getByRole("link", { name: new RegExp(escapeRegExp(user.name)) });
    expect(await cardMeta(asRenter)).toEqual(["Renter", "· Also a landlord"]);
  });

  test("counts as one more landlord and one more renter on the home page", async ({ page }) => {
    await page.goto("/");
    const before = { landlords: await homeStat(page, "Landlords"), renters: await homeStat(page, "Renters") };
    await signUp(page, makeUser("both"));
    await page.goto("/");
    expect(await homeStat(page, "Landlords")).toBe(before.landlords + 1);
    expect(await homeStat(page, "Renters")).toBe(before.renters + 1);
  });

  test("unticking the preselected role and ticking none shows an error; ticking both works", async ({ page }) => {
    const user = makeUser("both");
    await page.goto("/signup?role=renter");
    await page.getByRole("checkbox", { name: "I'm a renter" }).uncheck();
    await page.getByLabel("Name", { exact: true }).fill(user.name);
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Choose at least one: renter, landlord, or both.")).toBeVisible();
    for (const name of ["I'm a renter", "I'm a landlord"]) {
      await expect(page.getByRole("checkbox", { name }), name).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByRole("checkbox", { name }), name).toHaveAccessibleDescription(
        "Choose at least one: renter, landlord, or both.",
      );
    }
    await expect(page).toHaveURL(/\/signup\?role=renter$/);
    // Nothing is ticked after the error (the ?role= preselection doesn't come back).
    await expect(page.getByRole("checkbox", { name: "I'm a renter" })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "I'm a landlord" })).not.toBeChecked();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(user.name);

    await page.getByRole("checkbox", { name: "I'm a renter" }).check();
    await page.getByRole("checkbox", { name: "I'm a landlord" }).check();
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(heading(page, "Reviews about you as a landlord (0)")).toBeVisible();
    await expect(heading(page, "Reviews about you as a renter (0)")).toBeVisible();
  });
});

test.describe("reviewing with both roles", () => {
  test("someone with both roles reviews a landlord and a renter, in the right role each time", async ({
    page,
    browser,
  }) => {
    const landlord = await createActor(browser, "landlord");
    const renter = await createActor(browser, "renter");
    const user = makeUser("both");
    await signUp(page, user);
    const myLandlordPath = await myProfilePath(page);
    const myRenterPath = otherRolePath(myLandlordPath);

    // As a renter, about their landlord: signed as a renter, linking to their renter page.
    const aboutLandlord = makeReview(4);
    await postReview(page, landlord.profilePath, aboutLandlord);
    let card = reviewCard(page, aboutLandlord.title);
    await expect(card.getByText("Renter", { exact: true })).toBeVisible();
    await expect(card.getByRole("link", { name: user.name })).toHaveAttribute("href", myRenterPath);

    // As a landlord, about their renter.
    const aboutRenter = makeReview(2);
    await postReview(page, renter.profilePath, aboutRenter);
    card = reviewCard(page, aboutRenter.title);
    await expect(card.getByText("Landlord", { exact: true })).toBeVisible();
    await expect(card.getByRole("link", { name: user.name })).toHaveAttribute("href", myLandlordPath);

    // And a property.
    const propertyPath = await addProperty(landlord.page, makeProperty());
    const aboutProperty = makeReview(5);
    await postReview(page, propertyPath, aboutProperty);

    await page.goto("/dashboard");
    await expect(heading(page, "Reviews you've written (3)")).toBeVisible();
    await expect(reviewCard(page, aboutLandlord.title).getByText(`Reviewed ${landlord.user.name}`)).toBeVisible();
    await expect(reviewCard(page, aboutRenter.title).getByText(`Reviewed ${renter.user.name}`)).toBeVisible();
    // Writing doesn't change their own ratings.
    await expect(heading(page, "Reviews about you as a landlord (0)")).toBeVisible();
    await expect(heading(page, "Reviews about you as a renter (0)")).toBeVisible();

    // The people reviewed see it on their dashboards.
    await landlord.page.goto("/dashboard");
    await expect(heading(landlord.page, "Reviews about you (1)")).toBeVisible();
    await expect(reviewCard(landlord.page, aboutLandlord.title)).toBeVisible();
    await renter.page.goto("/dashboard");
    await expect(heading(renter.page, "Reviews about you (1)")).toBeVisible();
    await expect(reviewCard(renter.page, aboutRenter.title)).toBeVisible();

    await landlord.context.close();
    await renter.context.close();
  });

  test("can't review themselves on either of their pages, or a property they manage", async ({ page }) => {
    const user = makeUser("both");
    await signUp(page, user);
    const landlordPath = await myProfilePath(page);
    for (const path of [landlordPath, otherRolePath(landlordPath)]) {
      await page.goto(path);
      await expect(page.getByText("This is your public profile.", { exact: false }), path).toBeVisible();
      await expect(page.getByRole("button", { name: "Post review" }), path).toHaveCount(0);
      await expect(page.getByRole("radio"), path).toHaveCount(0);
    }

    const propertyPath = await addProperty(page, makeProperty(), { relation: "own" });
    await page.goto(propertyPath);
    await expect(page.getByText("You're the landlord for this property.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Post review" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Review this property" })).toHaveCount(0);
  });
});

test.describe("profiles of people with both roles", () => {
  test("each role has its own rating and reviews, and the tabs switch between them", async ({ page, browser }) => {
    const subject = await createActor(browser, "both");
    const landlordPath = subject.profilePath;
    const renterPath = otherRolePath(landlordPath);
    const renter = await createActor(browser, "renter");
    const landlord = await createActor(browser, "landlord");

    const asLandlord = makeReview(5);
    await postReview(renter.page, landlordPath, asLandlord);
    const asRenter = makeReview(2);
    await postReview(landlord.page, renterPath, asRenter);

    await page.goto(landlordPath);
    await expect(page.getByRole("heading", { level: 1, name: subject.user.name })).toBeVisible();
    // The star is decorative; screen readers hear "stars".
    // (Chrome puts a space after the visually hidden " stars" text.)
    await expect(roleTab(page, "As a landlord")).toHaveAccessibleName(/^As a landlord \(5 stars ?, 1 review\)$/);
    await expect(roleTab(page, "As a renter")).toHaveAccessibleName(/^As a renter \(2 stars ?, 1 review\)$/);
    await expect(roleTab(page, "As a landlord").locator('[aria-hidden="true"]')).toHaveText("★");
    await expect(roleTab(page, "As a landlord")).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: `${subject.user.name}'s rating as a landlord` })).toBeVisible();
    await expect(summaryAverage(page)).toHaveText("5");
    await expect(summaryCount(page)).toHaveText("1 review");
    await expect(reviewCard(page, asLandlord.title)).toBeVisible();
    await expect(reviewCard(page, asRenter.title)).toHaveCount(0);
    await expect(page.getByText(`What renters say about ${subject.user.name}.`)).toBeVisible();
    // With two roles, the reviews heading says which one these are about.
    await expect(heading(page, "Reviews as a landlord (1)")).toBeVisible();
    await expect(heading(page, "Reviews (1)")).toHaveCount(0);
    // The landlord page lists their properties; the renter page doesn't.
    await expect(page.getByRole("heading", { name: "Properties (0)" })).toBeVisible();

    await roleTab(page, "As a renter").click();
    await expect(page).toHaveURL(renterPath);
    await expect(roleTab(page, "As a renter")).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: `${subject.user.name}'s rating as a renter` })).toBeVisible();
    await expect(summaryAverage(page)).toHaveText("2");
    await expect(summaryCount(page)).toHaveText("1 review");
    await expect(reviewCard(page, asRenter.title)).toBeVisible();
    await expect(reviewCard(page, asLandlord.title)).toHaveCount(0);
    await expect(page.getByText(`What landlords say about ${subject.user.name}.`)).toBeVisible();
    await expect(heading(page, "Reviews as a renter (1)")).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Properties \(/ })).toHaveCount(0);

    await roleTab(page, "As a landlord").click();
    await expect(page).toHaveURL(landlordPath);

    // Each reviewer sees their own review in the matching role's form only.
    await renter.page.goto(landlordPath);
    await expect(renter.page.getByRole("button", { name: "Update review" })).toBeVisible();
    await renter.page.goto(renterPath);
    await expect(renter.page.getByText("Only landlords can review renters.", { exact: false })).toBeVisible();

    // The directories show each role's own rating.
    await page.goto(`/landlords?q=${encodeURIComponent(subject.user.name)}`);
    await expect(page.getByRole("link", { name: new RegExp(escapeRegExp(subject.user.name)) })).toContainText("5 · 1 review");
    await page.goto(`/renters?q=${encodeURIComponent(subject.user.name)}`);
    await expect(page.getByRole("link", { name: new RegExp(escapeRegExp(subject.user.name)) })).toContainText("2 · 1 review");

    for (const actor of [subject, renter, landlord]) await actor.context.close();
  });

  test("someone with both roles can be reviewed by the same person once in each role", async ({ page, browser }) => {
    const subject = await createActor(browser, "both");
    const reviewer = makeUser("both");
    await signUp(page, reviewer);
    const first = makeReview(4);
    await postReview(page, subject.profilePath, first);
    const second = makeReview(1);
    await postReview(page, otherRolePath(subject.profilePath), second);

    // Writing again on the landlord page edits that review, not the renter one.
    await page.goto(subject.profilePath);
    await expect(page.getByRole("heading", { name: "Your review" })).toBeVisible();
    await expect(page.getByLabel("Headline")).toHaveValue(first.title);
    await page.getByLabel("Headline").fill(`${first.title} (edited)`);
    await page.getByRole("button", { name: "Update review" }).click();
    await expect(formStatus(page)).toHaveText("Your review was updated.");

    await page.goto("/dashboard");
    await expect(heading(page, "Reviews you've written (2)")).toBeVisible();
    await expect(reviewCard(page, `${first.title} (edited)`)).toBeVisible();
    await expect(reviewCard(page, second.title)).toBeVisible();
    await subject.context.close();
  });

  test("a URL for a role the person doesn't have goes to the role they do have", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const renter = await createActor(browser, "renter");
    expect(landlord.profilePath).toMatch(/^\/landlords\//);
    expect(renter.profilePath).toMatch(/^\/renters\//);

    await page.goto(otherRolePath(landlord.profilePath));
    await expect(page).toHaveURL(landlord.profilePath);
    await expect(page.getByRole("heading", { level: 1, name: landlord.user.name })).toBeVisible();
    // One role: no tabs.
    await expect(roleTabs(page)).toHaveCount(0);

    await page.goto(otherRolePath(renter.profilePath));
    await expect(page).toHaveURL(renter.profilePath);
    await expect(page.getByRole("heading", { level: 1, name: renter.user.name })).toBeVisible();
    await expect(roleTabs(page)).toHaveCount(0);
    await landlord.context.close();
    await renter.context.close();
  });

  test("the demo account Sam Whitfield is both, with a rating for each", async ({ page }) => {
    const landlordPath = await findPersonPath(page, "landlord", DEMO.landlords.sam.name);
    const renterPath = await findPersonPath(page, "renter", DEMO.landlords.sam.name);
    expect(renterPath).toBe(otherRolePath(landlordPath));
    // Listed as a renter too, rated by Priya.
    await expect(page.getByRole("link", { name: /Sam Whitfield/ })).toContainText("Also a landlord");

    await page.goto(landlordPath);
    await expect(page.getByRole("heading", { level: 1, name: DEMO.landlords.sam.name })).toBeVisible();
    await expect(roleTab(page, "As a landlord")).toHaveAccessibleName(
      /^As a landlord \(\d(\.\d)? stars ?, \d+ reviews?\)$/,
    );
    await expect(roleTab(page, "As a renter")).toHaveAccessibleName(/^As a renter \(5 stars ?, 1 review\)$/);
    await expect(reviewCard(page, "Laid-back and reasonable")).toBeVisible();
    await expect(reviewCard(page, "Easy winter tenant")).toHaveCount(0);

    await roleTab(page, "As a renter").click();
    await expect(page).toHaveURL(renterPath);
    const priya = reviewCard(page, "Easy winter tenant");
    await expect(priya).toBeVisible();
    await expect(priya.getByRole("link", { name: DEMO.landlords.priya.name })).toHaveAttribute(
      "href",
      new RegExp(`^/landlords/`),
    );
    await expect(priya.getByText("Landlord", { exact: true })).toBeVisible();
    await expect(reviewCard(page, "Laid-back and reasonable")).toHaveCount(0);

    // Sam's dashboard has a section for each role.
    await logIn(page, DEMO.landlords.sam.email, DEMO_PASSWORD);
    await expect(page.getByRole("heading", { name: /^Reviews about you as a landlord \(\d+\)$/ })).toBeVisible();
    await expect(heading(page, "Reviews about you as a renter (1)")).toBeVisible();
    await expect(reviewCard(page, "Easy winter tenant")).toBeVisible();
    // Reviewed in both roles, so neither can be removed.
    const roles = rolesCard(page);
    await expect(roles.getByRole("button", { name: /^Remove/ })).toHaveCount(0);
    await expect(roles.getByRole("listitem")).toHaveText([
      new RegExp(`^Landlord\\s*${escapeRegExp(KEPT_LANDLORD)}$`),
      new RegExp(`^Renter\\s*${escapeRegExp(KEPT_RENTER)}$`),
    ]);
  });
});

test.describe("dashboard: your roles", () => {
  test("a renter adds the landlord role, then removes it again", async ({ page }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    const roles = rolesCard(page);
    await expect(roles).toContainText("Not a landlord");
    await expect(roles.getByText("Renter", { exact: true })).toBeVisible();
    // With one role there's nothing to remove.
    await expect(roles.getByRole("button", { name: /^Remove/ })).toHaveCount(0);
    await expect(heading(page, "Reviews about you (0)")).toBeVisible();
    await expect(heading(page, "Your properties (0)")).toHaveCount(0);

    await roles.getByRole("button", { name: "I'm also a landlord" }).click();
    await expect(roles.getByRole("status")).toHaveText(ADDED_LANDLORD);
    await expect(roles.getByText("Landlord", { exact: true })).toBeVisible();
    await expect(roles.getByRole("button", { name: "Remove landlord role" })).toBeVisible();
    await expect(roles.getByRole("button", { name: "Remove renter role" })).toBeVisible();
    // The rest of the dashboard now covers both roles.
    await expect(heading(page, "Reviews about you as a landlord (0)")).toBeVisible();
    await expect(heading(page, "Reviews about you as a renter (0)")).toBeVisible();
    await expect(heading(page, "Your properties (0)")).toBeVisible();
    await expect(page.getByRole("region", { name: "Quick actions" }).getByRole("link", { name: "Review a renter" })).toBeVisible();
    // ...and so does the public profile.
    const landlordPath = await myProfilePath(page);
    expect(landlordPath).toMatch(/^\/landlords\//);
    await page.goto(landlordPath);
    await expect(roleTabs(page)).toBeVisible();

    // Cancelling the confirmation keeps the role.
    await page.goto("/dashboard");
    await clickAndCancel(page, roles.getByRole("button", { name: "Remove landlord role" }));
    await expect(roles.getByRole("status")).toHaveCount(0);
    await expect(roles.getByRole("button", { name: "Remove landlord role" })).toBeVisible();

    await clickAndConfirm(page, roles.getByRole("button", { name: "Remove landlord role" }));
    await expect(roles.getByRole("status")).toHaveText(REMOVED_LANDLORD);
    await expect(roles).toContainText("Not a landlord");
    await expect(roles.getByRole("button", { name: "I'm also a landlord" })).toBeVisible();
    await expect(heading(page, "Reviews about you (0)")).toBeVisible();
    await expect(heading(page, "Your properties (0)")).toHaveCount(0);
    // The landlord page now sends visitors to the renter page.
    await page.goto(landlordPath);
    await expect(page).toHaveURL(otherRolePath(landlordPath));
    await expect(roleTabs(page)).toHaveCount(0);
  });

  test("a role you've been reviewed in can't be removed; the other one can", async ({ page, browser }) => {
    const user = makeUser("both");
    await signUp(page, user);
    const renterPath = otherRolePath(await myProfilePath(page));
    // The dashboard is open (both Remove buttons showing) when a landlord
    // reviews them as a renter.
    await page.goto("/dashboard");
    const roles = rolesCard(page);
    await expect(roles.getByRole("button", { name: "Remove renter role" })).toBeVisible();
    const landlord = await createActor(browser, "landlord");
    await postReview(landlord.page, renterPath, makeReview(3));

    // Removing it from the stale page is refused by the server.
    await clickAndConfirm(page, roles.getByRole("button", { name: "Remove renter role" }));
    const alert = roles.getByRole("alert");
    await expect(alert).toHaveText("People have reviewed you as a renter, so you can't remove that role.");
    await expect(alert).toBeFocused();

    // A fresh page explains why instead of offering the button.
    await page.reload();
    await expect(heading(page, "Reviews about you as a renter (1)")).toBeVisible();
    await expect(roles.getByRole("button", { name: "Remove renter role" })).toHaveCount(0);
    await expect(roles.getByRole("listitem")).toHaveText([
      /^Landlord\s*Remove landlord role$/,
      new RegExp(`^Renter\\s*${escapeRegExp(KEPT_RENTER)}$`),
    ]);
    await expect(roles.getByText(KEPT_LANDLORD)).toHaveCount(0);

    // The landlord role (nobody reviewed them as one) can go.
    await clickAndConfirm(page, roles.getByRole("button", { name: "Remove landlord role" }));
    await expect(roles.getByRole("status")).toHaveText(REMOVED_LANDLORD);
    await expect(heading(page, "Reviews about you (1)")).toBeVisible();
    // Down to one role: nothing to remove, and no "stays" note (it's their only role).
    await expect(roles.getByRole("button", { name: /^Remove/ })).toHaveCount(0);
    await expect(roles.getByText(/so this role stays/)).toHaveCount(0);
    // The role they have is listed first, then the one they could add.
    await expect(roles.getByRole("listitem")).toHaveText([/^Renter$/, /^Not a landlord\s*I'm also a landlord$/]);
    await landlord.context.close();
  });

  test("someone reviewed as a landlord only sees the landlord role kept", async ({ page, browser }) => {
    const user = makeUser("both");
    await signUp(page, user);
    const landlordPath = await myProfilePath(page);
    const renter = await createActor(browser, "renter");
    await postReview(renter.page, landlordPath, makeReview(4));
    await page.goto("/dashboard");
    const roles = rolesCard(page);
    await expect(roles.getByRole("listitem")).toHaveText([
      new RegExp(`^Landlord\\s*${escapeRegExp(KEPT_LANDLORD)}$`),
      /^Renter\s*Remove renter role$/,
    ]);
    await renter.context.close();
  });

  test("removing the landlord role unlinks your properties", async ({ page }) => {
    const user = makeUser("both");
    await signUp(page, user);
    const property = makeProperty();
    const propertyPath = await addProperty(page, property, { relation: "own" });
    await expect(page.getByText(`Landlord: ${user.name}`)).toBeVisible();
    await page.goto("/dashboard");
    await expect(heading(page, "Your properties (1)")).toBeVisible();

    await clickAndConfirm(page, rolesCard(page).getByRole("button", { name: "Remove landlord role" }));
    await expect(rolesCard(page).getByRole("status")).toHaveText(REMOVED_LANDLORD);
    await page.goto(propertyPath);
    await expect(page.getByText("The landlord for this property isn't on GossipRent yet.")).toBeVisible();
    // Now just a renter, they may review the place.
    await expect(page.getByRole("heading", { name: `Review ${propertyLabel(property)}` })).toBeVisible();
  });

  test("a landlord adds the renter role from a landlord's page, then goes back and reviews them", async ({
    page,
    browser,
  }) => {
    const other = await createActor(browser, "landlord");
    const user = makeUser("landlord");
    await signUp(page, user);

    await page.goto(other.profilePath);
    await expect(page.getByText("Only renters can review landlords.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Post review" })).toHaveCount(0);
    const addRole = page.getByRole("link", { name: "add the renter role to your account" });
    await expect(addRole).toHaveAttribute("href", `/dashboard?next=${encodeURIComponent(other.profilePath)}#roles`);
    await addRole.click();
    await expect(page).toHaveURL(`/dashboard?next=${encodeURIComponent(other.profilePath)}#roles`);
    const roles = rolesCard(page);
    await expect(roles).toBeInViewport();
    await roles.getByRole("button", { name: "I'm also a renter" }).click();
    await expect(roles.getByRole("status")).toContainText(ADDED_RENTER);

    // The success message offers the way back to the review they were writing.
    const back = roles.getByRole("link", { name: "Back to write your review" });
    await expect(back).toHaveAttribute("href", other.profilePath);
    await back.click();
    await expect(page).toHaveURL(other.profilePath);
    await expect(page.getByRole("heading", { name: `Review ${other.user.name}` })).toBeVisible();

    const review = makeReview(5);
    await fillReview(page, review);
    await page.getByRole("button", { name: "Post review" }).click();
    await expect(formStatus(page)).toHaveText("Thanks! Your review is live.");
    await expect(reviewCard(page, review.title).getByText("Renter", { exact: true })).toBeVisible();
    await other.context.close();
  });

  test("the way back is only offered for a page on this site, and only after adding a role", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    const roles = rolesCard(page);
    // Another site, or no next at all: no link back.
    for (const next of ["https://evil.example/landlords", "//evil.example", ""]) {
      await page.goto(`/dashboard?next=${encodeURIComponent(next)}#roles`);
      await roles.getByRole("button", { name: "I'm also a landlord" }).click();
      await expect(roles.getByRole("status"), next).toHaveText(ADDED_LANDLORD);
      await expect(roles.getByRole("link", { name: "Back to write your review" }), next).toHaveCount(0);
      // Removing a role never offers it either.
      await clickAndConfirm(page, roles.getByRole("button", { name: "Remove landlord role" }));
      await expect(roles.getByRole("status"), next).toHaveText(REMOVED_LANDLORD);
      await expect(roles.getByRole("link", { name: "Back to write your review" }), next).toHaveCount(0);
    }
  });

  test("works without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const user = makeUser("renter");
    await page.goto("/signup");
    await page.getByRole("checkbox", { name: "I'm a renter" }).check();
    await page.getByLabel("Name", { exact: true }).fill(user.name);
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await rolesCard(page).getByRole("button", { name: "I'm also a landlord" }).click();
    await expect(rolesCard(page).getByRole("status")).toHaveText(ADDED_LANDLORD);
    await expect(heading(page, "Reviews about you as a landlord (0)")).toBeVisible();
    await context.close();
  });
});

test.describe("adding a property with both roles", () => {
  const CHOOSE = "Choose whether you own or rent this place.";

  test("someone with both roles says whether they own or rent it; nothing is preselected", async ({ page }) => {
    const user = makeUser("both");
    await signUp(page, user);
    await page.goto("/properties/new");
    const group = relationGroup(page);
    await expect(group.getByRole("radio")).toHaveCount(2);
    await expect(relationRadio(page, "own")).not.toBeChecked();
    await expect(relationRadio(page, "rent")).not.toBeChecked();
    // No landlord list until they say they rent it.
    await expect(landlordSelect(page)).toHaveCount(0);

    await relationRadio(page, "rent").check();
    const select = landlordSelect(page);
    await expect(select).toBeVisible();
    // Renting: they aren't listed under their own name.
    await expect(select.locator("option", { hasText: user.name })).toHaveCount(0);
    await relationRadio(page, "own").check();
    await expect(landlordSelect(page)).toHaveCount(0);
  });

  test("submitting without choosing shows an error on the choice and keeps what was typed", async ({ page }) => {
    await signUp(page, makeUser("both"));
    await page.goto("/properties/new");
    const property = makeProperty();
    await fillPropertyForm(page, property);
    await expect(page).toHaveURL(/\/properties\/new$/);
    await expect(page.getByText(CHOOSE)).toBeVisible();
    const group = relationGroup(page);
    await expect(group).toHaveAttribute("aria-invalid", "true");
    for (const relation of ["own", "rent"] as const) {
      await expect(relationRadio(page, relation)).toHaveAccessibleDescription(CHOOSE);
    }
    await expect(page.getByLabel("Street address")).toHaveValue(property.address);
    await expect(page.getByLabel("City", { exact: true })).toHaveValue(property.city);

    // Choosing fixes it.
    await relationRadio(page, "own").check();
    await page.getByRole("button", { name: "Add property" }).click();
    await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: propertyLabel(property) })).toBeVisible();
  });

  test("“Own or manage” lists it as theirs", async ({ page }) => {
    const user = makeUser("both");
    await signUp(page, user);
    const property = makeProperty();
    await addProperty(page, property, { relation: "own" });
    await expect(page.getByText(`Landlord: ${user.name}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Not my property" })).toBeVisible();
    // Their own: no review form.
    await expect(page.getByText("You're the landlord for this property.", { exact: false })).toBeVisible();

    // It's on their landlord profile and dashboard.
    const landlordPath = await myProfilePath(page);
    await page.goto(landlordPath);
    await expect(page.getByRole("heading", { name: "Properties (1)" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(escapeRegExp(propertyLabel(property))) })).toBeVisible();
    await page.goto("/dashboard");
    await expect(heading(page, "Your properties (1)")).toBeVisible();
    await expect(heading(page, "Places you added as a renter (0)")).toBeVisible();
  });

  test("“Rent or used to rent” adds the place they rent, linking its landlord", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const user = makeUser("both");
    await signUp(page, user);
    const property = makeProperty();
    await addProperty(page, property, { relation: "rent", landlord: landlord.user.name });
    await expect(page.getByText(`Landlord: ${landlord.user.name}`)).toBeVisible();
    // Not theirs, so they can review it.
    await expect(page.getByRole("heading", { name: `Review ${propertyLabel(property)}` })).toBeVisible();

    // Or without a landlord.
    const unlinked = makeProperty();
    await addProperty(page, unlinked, { relation: "rent" });
    await expect(page.getByText("The landlord for this property isn't on GossipRent yet.")).toBeVisible();

    await page.goto("/dashboard");
    await expect(heading(page, "Your properties (0)")).toBeVisible();
    await expect(heading(page, "Places you added as a renter (2)")).toBeVisible();
    await landlord.context.close();
  });

  test("after an error elsewhere, the choice and the landlord picked are kept", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("both"));
    await page.goto("/properties/new");
    await relationRadio(page, "rent").check();
    await pickLandlord(page, landlord.user.name);
    await page.getByRole("button", { name: "Add property" }).click();
    await expect(page.getByText("Enter the street address.")).toBeVisible();
    await expect(relationRadio(page, "rent")).toBeChecked();
    await expect(landlordSelect(page).locator("option:checked")).toContainText(landlord.user.name);
    await expect(page.getByText(CHOOSE)).toHaveCount(0);
    await landlord.context.close();
  });

  test("links from the dashboard preselect the choice", async ({ page }) => {
    await signUp(page, makeUser("both"));
    await expect(
      page.getByRole("region", { name: "Quick actions" }).getByRole("link", { name: "Add a property" }),
    ).toHaveAttribute("href", "/properties/new?as=landlord");
    const yours = page.locator("section").filter({ has: heading(page, "Your properties (0)") });
    await expect(yours.getByRole("link", { name: "Add a property" })).toHaveAttribute("href", "/properties/new?as=landlord");
    const rented = page.locator("section").filter({ has: heading(page, "Places you added as a renter (0)") });
    await expect(rented.getByRole("link", { name: "Add a property" })).toHaveAttribute("href", "/properties/new?as=renter");

    await rented.getByRole("link", { name: "Add a property" }).click();
    await expect(page).toHaveURL(/\/properties\/new\?as=renter$/);
    await expect(relationRadio(page, "rent")).toBeChecked();
    await expect(landlordSelect(page)).toBeVisible();

    await page.goto("/properties/new?as=landlord");
    await expect(relationRadio(page, "own")).toBeChecked();
    await expect(landlordSelect(page)).toHaveCount(0);

    // Anything else preselects nothing.
    await page.goto("/properties/new?as=both");
    await expect(relationRadio(page, "own")).not.toBeChecked();
    await expect(relationRadio(page, "rent")).not.toBeChecked();
  });

  test("without JavaScript, someone with both roles who rents the place can still link its landlord", async ({
    browser,
  }) => {
    const landlord = await createActor(browser, "landlord");
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await signUp(page, makeUser("both"));
    const property = makeProperty();
    await page.goto("/properties/new");
    await relationRadio(page, "rent").check();
    // The landlord list has to be reachable without the script that reveals it.
    await expect(landlordSelect(page)).toBeVisible();
    await fillPropertyForm(page, property, { relation: "rent", landlord: landlord.user.name });
    await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
    await expect(page.getByText(`Landlord: ${landlord.user.name}`)).toBeVisible();
    await context.close();
    await landlord.context.close();
  });

  test("renters and landlords aren't asked; landlords pick no landlord", async ({
    page,
    browser,
  }) => {
    const both = await createActor(browser, "both");
    await signUp(page, makeUser("renter"));
    await page.goto("/properties/new");
    await expect(relationGroup(page)).toHaveCount(0);
    const select = landlordSelect(page);
    await expect(select).toBeVisible();
    // Someone with both roles is offered as a landlord.
    await expect(select.locator("option", { hasText: both.user.name })).toHaveCount(1);

    const landlord = await createActor(browser, "landlord");
    await landlord.page.goto("/properties/new?as=renter");
    await expect(relationGroup(landlord.page)).toHaveCount(0);
    await expect(landlordSelect(landlord.page)).toHaveCount(0);
    await both.context.close();
    await landlord.context.close();
  });

  test("a renter who tampers with the landlord list gets an error, not a property", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    await page.goto("/properties/new");
    await landlordSelect(page).evaluate((select) => {
      const option = document.createElement("option");
      option.value = "not-an-id";
      option.textContent = "Not a landlord";
      select.appendChild(option);
      (select as HTMLSelectElement).value = "not-an-id";
    });
    const property = makeProperty();
    await fillPropertyForm(page, property);
    await expect(page.getByText("Choose a landlord from the list.")).toBeVisible();
    await expect(page).toHaveURL(/\/properties\/new$/);
  });
});

test.describe("claiming and reviewing with both roles", () => {
  test("someone with both roles who reviewed an unclaimed property isn't offered to claim it", async ({
    page,
    browser,
  }) => {
    const renter = await createActor(browser, "renter");
    const property = makeProperty();
    const path = await addProperty(renter.page, property);
    await signUp(page, makeUser("both"));

    // Before reviewing it, they could claim it.
    await page.goto(path);
    await expect(page.getByText("The landlord for this property isn't on GossipRent yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "I manage this property" })).toBeVisible();

    const review = makeReview(4);
    await fillReview(page, review);
    await page.getByRole("button", { name: "Post review" }).click();
    await expect(formStatus(page)).toHaveText("Thanks! Your review is live.");
    await page.reload();
    await expect(reviewCard(page, review.title)).toBeVisible();
    await expect(page.getByRole("button", { name: "I manage this property" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Not my property" })).toHaveCount(0);

    // Once they delete the review, the claim is back.
    await clickAndConfirm(page, reviewCard(page, review.title).getByRole("button", { name: "Delete" }));
    await expect(reviewCard(page, review.title)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "I manage this property" })).toBeVisible();
    await renter.context.close();
  });

  test("a claim from a page opened before reviewing is refused with an explanation", async ({ page, browser }) => {
    const renter = await createActor(browser, "renter");
    const path = await addProperty(renter.page, makeProperty());
    const user = makeUser("both");
    await signUp(page, user);
    // Two tabs: one shows the claim button, the other is used to review.
    await page.goto(path);
    const other = await page.context().newPage();
    await other.goto(path);
    const review = makeReview(3);
    await fillReview(other, review);
    await other.getByRole("button", { name: "Post review" }).click();
    await expect(formStatus(other)).toHaveText("Thanks! Your review is live.");

    await page.getByRole("button", { name: "I manage this property" }).click();
    await expect(formAlert(page)).toHaveText(
      "You've reviewed this property as a renter, so you can't also be its landlord. Delete your review first.",
    );
    await page.reload();
    await expect(page.getByText("The landlord for this property isn't on GossipRent yet.")).toBeVisible();
    await expect(reviewCard(page, review.title)).toBeVisible();
    await renter.context.close();
  });

  test("a review written in a role you've since removed: the panel explains how to edit it", async ({
    page,
    browser,
  }) => {
    const landlord = await createActor(browser, "landlord");
    const user = makeUser("both");
    await signUp(page, user);
    const review = makeReview(4);
    await postReview(page, landlord.profilePath, review);

    // Reviews you wrote don't stop you removing the role you wrote them in.
    await page.goto("/dashboard");
    await clickAndConfirm(page, rolesCard(page).getByRole("button", { name: "Remove renter role" }));
    await expect(rolesCard(page).getByRole("status")).toHaveText(REMOVED_RENTER);

    await page.goto(landlord.profilePath);
    // The review is still up, and the panel says how to get back to editing it.
    await expect(reviewCard(page, review.title)).toBeVisible();
    await expect(page.getByRole("button", { name: "Update review" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Post review" })).toHaveCount(0);
    const panel = page.locator("#your-review");
    await expect(panel).toHaveText(
      `You reviewed ${landlord.user.name} as a renter. To edit that review, add the renter role to your account again. You can still delete it from the reviews list.`,
    );
    const addRole = panel.getByRole("link", { name: "add the renter role to your account" });
    await expect(addRole).toHaveAttribute("href", `/dashboard?next=${encodeURIComponent(landlord.profilePath)}#roles`);

    // ...and it can still be deleted from the list.
    await expect(reviewCard(page, review.title).getByRole("button", { name: "Delete" })).toBeVisible();

    // Adding the role back leads straight back to the review, ready to edit.
    await addRole.click();
    await rolesCard(page).getByRole("button", { name: "I'm also a renter" }).click();
    await expect(rolesCard(page).getByRole("status")).toContainText(ADDED_RENTER);
    await rolesCard(page).getByRole("link", { name: "Back to write your review" }).click();
    await expect(page).toHaveURL(landlord.profilePath);
    await expect(page.getByRole("heading", { name: "Your review" })).toBeVisible();
    await expect(page.getByLabel("Headline")).toHaveValue(review.title);
    await landlord.context.close();
  });
});

test.describe("closing an account with both roles", () => {
  test("only the role someone was reviewed in stays on the closed profile", async ({ page, browser }) => {
    const user = makeUser("both");
    await signUp(page, user);
    const landlordPath = await myProfilePath(page);
    const renterPath = otherRolePath(landlordPath);
    const landlord = await createActor(browser, "landlord");
    const review = makeReview(2);
    await postReview(landlord.page, renterPath, review);

    await page.goto("/dashboard");
    await clickAndConfirm(page, page.getByRole("button", { name: "Close my account" }));
    await expect(page).toHaveURL(/\/\?account=deleted$/);

    // The renter page stays (closed), with the review; no role tabs.
    await page.goto(renterPath);
    await expect(page.getByRole("heading", { level: 1, name: user.name })).toBeVisible();
    await expect(page.getByText("Account closed", { exact: true })).toBeVisible();
    await expect(reviewCard(page, review.title)).toBeVisible();
    await expect(roleTabs(page)).toHaveCount(0);
    await expect(heading(page, "Reviews (1)")).toBeVisible();
    // The landlord page (nobody reviewed them as one) is gone: it leads to the renter page.
    await page.goto(landlordPath);
    await expect(page).toHaveURL(renterPath);

    // Listed only as a renter, marked closed.
    await page.goto(`/landlords?q=${encodeURIComponent(user.name)}`);
    await expect(page.getByRole("link", { name: new RegExp(escapeRegExp(user.name)) })).toHaveCount(0);
    await page.goto(`/renters?q=${encodeURIComponent(user.name)}`);
    const card = page.getByRole("link", { name: new RegExp(escapeRegExp(user.name)) });
    expect(await cardMeta(card)).toEqual(["Renter", "· Account closed"]);
    await landlord.context.close();
  });
});

test.describe("header navigation", () => {
  const PAGES_SIGNED_OUT = ["/", "/landlords", "/properties"];
  const PAGES_SIGNED_IN = ["/dashboard", "/renters", "/search?q=austin"];

  /** Scroll containers in the header that actually scroll (i.e. show a scrollbar). */
  async function headerScrollbars(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const problems: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("header, header *")) {
        const style = getComputedStyle(el);
        const scrolls = /(auto|scroll)/.test(style.overflowX + style.overflowY);
        if (scrolls && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) {
          problems.push(`${el.tagName.toLowerCase()}[${el.getAttribute("aria-label") ?? el.className}]`);
        }
      }
      const nav = document.querySelector<HTMLElement>('nav[aria-label="Main"]')!;
      for (const link of nav.querySelectorAll("a")) {
        const box = link.getBoundingClientRect();
        if (box.left < 0 || box.right > window.innerWidth) problems.push(`link off screen: ${link.textContent}`);
      }
      return problems;
    });
  }

  /** The main nav's content size against its box (more content than box = it overflows). */
  async function navOverflow(page: Page) {
    return page.getByRole("navigation", { name: "Main" }).evaluate((nav) => ({
      scrollWidth: nav.scrollWidth,
      clientWidth: nav.clientWidth,
      scrollHeight: nav.scrollHeight,
      clientHeight: nav.clientHeight,
    }));
  }

  /** Visit the pages signed out, then signed in, calling `check` on each. */
  async function onEachPage(page: Page, check: (path: string) => Promise<void>): Promise<void> {
    for (const path of PAGES_SIGNED_OUT) {
      await page.goto(path);
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
      await check(`${path} (signed out)`);
    }
    await signUp(page, makeUser("both"));
    for (const path of PAGES_SIGNED_IN) {
      await page.goto(path);
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
      await check(`${path} (signed in)`);
    }
  }

  for (const width of [1280, 390]) {
    test(`has no scrollbar at ${width}px wide, signed out and signed in`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await onEachPage(page, async (label) => {
        expect(await headerScrollbars(page), label).toEqual([]);
        // ...and the page itself doesn't scroll sideways.
        expect(await page.evaluate(() => document.scrollingElement!.scrollWidth), label).toBeLessThanOrEqual(width);
      });
    });

    // The scrollbar came from the nav's content being taller than the nav:
    // inline links' padded "pill" overflowed the list by a few pixels, so any
    // scroll container around it showed a scrollbar. The links are now
    // inline-block, so the nav is exactly as big as its content.
    test(`the nav's links fit inside the nav at ${width}px wide`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await onEachPage(page, async (label) => {
        const size = await navOverflow(page);
        expect(size.scrollHeight, `${label}: ${JSON.stringify(size)}`).toBeLessThanOrEqual(size.clientHeight);
        expect(size.scrollWidth, `${label}: ${JSON.stringify(size)}`).toBeLessThanOrEqual(size.clientWidth);
      });
    });
  }
});
