import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  addProperty,
  clickAndCancel,
  clickAndConfirm,
  createActor,
  DEMO,
  DEMO_PASSWORD,
  findPropertyPath,
  logIn,
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

    // Another user (a landlord) hits the same check. The listing has no
    // landlord yet, so they're pointed at it to claim it instead.
    const landlord = await createActor(browser, "landlord");
    await landlord.page.goto("/properties/new");
    await fillPropertyForm(landlord.page, property);
    await expect(formAlert(landlord.page)).toHaveText(
      "This property is already listed, without a landlord. If you manage it, you can claim it. Go to the listing to claim it",
    );
    await landlord.page.getByRole("link", { name: "Go to the listing to claim it" }).click();
    await expect(landlord.page).toHaveURL(existingPath);
    await expect(landlord.page.getByRole("button", { name: "I manage this property" })).toBeVisible();
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

const CLAIM = "I manage this property";
const UNLINK = "Not my property";
const NO_LANDLORD = "The landlord for this property isn't on GossipRent yet.";
const CLAIMED = "Done. You're now listed as this property's landlord.";
const UNLINKED = "Done. You're no longer listed as this property's landlord.";
const ALREADY_MANAGED = "Another landlord already manages this property.";

/** The result message of the claim/unlink form. */
function landlordActionStatus(page: Page): Locator {
  return page.getByRole("main").getByRole("status");
}

