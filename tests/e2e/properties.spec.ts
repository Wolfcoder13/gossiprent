import { expect, test } from "@playwright/test";
import {
  addProperty,
  createActor,
  fillPropertyForm,
  formAlert,
  makeProperty,
  makeUser,
  propertyLabel,
  signUp,
  uid,
} from "./helpers";

test.describe("renter adds a property", () => {
  test("without a landlord", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    await page.goto("/properties/new");
    await expect(page.getByRole("heading", { level: 1, name: "Add a property" })).toBeVisible();
    await expect(page.getByText("Add the place you rent (or used to rent)", { exact: false })).toBeVisible();
    const landlordSelect = page.getByLabel("Landlord");
    await expect(landlordSelect).toHaveValue("");
    await expect(landlordSelect.locator("option").first()).toHaveText(
      "My landlord isn't on GossipRent / I'm not sure",
    );

    const property = makeProperty();
    const label = propertyLabel(property);
    await fillPropertyForm(page, property);
    await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
    const path = new URL(page.url()).pathname;

    await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
    await expect(page.getByText(`${property.city}, ${property.region} ${property.postalCode}`)).toBeVisible();
    await expect(page.getByText(property.description!)).toBeVisible();
    await expect(page.getByText("The landlord for this property isn't on GossipRent yet.")).toBeVisible();
    await expect(page.getByText("No reviews for this property yet")).toBeVisible();
    // The renter who added it can review it straight away.
    await expect(page.getByRole("heading", { name: `Review ${label}` })).toBeVisible();
    await expect(page.getByRole("button", { name: "Post review" })).toBeVisible();

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Properties you added (1)" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(label) })).toHaveAttribute("href", path);

    await page.goto(`/properties?q=${encodeURIComponent(property.address)}`);
    const card = page.getByRole("link", { name: new RegExp(label) });
    await expect(card).toContainText("Landlord not on GossipRent yet");
    await expect(card).toContainText("No reviews yet");
  });

  test("optional fields can be left blank", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    const property = makeProperty({ unit: undefined, postalCode: undefined, description: undefined });
    await addProperty(page, property);
    await expect(page.getByRole("heading", { level: 1, name: property.address })).toBeVisible();
    await expect(page.getByText(`${property.city}, ${property.region}`, { exact: true })).toBeVisible();
  });

  test("linked to their landlord, it appears on the landlord's profile and dashboard", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    const property = makeProperty();
    const label = propertyLabel(property);

    await page.goto("/properties/new");
    await expect(page.getByLabel("Landlord").locator("option", { hasText: landlord.user.name })).toHaveText(
      `${landlord.user.name} — ${landlord.user.city}`,
    );
    await fillPropertyForm(page, property, landlord.user.name);
    await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
    const path = new URL(page.url()).pathname;
    await expect(page.getByText(`Landlord: ${landlord.user.name}`)).toBeVisible();
    await expect(page.getByRole("link", { name: landlord.user.name })).toHaveAttribute("href", landlord.profilePath);

    await page.goto(landlord.profilePath);
    await expect(page.getByRole("heading", { name: "Properties (1)" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(label) })).toHaveAttribute("href", path);

    await landlord.page.goto("/dashboard");
    await expect(landlord.page.getByRole("heading", { name: "Your properties (1)", exact: true })).toBeVisible();
    await expect(landlord.page.getByRole("link", { name: new RegExp(label) })).toBeVisible();
    // The landlord can't review their own property.
    await landlord.page.goto(path);
    await expect(
      landlord.page.getByText("You're the landlord for this property. Reviews from your renters appear here."),
    ).toBeVisible();

    // Searching properties by the landlord's name finds it.
    await page.goto(`/properties?q=${encodeURIComponent(landlord.user.name)}`);
    await expect(page.getByText("1 property matching", { exact: false })).toBeVisible();
    await landlord.context.close();
  });

  test("an already-listed address is detected, ignoring case and spacing", async ({ page, browser }) => {
    await signUp(page, makeUser("renter"));
    const property = makeProperty();
    const existingPath = await addProperty(page, property);

    const duplicate = {
      ...property,
      address: `  ${property.address.toUpperCase()}  `,
      unit: property.unit!.toLowerCase(),
      city: property.city.toLowerCase(),
      region: property.region.toLowerCase(),
      description: "Somebody else's description",
    };
    await page.goto("/properties/new");
    await fillPropertyForm(page, duplicate);
    await expect(formAlert(page)).toHaveText(
      "This property is already listed on GossipRent. Go to the existing listing",
    );
    await expect(page).toHaveURL(/\/properties\/new$/);
    // What was typed is kept.
    await expect(page.getByLabel("Street address")).toHaveValue(duplicate.address);
    await expect(page.getByLabel("Short description")).toHaveValue(duplicate.description);

    await page.getByRole("link", { name: "Go to the existing listing" }).click();
    await expect(page).toHaveURL(existingPath);
    await expect(page.getByRole("heading", { level: 1, name: propertyLabel(property) })).toBeVisible();

    // Another user (a landlord) hits the same check.
    const landlord = await createActor(browser, "landlord");
    await landlord.page.goto("/properties/new");
    await fillPropertyForm(landlord.page, property);
    await expect(formAlert(landlord.page)).toContainText("This property is already listed on GossipRent.");
    await landlord.context.close();

    // A different unit at the same address is a different property.
    const otherUnit = await addProperty(page, { ...property, unit: "9Z" });
    expect(otherUnit).not.toBe(existingPath);
  });

  test("shows validation errors and keeps the typed values", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    await page.goto("/properties/new");
    await page.getByRole("button", { name: "Add property" }).click();
    await expect(formAlert(page)).toHaveText("Please fix the highlighted fields.");
    await expect(page.getByText("Enter the street address.")).toBeVisible();
    await expect(page.getByText("Enter the city.")).toBeVisible();
    await expect(page.getByText("Enter the state, province, or region.")).toBeVisible();

    await page.getByLabel("Street address").fill("12 Partial Rd");
    await page.getByLabel("Unit").fill("7");
    await page.getByLabel("Short description").fill("Half filled in");
    const select = page.getByLabel("Landlord");
    const landlordId = await select.locator("option", { hasText: landlord.user.name }).getAttribute("value");
    await select.selectOption(landlordId);
    await page.getByRole("button", { name: "Add property" }).click();

    await expect(page.getByText("Enter the city.")).toBeVisible();
    await expect(page.getByText("Enter the street address.")).toHaveCount(0);
    await expect(page.getByLabel("Street address")).toHaveValue("12 Partial Rd");
    await expect(page.getByLabel("Unit")).toHaveValue("7");
    await expect(page.getByLabel("Short description")).toHaveValue("Half filled in");
    await expect(select).toHaveValue(landlordId!);
    await landlord.context.close();
  });

  test("the server rejects linking a property to someone who isn't a landlord", async ({ page, browser }) => {
    const otherRenter = await createActor(browser, "renter");
    const otherRenterId = otherRenter.profilePath.split("/").pop()!;
    await signUp(page, makeUser("renter"));
    await page.goto("/properties/new");
    // Tamper with the landlord dropdown.
    await page.getByLabel("Landlord").evaluate((select, id) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = "Not a landlord";
      select.appendChild(option);
    }, otherRenterId);
    const property = makeProperty();
    await page.getByLabel("Street address").fill(property.address);
    await page.getByLabel("City", { exact: true }).fill(property.city);
    await page.getByLabel("State / region").fill(property.region);
    await page.getByLabel("Landlord").selectOption(otherRenterId);
    await page.getByRole("button", { name: "Add property" }).click();
    await expect(page.getByText("That landlord isn't on GossipRent anymore.")).toBeVisible();
    await expect(page).toHaveURL(/\/properties\/new$/);
    await otherRenter.context.close();
  });
});

