import { expect, test } from "@playwright/test";
import {
  addProperty,
  clickAndCancel,
  clickAndConfirm,
  createActor,
  fillLogin,
  fillReview,
  formAlert,
  formStatus,
  makeProperty,
  makeUser,
  myProfilePath,
  reviewCard,
  signUp,
  uid,
} from "./helpers";

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

test.describe("account deletion", () => {
  test("cancelling the confirmation keeps the account", async ({ page }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    await clickAndCancel(page, page.getByRole("button", { name: "Delete my account" }));
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText(`Signed in as ${user.email}`)).toBeVisible();
  });

  test("a renter deleting their account removes their reviews and the reviews about them", async ({
    page,
    browser,
  }) => {
    const landlord = await createActor(browser, "landlord");
    const user = makeUser("renter");
    await signUp(page, user);
    const renterPath = await myProfilePath(page);

    // The renter adds a property and reviews the landlord; the landlord reviews the renter.
    const property = makeProperty();
    const propertyPath = await addProperty(page, property);
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

    // Delete the account.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Delete account" })).toBeVisible();
    await clickAndConfirm(page, page.getByRole("button", { name: "Delete my account" }));
    await expect(page).toHaveURL(/\/\?account=deleted$/);
    await expect(page.getByRole("main").getByRole("status")).toHaveText("Your account and reviews have been deleted.");
    await expect(page.getByRole("banner").getByRole("link", { name: "Log in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);

    // Signed out, and the account is gone.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await fillLogin(page, user.email, user.password);
    await expect(formAlert(page)).toHaveText("That email and password don't match an account.");
    expect((await page.goto(renterPath))?.status()).toBe(404);

    // Both reviews are gone.
    await landlord.page.goto(landlord.profilePath);
    await expect(reviewCard(landlord.page, byRenter)).toHaveCount(0);
    await expect(landlord.page.getByText(`No reviews for ${landlord.user.name} yet`)).toBeVisible();
    await landlord.page.goto("/dashboard");
    await expect(landlord.page.getByRole("heading", { name: "Reviews you've written (0)" })).toBeVisible();
    await expect(landlord.page.getByRole("heading", { name: "Reviews about you (0)" })).toBeVisible();

    // The property they added stays listed.
    await page.goto(propertyPath);
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(property.address) })).toBeVisible();

    // The email address can be used again.
    await signUp(page, { ...user, name: `Back Again ${uid()}` });
    await landlord.context.close();
  });

  test("a landlord deleting their account keeps their properties listed, without a landlord", async ({ page }) => {
    const landlord = makeUser("landlord");
    await signUp(page, landlord);
    const property = makeProperty();
    const propertyPath = await addProperty(page, property);
    await expect(page.getByText(`Landlord: ${landlord.name}`)).toBeVisible();

    await page.goto("/dashboard");
    await clickAndConfirm(page, page.getByRole("button", { name: "Delete my account" }));
    await expect(page).toHaveURL(/\/\?account=deleted$/);

    await page.goto(propertyPath);
    await expect(page.getByText("The landlord for this property isn't on GossipRent yet.")).toBeVisible();
    await page.goto(`/landlords?q=${encodeURIComponent(landlord.name)}`);
    await expect(page.getByText(`0 landlords matching “${landlord.name}”`)).toBeVisible();
  });
});