test.describe("claiming and unlinking a property", () => {

  test("a landlord claims a property a renter listed without a landlord", async ({ page, browser }) => {
    const renter = await createActor(browser, "renter");
    const property = makeProperty();
    const label = propertyLabel(property);
    const path = await addProperty(renter.page, property);
    const review = `Before the claim ${uid()}`;
    await renter.page.getByLabel("Headline").fill(review);
    await renter.page.locator("label").filter({ has: renter.page.getByRole("radio", { name: /^4 stars/ }) }).click();
    await renter.page.getByLabel("Your review", { exact: true }).fill("Nice flat, the landlord never answered though.");
    await renter.page.getByRole("button", { name: "Post review" }).click();
    await expect(renter.page.locator("article").filter({ hasText: review })).toBeVisible();

    const landlord = makeUser("landlord");
    await signUp(page, landlord);
    const landlordPath = (await page.getByRole("link", { name: "View public profile" }).getAttribute("href"))!;
    await page.goto(path);
    await expect(page.getByText(NO_LANDLORD)).toBeVisible();
    await expect(page.getByRole("button", { name: UNLINK })).toHaveCount(0);
    await page.getByRole("button", { name: CLAIM }).click();

    // The result is announced and gets keyboard focus, even though the button was swapped.
    await expect(landlordActionStatus(page)).toHaveText(CLAIMED);
    await expect(landlordActionStatus(page)).toBeFocused();
    await expect(page.getByText(`Landlord: ${landlord.name}`)).toBeVisible();
    await expect(page.getByRole("link", { name: landlord.name })).toHaveAttribute("href", landlordPath);
    await expect(page.getByRole("button", { name: CLAIM })).toHaveCount(0);
    await expect(page.getByRole("button", { name: UNLINK })).toBeVisible();
    // Now it's theirs, they can't review it, but its reviews stay.
    await expect(
      page.getByText("You're the landlord for this property. Reviews from your renters appear here."),
    ).toBeVisible();
    await expect(page.locator("article").filter({ hasText: review })).toBeVisible();

    // It shows on their profile, dashboard, and in the directory.
    await page.goto(landlordPath);
    await expect(page.getByRole("heading", { name: "Properties (1)" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(label) })).toHaveAttribute("href", path);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Your properties (1)", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reviews of your properties (1)" })).toBeVisible();
    await page.goto(`/properties?q=${encodeURIComponent(property.address)}`);
    await expect(page.getByRole("link", { name: new RegExp(label) })).toContainText(`Landlord: ${landlord.name}`);
    await page.goto(`/landlords?q=${encodeURIComponent(landlord.name)}`);
    await expect(page.getByRole("link", { name: new RegExp(landlord.name) })).toContainText("1 property");

    // The renter sees the new landlord.
    await renter.page.goto(path);
    await expect(renter.page.getByText(`Landlord: ${landlord.name}`)).toBeVisible();
    await renter.context.close();
  });

  test("once claimed, other landlords can't claim it or unlink it", async ({ page, browser }) => {
    const owner = await createActor(browser, "landlord");
    const renter = await createActor(browser, "renter");
    const path = await addProperty(renter.page, makeProperty());
    await owner.page.goto(path);
    await owner.page.getByRole("button", { name: CLAIM }).click();
    await expect(owner.page.getByText(`Landlord: ${owner.user.name}`)).toBeVisible();

    await signUp(page, makeUser("landlord"));
    await page.goto(path);
    await expect(page.getByText(`Landlord: ${owner.user.name}`)).toBeVisible();
    await expect(page.getByRole("button", { name: CLAIM })).toHaveCount(0);
    await expect(page.getByRole("button", { name: UNLINK })).toHaveCount(0);
    await owner.context.close();
    await renter.context.close();
  });

  test("two landlords claiming at the same time: the first one wins", async ({ browser }) => {
    const first = await createActor(browser, "landlord");
    const second = await createActor(browser, "landlord");
    const renter = await createActor(browser, "renter");
    const path = await addProperty(renter.page, makeProperty());
    await first.page.goto(path);
    await second.page.goto(path);
    // Both pages still show the claim button.
    await first.page.getByRole("button", { name: CLAIM }).click();
    await expect(first.page.getByText(`Landlord: ${first.user.name}`)).toBeVisible();
    await second.page.getByRole("button", { name: CLAIM }).click();
    const refused = second.page.getByRole("main").getByRole("alert");
    await expect(refused).toHaveText(ALREADY_MANAGED);
    await expect(refused).toBeFocused();
    await expect(second.page.getByText(`Landlord: ${first.user.name}`)).toBeVisible();
    await expect(second.page.getByRole("button", { name: CLAIM })).toHaveCount(0);
    await expect(second.page.getByRole("button", { name: UNLINK })).toHaveCount(0);
    for (const actor of [first, second, renter]) await actor.context.close();
  });

  test("the linked landlord can say “Not my property”, which removes the link", async ({ page, browser }) => {
    const renter = await createActor(browser, "renter");
    const landlord = makeUser("landlord");
    await signUp(page, landlord);
    const landlordPath = (await page.getByRole("link", { name: "View public profile" }).getAttribute("href"))!;

    // A renter links this landlord to a property by mistake.
    const property = makeProperty();
    const label = propertyLabel(property);
    await renter.page.goto("/properties/new");
    await fillPropertyForm(renter.page, property, landlord.name);
    await expect(renter.page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
    const path = new URL(renter.page.url()).pathname;

    await page.goto(path);
    await expect(page.getByText(`Landlord: ${landlord.name}`)).toBeVisible();
    const unlink = page.getByRole("button", { name: UNLINK });

    // Dismissing the confirmation changes nothing.
    await clickAndCancel(page, unlink);
    await expect(landlordActionStatus(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(`Landlord: ${landlord.name}`)).toBeVisible();

    let message = "";
    page.once("dialog", (dialog) => {
      message = dialog.message();
      void dialog.accept();
    });
    await page.getByRole("button", { name: UNLINK }).click();
    await expect(landlordActionStatus(page)).toHaveText(UNLINKED);
    await expect(landlordActionStatus(page)).toBeFocused();
    await expect(page.getByText(NO_LANDLORD)).toBeVisible();
    expect(message).toBe(
      "Remove yourself as the landlord of this property? The listing and its reviews stay on GossipRent.",
    );
    await expect(page.getByRole("button", { name: UNLINK })).toHaveCount(0);
    // They could claim it back if that was a mistake.
    await expect(page.getByRole("button", { name: CLAIM })).toBeVisible();
    // The listing stays, and now they can't be credited with it.
    await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();

    await page.goto(landlordPath);
    await expect(page.getByRole("heading", { name: "Properties (0)" })).toBeVisible();
    await expect(page.getByText("No properties listed yet")).toBeVisible();
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Your properties (0)", exact: true })).toBeVisible();
    await renter.page.goto(path);
    await expect(renter.page.getByText(NO_LANDLORD)).toBeVisible();
    await page.goto(`/properties?q=${encodeURIComponent(property.address)}`);
    await expect(page.getByRole("link", { name: new RegExp(label) })).toContainText("Landlord not on GossipRent yet");
    await renter.context.close();
  });

  test("a landlord can unlink a property they added themselves, and claim it back", async ({ page }) => {
    const landlord = makeUser("landlord");
    await signUp(page, landlord);
    const path = await addProperty(page, makeProperty());
    await clickAndConfirm(page, page.getByRole("button", { name: UNLINK }));
    await expect(landlordActionStatus(page)).toHaveText(UNLINKED);
    await expect(page.getByText(NO_LANDLORD)).toBeVisible();
    // Changed their mind: the message follows the latest action.
    await page.getByRole("button", { name: CLAIM }).click();
    await expect(landlordActionStatus(page)).toHaveText(CLAIMED);
    await expect(page.getByText(`Landlord: ${landlord.name}`)).toBeVisible();
    await clickAndConfirm(page, page.getByRole("button", { name: UNLINK }));
    await expect(landlordActionStatus(page)).toHaveText(UNLINKED);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Your properties (0)", exact: true })).toBeVisible();
    expect(path).toMatch(/^\/properties\//);
  });

  test("renters and signed-out visitors see neither button", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const linkedPath = await addProperty(landlord.page, makeProperty());
    await signUp(page, makeUser("renter"));
    const unlinkedPath = await addProperty(page, makeProperty());

    for (const path of [linkedPath, unlinkedPath]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: CLAIM }), path).toHaveCount(0);
      await expect(page.getByRole("button", { name: UNLINK }), path).toHaveCount(0);
    }
    // Demo data: a renter on a property with a landlord.
    const demoPath = await findPropertyPath(page, "78702", "1408 E 6th St, Unit 2B");
    await page.goto(demoPath);
    await expect(page.getByRole("button", { name: UNLINK })).toHaveCount(0);

    const anonymous = await browser.newContext();
    const anon = await anonymous.newPage();
    for (const path of [linkedPath, unlinkedPath]) {
      await anon.goto(path);
      await expect(anon.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(anon.getByRole("button", { name: CLAIM }), path).toHaveCount(0);
      await expect(anon.getByRole("button", { name: UNLINK }), path).toHaveCount(0);
    }
    await anonymous.close();
    await landlord.context.close();
  });

  test("a demo landlord sees “Not my property” only on their own listings", async ({ page }) => {
    const maria = await findPropertyPath(page, "78702", "1408 E 6th St, Unit 2B");
    const northgate = await findPropertyPath(page, "60640", "4521 N Clark St, Unit 3");
    await logIn(page, DEMO.landlords.maria.email, DEMO_PASSWORD);
    await page.goto(maria);
    await expect(page.getByRole("button", { name: UNLINK })).toBeVisible();
    await page.goto(northgate);
    await expect(page.getByText(`Landlord: ${DEMO.landlords.northgate.name}`)).toBeVisible();
    await expect(page.getByRole("button", { name: UNLINK })).toHaveCount(0);
    await expect(page.getByRole("button", { name: CLAIM })).toHaveCount(0);
  });
});