test.describe("landlord adds a property", () => {
  test("it's listed as theirs on their profile, dashboard, and the directory", async ({ page }) => {
    const landlord = makeUser("landlord");
    await signUp(page, landlord);
    await page.goto("/properties/new");
    await expect(page.getByText("List a home or apartment you own or manage.", { exact: false })).toBeVisible();
    // Landlords always add properties as their own, so there's no landlord picker.
    await expect(page.getByLabel("Landlord")).toHaveCount(0);

    const property = makeProperty();
    const label = propertyLabel(property);
    await fillPropertyForm(page, property);
    await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
    const path = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
    await expect(page.getByText(`Landlord: ${landlord.name}`)).toBeVisible();
    await expect(
      page.getByText("You're the landlord for this property. Reviews from your renters appear here."),
    ).toBeVisible();

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Your properties (1)", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "View public profile" }).click();
    await expect(page.getByRole("heading", { level: 1, name: landlord.name })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Properties (1)" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(label) })).toHaveAttribute("href", path);

    await page.goto(`/landlords?q=${encodeURIComponent(landlord.name)}`);
    await expect(page.getByRole("link", { name: new RegExp(landlord.name) })).toContainText("1 property");

    await page.goto(`/properties?q=${encodeURIComponent(property.address)}`);
    await expect(page.getByRole("link", { name: new RegExp(label) })).toContainText(`Landlord: ${landlord.name}`);
  });
});

test.describe("directory pagination", () => {
  test("pages through results, keeping the search and sort", async ({ page }) => {
    test.slow();
    await signUp(page, makeUser("renter"));
    const token = `Pagetoken${uid()}`;
    const total = 13; // one more than a page (12)
    for (let i = 1; i <= total; i++) {
      await addProperty(page, {
        address: `${token} Ave`,
        unit: String(i).padStart(2, "0"),
        city: "Pageville",
        region: "PG",
      });
    }

    await page.goto(`/properties?q=${token}&sort=name`);
    await expect(page.getByText(`${total} properties matching “${token}”`)).toBeVisible();
    const cards = page.locator("main ul > li > a");
    await expect(cards).toHaveCount(12);
    await expect(cards.first()).toContainText(`${token} Ave, Unit 01`);
    const pagination = page.getByRole("navigation", { name: "Pagination" });
    await expect(pagination).toContainText("Page 1 of 2");

    await pagination.getByRole("link", { name: "Next →" }).click();
    await expect(page).toHaveURL(new RegExp(`/properties\\?q=${token}&sort=name&page=2$`));
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText(`${token} Ave, Unit 13`);
    await expect(pagination).toContainText("Page 2 of 2");
    await expect(pagination.getByRole("link", { name: "Next →" })).toHaveCount(0);

    await pagination.getByRole("link", { name: "← Previous" }).click();
    await expect(page).toHaveURL(new RegExp(`/properties\\?q=${token}&sort=name$`));
    await expect(cards).toHaveCount(12);

    // Site search shows the first six and links to the full list.
    await page.goto(`/search?q=${token}`);
    const group = page.getByRole("region", { name: "Properties" });
    await expect(group.getByRole("heading", { name: `Properties (${total})` })).toBeVisible();
    await expect(group.locator("ul > li")).toHaveCount(6);
    await group.getByRole("link", { name: `See all ${total} →` }).click();
    await expect(page).toHaveURL(new RegExp(`/properties\\?q=${token}$`));
    await expect(page.getByText(`${total} properties matching “${token}”`)).toBeVisible();
  });
});