test.describe("claiming without JavaScript", () => {
  test("a landlord can claim and unlink a property with JavaScript turned off", async ({ page, browser }) => {
    const renter = await createActor(browser, "renter");
    const path = await addProperty(renter.page, makeProperty());
    const landlord = makeUser("landlord");
    await signUp(page, landlord);

    const noJs = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState() });
    const noJsPage = await noJs.newPage();
    await noJsPage.goto(path);
    await noJsPage.getByRole("button", { name: CLAIM }).click();
    await expect(noJsPage.getByText(`Landlord: ${landlord.name}`)).toBeVisible();
    await expect(noJsPage.getByRole("main").getByRole("status")).toHaveText(CLAIMED);

    await noJsPage.getByRole("button", { name: UNLINK }).click();
    await expect(noJsPage.getByText(NO_LANDLORD)).toBeVisible();
    await noJs.close();
    await renter.context.close();
  });
});

test.describe("the claim row on a narrow phone (320px wide)", () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });

  /** How far the page, or anything in `row`, sticks out past the row or the viewport (<= 0 is fine). */
  async function overflow(page: Page, row: Locator) {
    const inRow = await row.evaluate((el) => {
      const right = el.getBoundingClientRect().right;
      let worst = el.scrollWidth - el.clientWidth;
      for (const child of el.querySelectorAll("*")) {
        worst = Math.max(worst, child.getBoundingClientRect().right - right);
      }
      return worst;
    });
    const inPage = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
    return { inRow, inPage };
  }

  test("the claim button, the message, and the swapped button all fit", async ({ page, browser }) => {
    const renter = await createActor(browser, "renter");
    const path = await addProperty(renter.page, makeProperty());
    // A long, unbreakable landlord name is the worst case for the row.
    const landlord = makeUser("landlord", { name: `Sunbeltpropertymanagementgroupinternational${uid()}` });
    await signUp(page, landlord);
    await page.goto(path);

    const claim = page.getByRole("button", { name: CLAIM });
    await expect(claim).toBeVisible();
    // The row holding the landlord line and the claim form (the form itself is display: contents).
    const row = page.locator('input[name="propertyId"]').locator("xpath=ancestor::div[1]");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(NO_LANDLORD);
    let result = await overflow(page, row);
    expect(result.inRow, "before claiming: row").toBeLessThanOrEqual(0.5);
    expect(result.inPage, "before claiming: page").toBeLessThanOrEqual(0);

    await claim.click();
    await expect(landlordActionStatus(page)).toHaveText(CLAIMED);
    const unlink = page.getByRole("button", { name: UNLINK });
    await expect(unlink).toBeVisible();
    await expect(row).toContainText(`Landlord: ${landlord.name}`);
    await expect(row).toContainText(CLAIMED);
    result = await overflow(page, row);
    expect(result.inRow, "after claiming: row").toBeLessThanOrEqual(0.5);
    expect(result.inPage, "after claiming: page").toBeLessThanOrEqual(0);
    await expect(unlink).toBeInViewport({ ratio: 1 });
    await expect(landlordActionStatus(page)).toBeInViewport({ ratio: 1 });

    // A fresh page load (no message) too.
    await page.reload();
    await expect(page.getByRole("button", { name: UNLINK })).toBeVisible();
    await expect(row).not.toContainText(CLAIMED);
    result = await overflow(page, row);
    expect(result.inRow, "after reload: row").toBeLessThanOrEqual(0.5);
    expect(result.inPage, "after reload: page").toBeLessThanOrEqual(0);
    await renter.context.close();
  });
});
