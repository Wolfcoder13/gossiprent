import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import {
  addProperty,
  cardMeta,
  cardNames,
  cardSubtitle,
  checkLandlordButton,
  clickAndCancel,
  clickAndConfirm,
  confirmNewLandlordCheckbox,
  createActor,
  DEMO,
  escapeRegExp,
  fillLandlordFields,
  fillLogin,
  fillPropertyForm,
  findPersonPath,
  findPropertyPath,
  formAlert,
  formatKennitala,
  formStatus,
  freshKennitala,
  kennitalaVariants,
  landlordFoundAnswer,
  landlordKennitalaInput,
  landlordNameInput,
  landlordNotFoundAnswer,
  logInAs,
  logOut,
  makeProperty,
  makeReview,
  makeUser,
  myProfilePath,
  nameToken,
  NOT_A_KENNITALA,
  type NewProperty,
  postReview,
  propertyLabel,
  propertyPlace,
  relationGroup,
  relinkForm,
  reviewCard,
  setLanguage,
  signUp,
  uid,
} from "./helpers";

/*
 * Properties: adding one (an Icelandic address, the postcode list, the
 * landlord by kennitala with "Check"), duplicates, the property page (who the
 * landlord is, the report link), claiming, "Not my property", and the
 * creator's form for changing the landlord. Adding a property with both roles
 * (own or rent) is in roles.spec.ts.
 */

const CLAIM = "I manage this property";
const UNLINK = "Not my property";
const NO_LANDLORD = "No landlord linked";
const UNCONFIRMED = "Added by a renter, not confirmed";
const CLAIMED = "Done. You're now listed as this property's landlord.";
const UNLINKED = "Done. You're no longer listed as this property's landlord.";
const ALREADY_MANAGED = "Another landlord already manages this property.";
const UNLINK_CONFIRM =
  "Remove yourself as the landlord of this property? The listing and its reviews stay on GossipRent.";
const RELINKED = "Done. The property's landlord was changed.";
const RELINK_CLEARED = "Done. The property no longer has a landlord linked.";
const RELINK_HAS_ACCOUNT =
  "The landlord has a GossipRent account, so only they can remove the link (with “Not my property”). If it's wrong, report this page.";
const FIX_FIELDS = "Please fix the highlighted fields.";
const OWN_KENNITALA = "That's your own kennitala. You can't be the landlord of a place you rent.";
const MINOR = "This kennitala can't be linked as a landlord.";
const INVALID_KENNITALA = "That isn't a valid kennitala. Enter 10 digits, e.g. 123456-7890.";
const NAME_REQUIRED = "Nobody with this kennitala is on GossipRent yet. Enter the landlord's name.";
const CONFIRM_REQUIRED = "Tick the box to confirm the kennitala is right.";
const PERSON_NAME_CHARS = "Use only letters, spaces, hyphens, apostrophes and periods in a name.";
const COMPANY = "This is a company's kennitala.";
const OWNER_NOTE = "You're the landlord for this property. Reviews from your renters appear here.";
const NOT_FOUND = "We couldn't find that page";

/** "Landlord: <name>" on a property page. */
function landlordLine(page: Page, name: string): Locator {
  return page.getByRole("main").getByText(`Landlord: ${name}`, { exact: true });
}

function unconfirmedNote(page: Page): Locator {
  return page.getByRole("main").getByText(UNCONFIRMED, { exact: true });
}

function noLandlord(page: Page): Locator {
  return page.getByRole("main").getByText(NO_LANDLORD, { exact: true });
}

/** The link to the landlord's page in the landlord line. */
function landlordLink(page: Page, name: string): Locator {
  return landlordLine(page, name).getByRole("link", { name, exact: true });
}

/** The add-property form's postcode select. */
function postcodeSelect(page: Page): Locator {
  return page.getByRole("combobox", { name: "Postcode" });
}

/** Fill the add-property form's address fields (address, apartment, postcode, description) without submitting. */
async function fillAddress(page: Page, property: NewProperty): Promise<void> {
  await page.getByLabel("Address", { exact: true }).fill(property.address);
  await page.getByLabel("Apartment").fill(property.unit ?? "");
  await postcodeSelect(page).selectOption(property.postalCode);
  await page.getByLabel("Short description").fill(property.description ?? "");
}

/** Open the creator's "Change the landlord" / "Link the landlord" form. */
async function openRelinkForm(page: Page): Promise<Locator> {
  const form = relinkForm(page);
  await form.locator("summary").click();
  await expect(landlordKennitalaInput(form)).toBeVisible();
  return form;
}

function saveLandlordButton(scope: Page | Locator): Locator {
  return scope.getByRole("button", { name: "Save landlord", exact: true });
}

/** How the app shows a kennitala's birth date ("15 May 1980"): DDMMYY plus the century digit (9 = 1900s, 0 = 2000s). */
function birthDateOf(kennitala: string): string {
  const century = { "8": 1800, "9": 1900, "0": 2000 }[kennitala[9]]!;
  const date = new Date(
    Date.UTC(century + Number(kennitala.slice(4, 6)), Number(kennitala.slice(2, 4)) - 1, Number(kennitala.slice(0, 2)), 12),
  );
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

/** "October 2026", as "Listed …" shows the month a property was added. */
function thisMonth(): string {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "Atlantic/Reykjavik" }).format(
    new Date(),
  );
}

/** The kennitala appears nowhere in the page's HTML or its URL. */
async function expectNoKennitala(page: Page, kennitala: string): Promise<void> {
  const html = await page.content();
  for (const variant of kennitalaVariants(kennitala)) {
    expect(html, `${page.url()} contains ${variant}`).not.toContain(variant);
    expect(page.url()).not.toContain(variant);
  }
}

/** A name for a new landlord (letters only, as a person's name must be). */
function landlordName(): string {
  return `Leifur ${nameToken()}`;
}

test.describe("adding a property as a renter", () => {
  test("without a landlord: the page, the dashboard and the directory", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    await page.goto("/properties/new");
    await expect(page.getByRole("heading", { level: 1, name: "Add a property" })).toBeVisible();
    await expect(page).toHaveTitle("Add a property · GossipRent");
    await expect(page.getByText("Add the place you rent (or used to rent)", { exact: false })).toBeVisible();
    // Renters aren't asked whether they own it; they can name the landlord by kennitala.
    await expect(relationGroup(page)).toHaveCount(0);
    await expect(landlordKennitalaInput(page)).toHaveAccessibleName("Landlord's kennitala (optional)");
    await expect(landlordKennitalaInput(page)).toHaveValue("");
    await expect(checkLandlordButton(page)).toBeVisible();
    // The name and the confirmation only appear for a kennitala nobody has.
    await expect(landlordNameInput(page)).toHaveCount(0);
    await expect(confirmNewLandlordCheckbox(page)).toHaveCount(0);

    const property = makeProperty();
    const label = propertyLabel(property);
    await fillPropertyForm(page, property);
    await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
    const path = new URL(page.url()).pathname;
    const id = path.split("/").pop()!;

    await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
    await expect(page).toHaveTitle(`${label}, ${propertyPlace(property)} — reviews · GossipRent`);
    await expect(page.getByText(propertyPlace(property), { exact: true })).toBeVisible();
    await expect(page.getByText(`Listed ${thisMonth()}`, { exact: true })).toBeVisible();
    await expect(page.getByText(property.description!)).toBeVisible();
    await expect(noLandlord(page)).toBeVisible();
    await expect(unconfirmedNote(page)).toHaveCount(0);
    await expect(page.getByText("No reviews for this property yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Report this page" })).toHaveAttribute(
      "href",
      `/report?target=property&id=${id}`,
    );
    // The renter who added it can review it straight away.
    await expect(page.getByRole("heading", { name: `Review ${label}` })).toBeVisible();
    await expect(page.getByRole("button", { name: "Post review" })).toBeVisible();
    // ...and, having added it, can link its landlord later.
    await expect(relinkForm(page).locator("summary")).toHaveText("Link the landlord");

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Properties you added (1)" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(escapeRegExp(label)) })).toHaveAttribute("href", path);

    await page.goto(`/properties?q=${encodeURIComponent(property.address)}`);
    await expect(page.getByText(`1 property matching “${property.address}”`)).toBeVisible();
    const card = page.getByRole("main").getByRole("link", { name: new RegExp(escapeRegExp(label)) });
    await expect(card).toHaveAttribute("href", path);
    await expect(card).toContainText(propertyPlace(property));
    await expect(card).toContainText("Landlord not on GossipRent yet");
    await expect(card).toContainText("No reviews yet");
  });

  test("the postcode is picked from the list of Icelandic postcodes", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    await page.goto("/properties/new");
    const select = postcodeSelect(page);
    await expect(select).toHaveValue("");
    const options = select.locator("option");
    await expect(options.first()).toHaveText("Choose a postcode");
    await expect(options.first()).toHaveAttribute("value", "");
    await expect(options.nth(1)).toHaveText("101 Reykjavík");
    await expect(options.nth(1)).toHaveAttribute("value", "101");
    for (const [code, text] of [
      ["107", "107 Reykjavík"],
      ["200", "200 Kópavogur"],
      ["600", "600 Akureyri"],
      ["900", "900 Vestmannaeyjar"],
    ]) {
      await expect(select.locator(`option[value="${code}"]`), code).toHaveText(text);
    }
    // In numeric order, and only where people live (no PO-box codes such as 121).
    const codes = (await options.evaluateAll((list) => list.map((o) => (o as HTMLOptionElement).value))).slice(1);
    expect(codes.length).toBeGreaterThan(100);
    expect(codes.map(Number)).toEqual([...codes.map(Number)].sort((a, b) => a - b));
    expect(codes).not.toContain("121");

    // A postcode that isn't in the list is refused by the server.
    await select.evaluate((element) => {
      const option = document.createElement("option");
      option.value = "121";
      option.textContent = "121 Reykjavík (PO boxes)";
      element.appendChild(option);
    });
    const property = makeProperty({ postalCode: "121" });
    await fillPropertyForm(page, property);
    await expect(formAlert(page)).toHaveText(FIX_FIELDS);
    await expect(page.getByText("Choose a postcode from the list.")).toBeVisible();
    await expect(page).toHaveURL(/\/properties\/new$/);
    await expect(page.getByLabel("Address", { exact: true })).toHaveValue(property.address);
  });

  test("the address is tidied up, and the apartment shows as “apt.” when it's a number", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    const street = `Tjarnar${nameToken().toLowerCase()}gata`;

    // Extra spaces go, and a leading "íbúð" is dropped from the apartment.
    const path = await addProperty(page, { address: `  ${street}    7 `, unit: "íbúð 0304", postalCode: "105" });
    await expect(page.getByRole("heading", { level: 1, name: `${street} 7, apt. 0304`, exact: true })).toBeVisible();
    await expect(page.getByText("105 Reykjavík", { exact: true })).toBeVisible();

    // An apartment that isn't a 3–4 digit number is shown as typed.
    await addProperty(page, { address: `${street} 9`, unit: "2. hæð til vinstri", postalCode: "105" });
    await expect(
      page.getByRole("heading", { level: 1, name: `${street} 9, 2. hæð til vinstri`, exact: true }),
    ).toBeVisible();

    // "apt." is dropped too: it's the same apartment as before.
    await page.goto("/properties/new");
    await fillPropertyForm(page, { address: `${street} 7`, unit: "apt. 0304", postalCode: "105" });
    await expect(formAlert(page)).toHaveText("This property is already listed on GossipRent. Go to the existing listing");
    await expect(page.getByRole("link", { name: "Go to the existing listing" })).toHaveAttribute("href", path);
  });

  test("optional fields can be left blank", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    const property = makeProperty({ unit: undefined, description: undefined, postalCode: "600" });
    await addProperty(page, property);
    await expect(page.getByRole("heading", { level: 1, name: property.address, exact: true })).toBeVisible();
    await expect(page.getByText("600 Akureyri", { exact: true })).toBeVisible();
    await expect(noLandlord(page)).toBeVisible();
  });

  test("shows validation errors and keeps the typed values", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    await page.goto("/properties/new");
    await page.getByRole("button", { name: "Add property" }).click();
    await expect(formAlert(page)).toHaveText(FIX_FIELDS);
    await expect(page.getByText("Enter the street address.")).toBeVisible();
    await expect(page.getByText("Choose a postcode.", { exact: true })).toBeVisible();
    const address = page.getByLabel("Address", { exact: true });
    await expect(address).toHaveAttribute("aria-invalid", "true");
    await expect(address).toBeFocused();
    await expect(postcodeSelect(page)).toHaveAttribute("aria-invalid", "true");
    await expect(postcodeSelect(page)).toHaveAccessibleDescription("Choose a postcode.");

    const kennitala = freshKennitala();
    await address.fill("Hverfisgata 12");
    await page.getByLabel("Apartment").fill("0102");
    await page.getByLabel("Short description").fill("Half filled in");
    await landlordKennitalaInput(page).fill(kennitala);
    await page.getByRole("button", { name: "Add property" }).click();

    await expect(page.getByText("Choose a postcode.", { exact: true })).toBeVisible();
    await expect(page.getByText("Enter the street address.")).toHaveCount(0);
    await expect(postcodeSelect(page)).toBeFocused();
    await expect(address).toHaveValue("Hverfisgata 12");
    await expect(page.getByLabel("Apartment")).toHaveValue("0102");
    await expect(page.getByLabel("Short description")).toHaveValue("Half filled in");
    await expect(landlordKennitalaInput(page)).toHaveValue(kennitala);
    // Nothing was looked up: the kennitala wasn't checked while the form had errors.
    await expect(landlordNotFoundAnswer(page)).toHaveCount(0);
    await expect(landlordNameInput(page)).toHaveCount(0);
  });

  test("signed-out visitors are sent to log in first", async ({ page }) => {
    await page.goto("/properties/new");
    await expect(page).toHaveURL(/\/login\?next=%2Fproperties%2Fnew$/);
    await fillLogin(page, DEMO.people.kari.email, DEMO.password);
    await expect(page).toHaveURL(/\/properties\/new$/);
    await expect(page.getByRole("heading", { level: 1, name: "Add a property" })).toBeVisible();
  });
});

test.describe("the landlord's kennitala", () => {
  test("“Check” finds someone with an account; saving links them", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    await page.goto("/properties/new");
    const property = makeProperty();
    await fillAddress(page, property);
    await landlordKennitalaInput(page).fill(landlord.user.kennitala);
    await checkLandlordButton(page).click();

    const answer = landlordFoundAnswer(page, landlord.user.name);
    await expect(answer).toBeVisible();
    // Focus moves to the answer, so it's read out.
    await expect(answer.locator("..")).toBeFocused();
    // The number is echoed back formatted; nothing else changed or was saved.
    await expect(landlordKennitalaInput(page)).toHaveValue(formatKennitala(landlord.user.kennitala));
    await expect(page.getByLabel("Address", { exact: true })).toHaveValue(property.address);
    await expect(postcodeSelect(page)).toHaveValue(property.postalCode);
    await expect(landlordNameInput(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/properties\/new$/);
    await expect(formAlert(page)).toHaveCount(0);

    await page.getByRole("button", { name: "Add property" }).click();
    await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
    const path = new URL(page.url()).pathname;
    await expect(landlordLine(page, landlord.user.name)).toBeVisible();
    await expect(landlordLink(page, landlord.user.name)).toHaveAttribute("href", landlord.profilePath);
    // They have an account, so nothing says "not confirmed".
    await expect(unconfirmedNote(page)).toHaveCount(0);
    // A landlord with an account can't be changed by the renter who added it.
    await expect(relinkForm(page)).toHaveCount(0);
    await expectNoKennitala(page, landlord.user.kennitala);

    await page.goto(landlord.profilePath);
    await expect(page.getByRole("heading", { name: "Properties (1)" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(escapeRegExp(propertyLabel(property))) })).toHaveAttribute(
      "href",
      path,
    );
    await expectNoKennitala(page, landlord.user.kennitala);

    await landlord.page.goto("/dashboard");
    await expect(landlord.page.getByRole("heading", { name: "Your properties (1)", exact: true })).toBeVisible();
    // The landlord can't review their own property.
    await landlord.page.goto(path);
    await expect(landlord.page.getByText(OWNER_NOTE)).toBeVisible();
    await expect(landlord.page.getByRole("button", { name: UNLINK })).toBeVisible();
    await landlord.context.close();
  });

  test("a kennitala nobody has: “Check” says so, then a name and the confirmation create the landlord's page", async ({
    page,
  }) => {
    await signUp(page, makeUser("renter"));
    const kennitala = freshKennitala();
    const name = landlordName();
    const property = makeProperty();
    await page.goto("/properties/new");
    await fillAddress(page, property);
    await landlordKennitalaInput(page).fill(formatKennitala(kennitala));
    await checkLandlordButton(page).click();

    await expect(landlordNotFoundAnswer(page)).toBeVisible();
    await expect(landlordNotFoundAnswer(page).locator("..")).toBeFocused();
    // The birth date helps spot a typo.
    await expect(page.getByText(`Date of birth: ${birthDateOf(kennitala)}`, { exact: true })).toBeVisible();
    await expect(page.getByText(COMPANY)).toHaveCount(0);
    await expect(landlordNameInput(page)).toBeVisible();
    await expect(landlordNameInput(page)).toHaveValue("");
    await expect(confirmNewLandlordCheckbox(page)).not.toBeChecked();
    await expect(page).toHaveURL(/\/properties\/new$/);

    await landlordNameInput(page).fill(name);
    await confirmNewLandlordCheckbox(page).check();
    await page.getByRole("button", { name: "Add property" }).click();
    await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
    const path = new URL(page.url()).pathname;
    await expect(landlordLine(page, name)).toBeVisible();
    await expect(unconfirmedNote(page)).toBeVisible();
    // The creator can still change it while the landlord has no account.
    await expect(relinkForm(page).locator("summary")).toHaveText("Change the landlord");
    await expectNoKennitala(page, kennitala);

    // The landlord now has a page of their own (without an account).
    const landlordPath = await landlordLink(page, name).getAttribute("href");
    expect(landlordPath).toMatch(/^\/landlords\/[0-9a-f-]{36}$/);
    await landlordLink(page, name).click();
    await expect(page).toHaveURL(landlordPath!);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText("No account", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("This person doesn't have a GossipRent account.", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Properties (1)" })).toBeVisible();
    const card = page.getByRole("main").getByRole("link", { name: new RegExp(escapeRegExp(propertyLabel(property))) });
    await expect(card).toHaveAttribute("href", path);
    await expect(card).toContainText(`Landlord: ${name} (not confirmed)`);
    await expectNoKennitala(page, kennitala);

    // Listed in the landlord directory, marked as having no account.
    await page.goto(`/landlords?q=${encodeURIComponent(name)}`);
    const personCard = page.getByRole("main").getByRole("link", { name: new RegExp(escapeRegExp(name)) });
    await expect(personCard).toHaveAttribute("href", landlordPath!);
    expect(await cardMeta(personCard)).toEqual(["Landlord", "No account"]);
    expect(await cardSubtitle(personCard)).toBe("1 property");
  });

  test("a company's kennitala: no date of birth, and a company name", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    const kennitala = freshKennitala("company");
    const name = `Leigufélagið ${nameToken()} & synir 2 ehf.`;
    await page.goto("/properties/new");
    const property = makeProperty();
    await fillAddress(page, property);
    await landlordKennitalaInput(page).fill(kennitala);
    await checkLandlordButton(page).click();
    await expect(landlordNotFoundAnswer(page)).toBeVisible();
    await expect(page.getByText(COMPANY, { exact: true })).toBeVisible();
    await expect(page.getByText(/^Date of birth: /)).toHaveCount(0);

    // A company's name may have digits and "&".
    await landlordNameInput(page).fill(name);
    await confirmNewLandlordCheckbox(page).check();
    await page.getByRole("button", { name: "Add property" }).click();
    await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
    await expect(landlordLine(page, name)).toBeVisible();
    await expect(unconfirmedNote(page)).toBeVisible();

    await landlordLink(page, name).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText("This company doesn't have a GossipRent account.", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign up with your kennitala" })).toHaveCount(0);
  });

  test("saving a new kennitala without “Check” asks for the name, then the confirmation", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    const kennitala = freshKennitala();
    const property = makeProperty();
    await page.goto("/properties/new");
    await fillAddress(page, property);
    await landlordKennitalaInput(page).fill(kennitala);
    await page.getByRole("button", { name: "Add property" }).click();

    // Not saved: the answer appears with the name field, which has the error.
    await expect(formAlert(page)).toHaveText(FIX_FIELDS);
    await expect(page).toHaveURL(/\/properties\/new$/);
    await expect(landlordNotFoundAnswer(page)).toBeVisible();
    const nameInput = landlordNameInput(page);
    await expect(nameInput).toHaveAttribute("aria-invalid", "true");
    await expect(nameInput).toBeFocused();
    await expect(page.getByText(NAME_REQUIRED, { exact: true })).toBeVisible();
    await expect(page.getByLabel("Address", { exact: true })).toHaveValue(property.address);
    await expect(landlordKennitalaInput(page)).toHaveValue(kennitala);

    // A person's name: letters only.
    await nameInput.fill("Leifur 2000");
    await confirmNewLandlordCheckbox(page).check();
    await page.getByRole("button", { name: "Add property" }).click();
    await expect(page.getByText(PERSON_NAME_CHARS, { exact: true })).toBeVisible();
    await expect(landlordNameInput(page)).toHaveValue("Leifur 2000");
    await expect(confirmNewLandlordCheckbox(page)).toBeChecked();

    // The confirmation is required.
    const name = landlordName();
    await landlordNameInput(page).fill(name);
    await confirmNewLandlordCheckbox(page).uncheck();
    await page.getByRole("button", { name: "Add property" }).click();
    await expect(page.getByText(CONFIRM_REQUIRED, { exact: true })).toBeVisible();
    await expect(confirmNewLandlordCheckbox(page)).toHaveAttribute("aria-invalid", "true");
    await expect(confirmNewLandlordCheckbox(page)).toHaveAccessibleDescription(CONFIRM_REQUIRED);
    await expect(confirmNewLandlordCheckbox(page)).toBeFocused();
    await expect(landlordNameInput(page)).toHaveValue(name);

    await confirmNewLandlordCheckbox(page).check();
    await page.getByRole("button", { name: "Add property" }).click();
    await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
    await expect(landlordLine(page, name)).toBeVisible();
    await expect(unconfirmedNote(page)).toBeVisible();
  });

  test("your own kennitala, a child's, and a malformed number are refused", async ({ page }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    const property = makeProperty();
    const field = landlordKennitalaInput(page);

    const cases = [
      // However it's typed.
      { kennitala: user.kennitala, error: OWN_KENNITALA },
      { kennitala: `${user.kennitala.slice(0, 6)} ${user.kennitala.slice(6)}`, error: OWN_KENNITALA },
      // Neutral: it doesn't say why.
      { kennitala: freshKennitala("minor"), error: MINOR },
      { kennitala: NOT_A_KENNITALA, error: INVALID_KENNITALA },
      { kennitala: "12345", error: INVALID_KENNITALA },
    ];
    for (const { kennitala, error } of cases) {
      for (const button of ["Check", "Add property"]) {
        const label = `${button}: ${kennitala}`;
        await page.goto("/properties/new");
        await fillAddress(page, property);
        await field.fill(kennitala);
        await page.getByRole("button", { name: button, exact: true }).click();
        await expect(formAlert(page), label).toHaveText(FIX_FIELDS);
        await expect(field, label).toHaveAttribute("aria-invalid", "true");
        await expect(field, label).toHaveAccessibleDescription(new RegExp(`${escapeRegExp(error)}$`));
        await expect(page.getByText(error, { exact: true }), label).toBeVisible();
        // No answer, no name field, nothing saved.
        await expect(landlordFoundAnswer(page), label).toHaveCount(0);
        await expect(landlordNotFoundAnswer(page), label).toHaveCount(0);
        await expect(landlordNameInput(page), label).toHaveCount(0);
        await expect(page, label).toHaveURL(/\/properties\/new$/);
        await expect(page.getByLabel("Address", { exact: true }), label).toHaveValue(property.address);
      }
    }
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Properties you added (0)" })).toBeVisible();
  });

  test("a renter-only account linked by kennitala becomes a landlord too", async ({ page, browser }) => {
    const linked = await createActor(browser, "renter");
    expect(linked.profilePath).toMatch(/^\/renters\//);
    await signUp(page, makeUser("renter"));
    const property = makeProperty();
    const path = await addProperty(page, property, { kennitala: linked.user.kennitala });
    await expect(landlordLine(page, linked.user.name)).toBeVisible();
    await expect(unconfirmedNote(page)).toHaveCount(0);
    const landlordPath = linked.profilePath.replace("/renters/", "/landlords/");
    await expect(landlordLink(page, linked.user.name)).toHaveAttribute("href", landlordPath);

    // They now have both roles: a landlord page (with the property) and their renter page.
    await page.goto(landlordPath);
    await expect(page).toHaveURL(landlordPath);
    await expect(page.getByRole("heading", { name: "Properties (1)" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Ratings by role" })).toBeVisible();

    await linked.page.goto("/dashboard");
    await expect(linked.page.getByRole("heading", { name: "Reviews about you as a landlord (0)" })).toBeVisible();
    await expect(linked.page.getByRole("heading", { name: "Reviews about you as a renter (0)" })).toBeVisible();
    await expect(linked.page.getByRole("heading", { name: "Your properties (1)", exact: true })).toBeVisible();
    // It's theirs, so they can say it isn't.
    await linked.page.goto(path);
    await expect(linked.page.getByRole("button", { name: UNLINK })).toBeVisible();
    await expect(linked.page.getByText(OWNER_NOTE)).toBeVisible();
    await linked.context.close();
  });

  test("editing the kennitala hides the old answer, and Enter in a text field saves rather than checks", async ({
    page,
    browser,
  }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    await page.goto("/properties/new");
    const property = makeProperty();
    await fillAddress(page, property);
    await landlordKennitalaInput(page).fill(landlord.user.kennitala);
    await checkLandlordButton(page).click();
    await expect(landlordFoundAnswer(page, landlord.user.name)).toBeVisible();

    // The answer was about the old number.
    const kennitala = freshKennitala();
    await landlordKennitalaInput(page).fill(kennitala);
    await expect(landlordFoundAnswer(page)).toHaveCount(0);

    // Enter saves: a save with a new kennitala and no name asks for the name.
    await page.getByLabel("Address", { exact: true }).press("Enter");
    await expect(formAlert(page)).toHaveText(FIX_FIELDS);
    await expect(page.getByText(NAME_REQUIRED, { exact: true })).toBeVisible();
    const name = landlordName();
    await landlordNameInput(page).fill(name);
    await confirmNewLandlordCheckbox(page).check();
    await landlordNameInput(page).press("Enter");
    await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
    await expect(landlordLine(page, name)).toBeVisible();
    await landlord.context.close();
  });

  test("works without JavaScript: “Check”, then save", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    const context = await browser.newContext({
      javaScriptEnabled: false,
      storageState: await page.context().storageState(),
    });
    const noJs = await context.newPage();
    await noJs.goto("/properties/new");
    const property = makeProperty();
    await noJs.getByLabel("Address", { exact: true }).fill(property.address);
    await noJs.getByLabel("Apartment").fill(property.unit!);
    await postcodeSelect(noJs).selectOption(property.postalCode);
    await landlordKennitalaInput(noJs).fill(landlord.user.kennitala);
    await checkLandlordButton(noJs).click();
    await expect(landlordFoundAnswer(noJs, landlord.user.name)).toBeVisible();
    await expect(noJs.getByLabel("Address", { exact: true })).toHaveValue(property.address);
    await expect(postcodeSelect(noJs)).toHaveValue(property.postalCode);

    await noJs.getByRole("button", { name: "Add property" }).click();
    await expect(noJs).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
    await expect(noJs.getByRole("heading", { level: 1, name: propertyLabel(property) })).toBeVisible();
    await expect(landlordLine(noJs, landlord.user.name)).toBeVisible();

    // A new kennitala: the name and confirmation come back with the answer.
    const name = landlordName();
    await noJs.goto("/properties/new");
    const other = makeProperty();
    await noJs.getByLabel("Address", { exact: true }).fill(other.address);
    await postcodeSelect(noJs).selectOption(other.postalCode);
    await fillLandlordFields(noJs, { kennitala: freshKennitala(), name });
    await noJs.getByRole("button", { name: "Add property" }).click();
    await expect(noJs).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
    await expect(landlordLine(noJs, name)).toBeVisible();
    await expect(unconfirmedNote(noJs)).toBeVisible();
    await context.close();
    await landlord.context.close();
  });
});

test.describe("duplicates", () => {
  /** A number for the apartment that's unique enough within a run ("apt. 4821"). */
  function apartment(): string {
    return String(1000 + Math.floor(Math.random() * 9000));
  }

  test("an already-listed address is found, ignoring case, accents, spacing and “íbúð”", async ({ page, browser }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    const unit = apartment();
    const property: NewProperty = { address: "Álfheimar 3", unit, postalCode: "104", description: "Upprunaleg lýsing." };
    const existingPath = await addProperty(page, property);
    await expect(page.getByRole("heading", { level: 1, name: `Álfheimar 3, apt. ${unit}` })).toBeVisible();

    for (const duplicate of [
      { ...property, address: "  ÁLFHEIMAR   3 ", unit: `íbúð ${unit}`, description: "Somebody else's description" },
      { ...property, address: "alfheimar 3", unit: ` ${unit} ` },
    ]) {
      await page.goto("/properties/new");
      await fillPropertyForm(page, duplicate);
      await expect(formAlert(page), duplicate.address).toHaveText(
        "This property is already listed on GossipRent. Go to the existing listing",
      );
      await expect(page).toHaveURL(/\/properties\/new$/);
      // What was typed is kept.
      await expect(page.getByLabel("Address", { exact: true })).toHaveValue(duplicate.address);
      await expect(page.getByLabel("Apartment")).toHaveValue(duplicate.unit);
      await expect(postcodeSelect(page)).toHaveValue("104");
      await expect(page.getByLabel("Short description")).toHaveValue(duplicate.description ?? "");
    }
    await page.getByRole("link", { name: "Go to the existing listing" }).click();
    await expect(page).toHaveURL(existingPath);
    await expect(page.getByRole("heading", { level: 1, name: `Álfheimar 3, apt. ${unit}` })).toBeVisible();

    // A duplicate is reported before the landlord's kennitala is even looked at
    // (here their own, which would otherwise be refused).
    await page.goto("/properties/new");
    await landlordKennitalaInput(page).fill(user.kennitala);
    await fillPropertyForm(page, { ...property, address: "ÁLFHEIMAR 3" });
    await expect(formAlert(page)).toHaveText("This property is already listed on GossipRent. Go to the existing listing");
    await expect(page.getByText(OWN_KENNITALA)).toHaveCount(0);

    // A landlord hits the same check. The listing has no landlord yet, so
    // they're pointed at it to claim it instead.
    const landlord = await createActor(browser, "landlord");
    await landlord.page.goto("/properties/new");
    await fillPropertyForm(landlord.page, { ...property, address: "ÁLFHEIMAR 3" });
    await expect(formAlert(landlord.page)).toHaveText(
      "This property is already listed, without a landlord. If you manage it, you can claim it. Go to the listing to claim it",
    );
    await landlord.page.getByRole("link", { name: "Go to the listing to claim it" }).click();
    await expect(landlord.page).toHaveURL(existingPath);
    await landlord.page.getByRole("button", { name: CLAIM }).click();
    await expect(formStatus(landlord.page)).toHaveText(CLAIMED);

    // Once it has a landlord, another landlord is just told it's listed.
    const other = await createActor(browser, "landlord");
    await other.page.goto("/properties/new");
    await fillPropertyForm(other.page, { ...property, address: "álfheimar 3" });
    await expect(formAlert(other.page)).toHaveText(
      "This property is already listed on GossipRent. Go to the existing listing",
    );
    await landlord.context.close();
    await other.context.close();
  });

  test("the same street with another apartment or postcode is a different property", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    const property = makeProperty();
    const first = await addProperty(page, property);
    const otherUnit = await addProperty(page, { ...property, unit: "0302" });
    const noUnit = await addProperty(page, { ...property, unit: undefined });
    const otherPostcode = await addProperty(page, { ...property, postalCode: "107" });
    await expect(page.getByText("107 Reykjavík", { exact: true })).toBeVisible();
    expect(new Set([first, otherUnit, noUnit, otherPostcode]).size).toBe(4);

    await page.goto(`/properties?q=${encodeURIComponent(property.address)}&sort=name`);
    await expect(page.getByText(`4 properties matching “${property.address}”`)).toBeVisible();
    expect(await cardNames(page)).toEqual([
      property.address,
      propertyLabel(property),
      propertyLabel(property),
      propertyLabel({ ...property, unit: "0302" }),
    ]);
  });
});

test.describe("the property page", () => {
  test("who the landlord is: with an account, without one (not confirmed), or none", async ({ page }) => {
    const { njalsgata, hamraborg, strandgata } = DEMO.properties;
    const { sigrun, gunnar, leigufelag } = DEMO.people;
    const sigrunPath = await findPersonPath(page, "landlord", sigrun.name);

    await page.goto(await findPropertyPath(page, "Njálsgata", propertyLabel(njalsgata)));
    await expect(page.getByRole("heading", { level: 1, name: "Njálsgata 23, apt. 0201", exact: true })).toBeVisible();
    await expect(page.getByText("101 Reykjavík", { exact: true })).toBeVisible();
    await expect(page.getByText(njalsgata.description)).toBeVisible();
    await expect(landlordLine(page, sigrun.name)).toBeVisible();
    await expect(unconfirmedNote(page)).toHaveCount(0);
    await expect(landlordLink(page, sigrun.name)).toHaveAttribute("href", sigrunPath);

    // Renters named these landlords, who have no account.
    for (const [property, landlord] of [
      [hamraborg, gunnar],
      [strandgata, leigufelag],
    ] as const) {
      const path = await findPropertyPath(page, property.address, propertyLabel(property));
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: propertyLabel(property) })).toBeVisible();
      await expect(landlordLine(page, landlord.name)).toBeVisible();
      await expect(unconfirmedNote(page)).toBeVisible();
      await landlordLink(page, landlord.name).click();
      await expect(page.getByRole("heading", { level: 1, name: landlord.name })).toBeVisible();
      await expect(page.getByText("No account", { exact: true }).first()).toBeVisible();
    }

    // Nobody has claimed the property, and no renter named its landlord.
    const renter = makeUser("renter");
    await signUp(page, renter);
    await addProperty(page, makeProperty());
    await expect(noLandlord(page)).toBeVisible();
    await expect(page.getByRole("main").getByText(/^Landlord: /)).toHaveCount(0);
  });

  test("“Report this page” opens the report form about this property", async ({ page }) => {
    const { hamraborg } = DEMO.properties;
    const path = await findPropertyPath(page, hamraborg.address, propertyLabel(hamraborg));
    const id = path.split("/").pop()!;
    await page.goto(path);
    const report = page.getByRole("link", { name: "Report this page" });
    await expect(report).toHaveAttribute("href", `/report?target=property&id=${id}`);
    await report.click();
    await expect(page).toHaveURL(`/report?target=property&id=${id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Report a problem" })).toBeVisible();
    const subject = page.getByRole("region", { name: "What you're reporting" });
    await expect(subject).toContainText(propertyLabel(hamraborg));
    await expect(subject).toContainText(propertyPlace(hamraborg));
    await expect(subject.getByRole("link", { name: "View the page" })).toHaveAttribute("href", path);
  });
});

test.describe("claiming and unlinking a property", () => {
  test("a landlord claims a property a renter listed without a landlord", async ({ page, browser }) => {
    const renter = await createActor(browser, "renter");
    const property = makeProperty();
    const label = propertyLabel(property);
    const path = await addProperty(renter.page, property);
    const review = makeReview(4, { body: "Nice flat, but nobody answered about the broken radiator." });
    await postReview(renter.page, path, review);

    const landlord = makeUser("landlord");
    await signUp(page, landlord);
    const landlordPath = await myProfilePath(page);
    await page.goto(path);
    await expect(noLandlord(page)).toBeVisible();
    await expect(page.getByRole("button", { name: UNLINK })).toHaveCount(0);
    // Only the renter who added it gets the form to link a landlord.
    await expect(relinkForm(page)).toHaveCount(0);
    await page.getByRole("button", { name: CLAIM }).click();

    // The result is announced and gets keyboard focus, even though the button was swapped.
    await expect(formStatus(page)).toHaveText(CLAIMED);
    await expect(formStatus(page)).toBeFocused();
    await expect(landlordLine(page, landlord.name)).toBeVisible();
    await expect(landlordLink(page, landlord.name)).toHaveAttribute("href", landlordPath);
    await expect(unconfirmedNote(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: CLAIM })).toHaveCount(0);
    await expect(page.getByRole("button", { name: UNLINK })).toBeVisible();
    // Now it's theirs, they can't review it, but its reviews stay.
    await expect(page.getByText(OWNER_NOTE)).toBeVisible();
    await expect(reviewCard(page, review.title)).toBeVisible();

    // It shows on their profile, dashboard, and in the directories.
    await page.goto(landlordPath);
    await expect(page.getByRole("heading", { name: "Properties (1)" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(escapeRegExp(label)) })).toHaveAttribute("href", path);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Your properties (1)", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reviews of your properties (1)" })).toBeVisible();
    await expect(reviewCard(page, review.title)).toBeVisible();
    await page.goto(`/properties?q=${encodeURIComponent(property.address)}`);
    await expect(page.getByRole("main").getByRole("link", { name: new RegExp(escapeRegExp(label)) })).toContainText(
      `Landlord: ${landlord.name}`,
    );
    await page.goto(`/landlords?q=${encodeURIComponent(landlord.name)}`);
    const card = page.getByRole("main").getByRole("link", { name: new RegExp(escapeRegExp(landlord.name)) });
    expect(await cardSubtitle(card)).toBe(`${landlord.city} · 1 property`);

    // The renter sees the new landlord, and can no longer change it (it has an account).
    await renter.page.goto(path);
    await expect(landlordLine(renter.page, landlord.name)).toBeVisible();
    await expect(relinkForm(renter.page)).toHaveCount(0);
    await renter.context.close();
  });

  test("once claimed, other landlords can't claim it or unlink it", async ({ page, browser }) => {
    const owner = await createActor(browser, "landlord");
    const renter = await createActor(browser, "renter");
    const path = await addProperty(renter.page, makeProperty());
    await owner.page.goto(path);
    await owner.page.getByRole("button", { name: CLAIM }).click();
    await expect(landlordLine(owner.page, owner.user.name)).toBeVisible();

    await signUp(page, makeUser("landlord"));
    await page.goto(path);
    await expect(landlordLine(page, owner.user.name)).toBeVisible();
    await expect(page.getByRole("button", { name: CLAIM })).toHaveCount(0);
    await expect(page.getByRole("button", { name: UNLINK })).toHaveCount(0);
    await owner.context.close();
    await renter.context.close();
  });

  /** Two landlords on the same unclaimed property's page; the first claims it. */
  async function claimRace(browser: Browser) {
    const first = await createActor(browser, "landlord");
    const second = await createActor(browser, "landlord");
    const renter = await createActor(browser, "renter");
    const path = await addProperty(renter.page, makeProperty());
    await first.page.goto(path);
    await second.page.goto(path);
    // Both pages still show the claim button.
    await first.page.getByRole("button", { name: CLAIM }).click();
    await expect(landlordLine(first.page, first.user.name)).toBeVisible();
    await second.page.getByRole("button", { name: CLAIM }).click();
    const refused = formAlert(second.page);
    await expect(refused).toHaveText(ALREADY_MANAGED);
    await expect(refused).toBeFocused();
    return { first, second, renter };
  }

  test("a refused claim updates the page to show who manages it; the first claim wins", async ({ browser }) => {
    const { first, second, renter } = await claimRace(browser);
    await expect(landlordLine(second.page, first.user.name)).toBeVisible();
    await expect(second.page.getByRole("button", { name: CLAIM })).toHaveCount(0);
    await expect(second.page.getByRole("button", { name: UNLINK })).toHaveCount(0);
    // A fresh load agrees.
    await second.page.reload();
    await expect(landlordLine(second.page, first.user.name)).toBeVisible();
    await expect(second.page.getByRole("button", { name: CLAIM })).toHaveCount(0);
    await expect(second.page.getByRole("button", { name: UNLINK })).toHaveCount(0);
    for (const actor of [first, second, renter]) await actor.context.close();
  });

  test("the linked landlord can say “Not my property”; the listing and its reviews stay", async ({
    page,
    browser,
  }) => {
    const renter = await createActor(browser, "renter");
    const landlord = makeUser("landlord");
    await signUp(page, landlord);
    const landlordPath = await myProfilePath(page);

    // A renter links this landlord (by kennitala) to a property by mistake, and reviews the place.
    const property = makeProperty();
    const label = propertyLabel(property);
    const path = await addProperty(renter.page, property, { kennitala: landlord.kennitala });
    const review = makeReview(3);
    await postReview(renter.page, path, review);

    await page.goto(path);
    await expect(landlordLine(page, landlord.name)).toBeVisible();
    const unlink = page.getByRole("button", { name: UNLINK });

    // Dismissing the confirmation changes nothing.
    await clickAndCancel(page, unlink);
    await expect(formStatus(page)).toHaveCount(0);
    await page.reload();
    await expect(landlordLine(page, landlord.name)).toBeVisible();

    let message = "";
    page.once("dialog", (dialog) => {
      message = dialog.message();
      void dialog.accept();
    });
    await page.getByRole("button", { name: UNLINK }).click();
    await expect(formStatus(page)).toHaveText(UNLINKED);
    await expect(formStatus(page)).toBeFocused();
    await expect(noLandlord(page)).toBeVisible();
    expect(message).toBe(UNLINK_CONFIRM);
    await expect(page.getByRole("button", { name: UNLINK })).toHaveCount(0);
    // They could claim it back if that was a mistake.
    await expect(page.getByRole("button", { name: CLAIM })).toBeVisible();
    // The listing stays, with its review.
    await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
    await expect(reviewCard(page, review.title)).toBeVisible();

    await page.goto(landlordPath);
    await expect(page.getByRole("heading", { name: "Properties (0)" })).toBeVisible();
    await expect(page.getByText("No properties listed yet")).toBeVisible();
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Your properties (0)", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reviews of your properties (0)" })).toBeVisible();
    await renter.page.goto(path);
    await expect(noLandlord(renter.page)).toBeVisible();
    await expect(reviewCard(renter.page, review.title)).toBeVisible();
    await page.goto(`/properties?q=${encodeURIComponent(property.address)}`);
    await expect(page.getByRole("main").getByRole("link", { name: new RegExp(escapeRegExp(label)) })).toContainText(
      "Landlord not on GossipRent yet",
    );
    await renter.context.close();
  });

  test("a landlord can unlink a property they added themselves, and claim it back", async ({ page }) => {
    const landlord = makeUser("landlord");
    await signUp(page, landlord);
    await page.goto("/properties/new");
    await expect(page.getByText("List a home or apartment you own or manage.", { exact: false })).toBeVisible();
    // Landlords always add properties as their own: no landlord fields.
    await expect(landlordKennitalaInput(page)).toHaveCount(0);
    await expect(checkLandlordButton(page)).toHaveCount(0);
    await expect(relationGroup(page)).toHaveCount(0);
    const path = await addProperty(page, makeProperty());
    await expect(landlordLine(page, landlord.name)).toBeVisible();
    await expect(page.getByText(OWNER_NOTE)).toBeVisible();
    // Their own landlord link has an account: nothing to change.
    await expect(relinkForm(page)).toHaveCount(0);

    await clickAndConfirm(page, page.getByRole("button", { name: UNLINK }));
    await expect(formStatus(page)).toHaveText(UNLINKED);
    await expect(noLandlord(page)).toBeVisible();
    // Changed their mind: the message follows the latest action.
    await page.getByRole("button", { name: CLAIM }).click();
    await expect(formStatus(page)).toHaveText(CLAIMED);
    await expect(landlordLine(page, landlord.name)).toBeVisible();
    await clickAndConfirm(page, page.getByRole("button", { name: UNLINK }));
    await expect(formStatus(page)).toHaveText(UNLINKED);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Your properties (0)", exact: true })).toBeVisible();
    await page.goto(path);
    await expect(noLandlord(page)).toBeVisible();
  });

  test("renters and signed-out visitors see neither button", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const linkedPath = await addProperty(landlord.page, makeProperty());
    await signUp(page, makeUser("renter"));
    const unlinkedPath = await addProperty(page, makeProperty());
    const { hamraborg } = DEMO.properties;
    const demoPath = await findPropertyPath(page, hamraborg.address, propertyLabel(hamraborg));

    for (const path of [linkedPath, unlinkedPath, demoPath]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: CLAIM }), path).toHaveCount(0);
      await expect(page.getByRole("button", { name: UNLINK }), path).toHaveCount(0);
    }

    const anonymous = await browser.newContext();
    const anon = await anonymous.newPage();
    for (const path of [linkedPath, unlinkedPath, demoPath]) {
      await anon.goto(path);
      await expect(anon.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(anon.getByRole("button", { name: CLAIM }), path).toHaveCount(0);
      await expect(anon.getByRole("button", { name: UNLINK }), path).toHaveCount(0);
      await expect(relinkForm(anon), path).toHaveCount(0);
    }
    await anonymous.close();
    await landlord.context.close();
  });

  test("demo accounts: Sigrún sees “Not my property” only on her own listings", async ({ page }) => {
    const { njalsgata, hringbraut, hamraborg } = DEMO.properties;
    const njalsgataPath = await findPropertyPath(page, njalsgata.address, propertyLabel(njalsgata));
    const hringbrautPath = await findPropertyPath(page, hringbraut.address, propertyLabel(hringbraut));
    const hamraborgPath = await findPropertyPath(page, hamraborg.address, propertyLabel(hamraborg));
    await logInAs(page, "sigrun");
    for (const path of [njalsgataPath, hringbrautPath]) {
      await page.goto(path);
      await expect(landlordLine(page, DEMO.people.sigrun.name), path).toBeVisible();
      await expect(page.getByRole("button", { name: UNLINK }), path).toBeVisible();
      await expect(page.getByText(OWNER_NOTE), path).toBeVisible();
    }
    await page.goto(hamraborgPath);
    await expect(landlordLine(page, DEMO.people.gunnar.name)).toBeVisible();
    await expect(page.getByRole("button", { name: UNLINK })).toHaveCount(0);
    await expect(page.getByRole("button", { name: CLAIM })).toHaveCount(0);
    await expect(relinkForm(page)).toHaveCount(0);
  });

  test("demo accounts: only the renter who added a property may change its landlord, while it has no account", async ({
    page,
  }) => {
    const { hringbraut, hamraborg } = DEMO.properties;
    const hringbrautPath = await findPropertyPath(page, hringbraut.address, propertyLabel(hringbraut));
    const hamraborgPath = await findPropertyPath(page, hamraborg.address, propertyLabel(hamraborg));
    // Kári added Hamraborg 14 and named Gunnar, who has no account.
    await logInAs(page, "kari");
    await page.goto(hamraborgPath);
    await expect(relinkForm(page).locator("summary")).toHaveText("Change the landlord");
    await logOut(page);
    // Ólafur added Hringbraut 79, but its landlord (Sigrún) has an account.
    await logInAs(page, "olafur");
    await page.goto(hringbrautPath);
    await expect(landlordLine(page, DEMO.people.sigrun.name)).toBeVisible();
    await expect(relinkForm(page)).toHaveCount(0);
    // Other renters can't change Hamraborg's landlord.
    await page.goto(hamraborgPath);
    await expect(relinkForm(page)).toHaveCount(0);
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
    await expect(landlordLine(noJsPage, landlord.name)).toBeVisible();
    await expect(formStatus(noJsPage)).toHaveText(CLAIMED);

    // No confirmation without JavaScript.
    await noJsPage.getByRole("button", { name: UNLINK }).click();
    await expect(noLandlord(noJsPage)).toBeVisible();
    await expect(formStatus(noJsPage)).toHaveText(UNLINKED);
    await noJs.close();
    await renter.context.close();
  });
});

test.describe("changing the landlord (the renter who added the property)", () => {
  test("links, changes and removes a landlord without an account", async ({ page, browser }) => {
    await signUp(page, makeUser("renter"));
    const first = { kennitala: freshKennitala(), name: landlordName() };
    const path = await addProperty(page, makeProperty(), first);
    const firstPath = await landlordLink(page, first.name).getAttribute("href");

    // Closed until opened.
    const form = relinkForm(page);
    await expect(form.locator("summary")).toHaveText("Change the landlord");
    await expect(landlordKennitalaInput(form)).toBeHidden();
    await openRelinkForm(page);
    await expect(form).toContainText(
      "You added this property, so you can link its landlord by kennitala, or leave the field empty to remove the link.",
    );
    await expect(landlordKennitalaInput(form)).toHaveValue("");

    // Another kennitala nobody has: "Check", then the name and the confirmation.
    const second = { kennitala: freshKennitala(), name: landlordName() };
    await fillLandlordFields(form, second);
    await expect(form.getByText(`Date of birth: ${birthDateOf(second.kennitala)}`, { exact: true })).toBeVisible();
    await saveLandlordButton(form).click();
    await expect(formStatus(page)).toHaveText(RELINKED);
    await expect(formStatus(page)).toBeFocused();
    await expect(landlordLine(page, second.name)).toBeVisible();
    await expect(unconfirmedNote(page)).toBeVisible();
    // The form closes after saving.
    await expect(landlordKennitalaInput(form)).toBeHidden();
    await expectNoKennitala(page, second.kennitala);

    // The first landlord's page only existed because of this link: it's gone.
    const response = await page.goto(firstPath!);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: NOT_FOUND })).toBeVisible();
    await page.goto(`/landlords?q=${encodeURIComponent(first.name)}`);
    await expect(page.getByText(`No landlords match “${first.name}”`)).toBeVisible();

    // Leaving the field empty removes the link.
    await page.goto(path);
    const secondPath = await landlordLink(page, second.name).getAttribute("href");
    await openRelinkForm(page);
    await saveLandlordButton(relinkForm(page)).click();
    await expect(formStatus(page)).toHaveText(RELINK_CLEARED);
    await expect(noLandlord(page)).toBeVisible();
    await expect(relinkForm(page).locator("summary")).toHaveText("Link the landlord");
    expect((await page.goto(secondPath!))?.status()).toBe(404);

    // Linking someone with an account: then only they can change it.
    const landlord = await createActor(browser, "landlord");
    await page.goto(path);
    await fillLandlordFields(await openRelinkForm(page), { kennitala: landlord.user.kennitala });
    await expect(landlordFoundAnswer(relinkForm(page), landlord.user.name)).toBeVisible();
    await saveLandlordButton(relinkForm(page)).click();
    await expect(formStatus(page)).toHaveText(RELINKED);
    await expect(landlordLine(page, landlord.user.name)).toBeVisible();
    await expect(unconfirmedNote(page)).toHaveCount(0);
    await expect(relinkForm(page)).toHaveCount(0);
    await page.reload();
    await expect(relinkForm(page)).toHaveCount(0);
    await expect(formStatus(page)).toHaveCount(0);
    await landlord.page.goto(path);
    await expect(landlord.page.getByRole("button", { name: UNLINK })).toBeVisible();
    await landlord.context.close();
  });

  test("a landlord who has been reviewed keeps their page when the link changes", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    const landlord = { kennitala: freshKennitala(), name: landlordName() };
    const path = await addProperty(page, makeProperty(), landlord);
    const landlordPath = (await landlordLink(page, landlord.name).getAttribute("href"))!;
    const review = makeReview(2);
    await postReview(page, landlordPath, review, landlord.kennitala);

    await page.goto(path);
    await openRelinkForm(page);
    await saveLandlordButton(relinkForm(page)).click();
    await expect(formStatus(page)).toHaveText(RELINK_CLEARED);

    await page.goto(landlordPath);
    await expect(page.getByRole("heading", { level: 1, name: landlord.name })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Properties (0)" })).toBeVisible();
    await expect(reviewCard(page, review.title)).toBeVisible();
  });

  test("the relink form refuses your own kennitala and asks for a new landlord's name", async ({ page }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    const path = await addProperty(page, makeProperty());
    const form = relinkForm(page);
    for (const button of ["Check", "Save landlord"]) {
      await page.goto(path);
      await openRelinkForm(page);
      await landlordKennitalaInput(form).fill(user.kennitala);
      await form.getByRole("button", { name: button, exact: true }).click();
      await expect(form.getByRole("alert"), button).toHaveText(FIX_FIELDS);
      await expect(form.getByText(OWN_KENNITALA, { exact: true }), button).toBeVisible();
      // The form stays open with the error.
      await expect(landlordKennitalaInput(form), button).toBeVisible();
    }
    await landlordKennitalaInput(form).fill(freshKennitala());
    await saveLandlordButton(form).click();
    await expect(form.getByText(NAME_REQUIRED, { exact: true })).toBeVisible();
    await expect(landlordNameInput(form)).toBeFocused();
    await expect(noLandlord(page)).toBeVisible();
  });

  test("when the landlord signs up with that kennitala, the page is theirs and only they can change the link", async ({
    page,
    browser,
  }) => {
    const renter = await createActor(browser, "renter");
    const kennitala = freshKennitala();
    const name = landlordName();
    const property = makeProperty();
    const path = await addProperty(renter.page, property, { kennitala, name });
    // The renter has the "Change the landlord" form open (to remove the link).
    await openRelinkForm(renter.page);

    // The landlord signs up. Their page was named by the renter, so it keeps that name.
    const landlord = makeUser("landlord", { kennitala, name: `Other ${nameToken()}` });
    await signUp(page, landlord);
    await expect(page).toHaveURL(/\/dashboard\?name=kept$/);
    await expect(page.getByRole("heading", { level: 1, name: `Hi, ${name.split(" ")[0]}` })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your properties (1)", exact: true })).toBeVisible();
    await page.goto(path);
    await expect(landlordLine(page, name)).toBeVisible();
    await expect(unconfirmedNote(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: UNLINK })).toBeVisible();

    // The renter's open form is refused.
    await saveLandlordButton(relinkForm(renter.page)).click();
    await expect(formAlert(renter.page)).toHaveText(RELINK_HAS_ACCOUNT);
    await renter.page.reload();
    await expect(landlordLine(renter.page, name)).toBeVisible();
    await expect(unconfirmedNote(renter.page)).toHaveCount(0);
    await expect(relinkForm(renter.page)).toHaveCount(0);
    await renter.context.close();
  });

  test("works without JavaScript", async ({ page, browser }) => {
    await signUp(page, makeUser("renter"));
    const path = await addProperty(page, makeProperty());
    const context = await browser.newContext({
      javaScriptEnabled: false,
      storageState: await page.context().storageState(),
    });
    const noJs = await context.newPage();
    await noJs.goto(path);
    await relinkForm(noJs).locator("summary").click();
    const name = landlordName();
    await fillLandlordFields(relinkForm(noJs), { kennitala: freshKennitala(), name });
    await saveLandlordButton(relinkForm(noJs)).click();
    await expect(formStatus(noJs)).toHaveText(RELINKED);
    await expect(landlordLine(noJs, name)).toBeVisible();
    await expect(unconfirmedNote(noJs)).toBeVisible();
    await context.close();
  });
});

test.describe("directory pagination", () => {
  test("pages through results, keeping the search and sort", async ({ page }) => {
    test.slow();
    await signUp(page, makeUser("renter"));
    const street = `Blad${nameToken().toLowerCase()}gata`;
    const total = 13; // one more than a page (12)
    for (let i = 1; i <= total; i++) {
      await addProperty(page, { address: `${street} 5`, unit: `01${String(i).padStart(2, "0")}`, postalCode: "101" });
    }

    await page.goto(`/properties?q=${street}&sort=name`);
    await expect(page.getByText(`${total} properties matching “${street}”`)).toBeVisible();
    expect(await cardNames(page)).toEqual(
      Array.from({ length: 12 }, (_, i) => `${street} 5, apt. 01${String(i + 1).padStart(2, "0")}`),
    );
    const pagination = page.getByRole("navigation", { name: "Pagination" });
    await expect(pagination).toContainText("Page 1 of 2");

    await pagination.getByRole("link", { name: "Next →" }).click();
    await expect(page).toHaveURL(new RegExp(`/properties\\?q=${street}&sort=name&page=2$`));
    expect(await cardNames(page)).toEqual([`${street} 5, apt. 0113`]);
    await expect(pagination).toContainText("Page 2 of 2");
    await expect(pagination.getByRole("link", { name: "Next →" })).toHaveCount(0);

    await pagination.getByRole("link", { name: "← Previous" }).click();
    await expect(page).toHaveURL(new RegExp(`/properties\\?q=${street}&sort=name$`));
    await expect(page.locator("main ul > li > a")).toHaveCount(12);

    // The postcode and the town narrow a search too.
    await page.goto(`/properties?q=${street}+101`);
    await expect(page.getByText(`${total} properties matching “${street} 101”`)).toBeVisible();
    await page.goto(`/properties?q=${street}+reykjavik`);
    await expect(page.getByText(`${total} properties matching “${street} reykjavik”`)).toBeVisible();
    await page.goto(`/properties?q=${street}+akureyri`);
    await expect(page.getByText(`No properties match “${street} akureyri”`)).toBeVisible();

    // Site search shows the first six and links to the full list.
    await page.goto(`/search?q=${street}`);
    const group = page.getByRole("region", { name: "Properties" });
    await expect(group.getByRole("heading", { name: `Properties (${total})` })).toBeVisible();
    await expect(group.locator("ul > li")).toHaveCount(6);
    await group.getByRole("link", { name: `See all ${total} →` }).click();
    await expect(page).toHaveURL(new RegExp(`/properties\\?q=${street}$`));
    await expect(page.getByText(`${total} properties matching “${street}”`)).toBeVisible();
  });
});

test.describe("on a narrow phone (320px wide)", () => {
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
    const landlord = makeUser("landlord", { name: `Sunbeltpropertymanagementgroup${nameToken().toLowerCase()}` });
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
    await expect(formStatus(page)).toHaveText(CLAIMED);
    const unlink = page.getByRole("button", { name: UNLINK });
    await expect(unlink).toBeVisible();
    await expect(row).toContainText(`Landlord: ${landlord.name}`);
    await expect(row).toContainText(CLAIMED);
    result = await overflow(page, row);
    expect(result.inRow, "after claiming: row").toBeLessThanOrEqual(0.5);
    expect(result.inPage, "after claiming: page").toBeLessThanOrEqual(0);
    await expect(unlink).toBeInViewport({ ratio: 1 });
    await expect(formStatus(page)).toBeInViewport({ ratio: 1 });

    // A fresh page load (no message) too.
    await page.reload();
    await expect(page.getByRole("button", { name: UNLINK })).toBeVisible();
    await expect(row).not.toContainText(CLAIMED);
    result = await overflow(page, row);
    expect(result.inRow, "after reload: row").toBeLessThanOrEqual(0.5);
    expect(result.inPage, "after reload: page").toBeLessThanOrEqual(0);
    await renter.context.close();
  });

  test("the add-property form, its answers and the property page fit", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord", {
      name: `Sunbeltpropertymanagementgroup${nameToken().toLowerCase()}`,
    });
    await signUp(page, makeUser("renter"));
    await page.goto("/properties/new");
    const widthOverflow = () => page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
    expect(await widthOverflow(), "empty form").toBeLessThanOrEqual(0);
    await expect(postcodeSelect(page)).toBeInViewport();

    const property = makeProperty({ unit: `2. hæð til vinstri ${uid()}`.slice(0, 30) });
    await page.getByLabel("Address", { exact: true }).fill(property.address);
    await page.getByLabel("Apartment").fill(property.unit!);
    await postcodeSelect(page).selectOption(property.postalCode);
    await landlordKennitalaInput(page).fill(landlord.user.kennitala);
    await checkLandlordButton(page).click();
    await expect(landlordFoundAnswer(page, landlord.user.name)).toBeVisible();
    expect(await widthOverflow(), "found answer").toBeLessThanOrEqual(0);

    await landlordKennitalaInput(page).fill(freshKennitala());
    await checkLandlordButton(page).click();
    await expect(landlordNotFoundAnswer(page)).toBeVisible();
    await expect(landlordNameInput(page)).toBeVisible();
    expect(await widthOverflow(), "not-found answer").toBeLessThanOrEqual(0);

    await landlordKennitalaInput(page).fill(landlord.user.kennitala);
    await page.getByRole("button", { name: "Add property" }).click();
    await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
    await expect(landlordLine(page, landlord.user.name)).toBeVisible();
    expect(await widthOverflow(), "property page").toBeLessThanOrEqual(0);
    await landlord.context.close();
  });
});

test.describe("in Icelandic", () => {
  const IS = {
    landlordLine: (name: string) => `Leigusali: ${name}`,
    unconfirmed: "Tilgreint af leigjanda, ekki staðfest",
    noLandlord: "Enginn leigusali tengdur",
    claim: "Ég er leigusali hér",
    unlink: "Ekki mín eign",
    claimed: "Komið. Eignin er nú tengd við þig sem leigusala.",
    unlinked: "Komið. Eignin er ekki lengur tengd við þig.",
    unlinkConfirm:
      "Fjarlægja tenginguna við þig sem leigusala? Eignin og umsagnir um hana verða áfram á GossipRent.",
    report: "Tilkynna þessa síðu",
    fixFields: "Lagaðu merktu reitina.",
    ownKennitala: "Þetta er þín eigin kennitala. Þú getur ekki verið leigusali eignar sem þú leigir.",
    notFound: "Þessi kennitala er ekki enn á GossipRent. Sláðu inn nafn leigusalans til að bæta viðkomandi við.",
    alreadyListed: "Þessi eign er þegar á GossipRent. Fara á eignina",
  };

  function isLandlordLine(page: Page, name: string): Locator {
    return page.getByRole("main").getByText(IS.landlordLine(name), { exact: true });
  }

  /** A kennitala's birth date as the Icelandic site shows it ("15. maí 1980"). */
  function icelandicBirthDate(kennitala: string): string {
    const century = { "8": 1800, "9": 1900, "0": 2000 }[kennitala[9]]!;
    const date = new Date(
      Date.UTC(century + Number(kennitala.slice(4, 6)), Number(kennitala.slice(2, 4)) - 1, Number(kennitala.slice(0, 2)), 12),
    );
    return new Intl.DateTimeFormat("is-IS", { day: "numeric", month: "short", year: "numeric" }).format(date);
  }

  test("the property page: the address, who the landlord is, and the report link", async ({ page }) => {
    const { njalsgata, hamraborg } = DEMO.properties;
    // Found in English (the helper matches the English street line), then viewed in Icelandic.
    const njalsgataPath = await findPropertyPath(page, njalsgata.address, propertyLabel(njalsgata));
    const hamraborgPath = await findPropertyPath(page, hamraborg.address, propertyLabel(hamraborg));
    await setLanguage(page.context(), "is");

    await page.goto(njalsgataPath);
    await expect(page.locator("html")).toHaveAttribute("lang", "is");
    await expect(page).toHaveTitle("Njálsgata 23, íbúð 0201, 101 Reykjavík — umsagnir · GossipRent");
    await expect(page.getByRole("heading", { level: 1, name: "Njálsgata 23, íbúð 0201", exact: true })).toBeVisible();
    await expect(page.getByText("101 Reykjavík", { exact: true })).toBeVisible();
    await expect(isLandlordLine(page, DEMO.people.sigrun.name)).toBeVisible();
    await expect(page.getByText(IS.unconfirmed)).toHaveCount(0);
    await expect(page.getByRole("link", { name: IS.report })).toHaveAttribute(
      "href",
      `/report?target=property&id=${njalsgataPath.split("/").pop()}`,
    );

    await page.goto(hamraborgPath);
    await expect(page.getByRole("heading", { level: 1, name: "Hamraborg 14, íbúð 0503", exact: true })).toBeVisible();
    await expect(page.getByText("200 Kópavogur", { exact: true })).toBeVisible();
    await expect(isLandlordLine(page, DEMO.people.gunnar.name)).toBeVisible();
    await expect(page.getByText(IS.unconfirmed, { exact: true })).toBeVisible();
  });

  test("adding a property: the form, “Athuga”, a new landlord, and the refusals", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const user = makeUser("renter");
    await signUp(page, user);
    await setLanguage(page.context(), "is");
    await page.goto("/properties/new");
    await expect(page).toHaveTitle("Skrá eign · GossipRent");
    await expect(page.getByRole("heading", { level: 1, name: "Skrá eign" })).toBeVisible();
    const address = page.getByRole("textbox", { name: "Heimilisfang", exact: true });
    const unit = page.getByRole("textbox", { name: "Íbúð (valfrjálst)" });
    const postcode = page.getByRole("combobox", { name: "Póstnúmer" });
    const kennitalaField = page.getByRole("textbox", { name: "Kennitala leigusala (valfrjálst)" });
    const check = page.getByRole("button", { name: "Athuga", exact: true });
    const submit = page.getByRole("button", { name: "Skrá eign", exact: true });
    await expect(postcode.locator("option").first()).toHaveText("Veldu póstnúmer");
    await expect(postcode.locator('option[value="600"]')).toHaveText("600 Akureyri");

    await submit.click();
    await expect(formAlert(page)).toHaveText(IS.fixFields);
    await expect(page.getByText("Sláðu inn heimilisfang.", { exact: true })).toBeVisible();
    await expect(page.getByText("Veldu póstnúmer.", { exact: true })).toBeVisible();

    const property = makeProperty();
    await address.fill(property.address);
    await unit.fill(`íbúð ${property.unit}`);
    await postcode.selectOption(property.postalCode);

    // Your own kennitala.
    await kennitalaField.fill(user.kennitala);
    await check.click();
    await expect(page.getByText(IS.ownKennitala, { exact: true })).toBeVisible();

    // Someone with an account.
    await page.goto("/properties/new");
    await address.fill(property.address);
    await unit.fill(`íbúð ${property.unit}`);
    await postcode.selectOption(property.postalCode);
    await kennitalaField.fill(landlord.user.kennitala);
    await check.click();
    await expect(page.getByText(`Þessi kennitala tilheyrir: ${landlord.user.name}`, { exact: true })).toBeVisible();

    // A kennitala nobody has: the name and the confirmation.
    const kennitala = freshKennitala();
    await kennitalaField.fill(kennitala);
    await check.click();
    await expect(page.getByText(IS.notFound, { exact: true })).toBeVisible();
    await expect(page.getByText(`Fæðingardagur: ${icelandicBirthDate(kennitala)}`, { exact: true })).toBeVisible();
    const name = landlordName();
    await page.getByRole("textbox", { name: "Nafn leigusala" }).fill(name);
    await page.getByRole("checkbox", { name: "Ég hef gengið úr skugga um að kennitalan sé rétt" }).check();
    await submit.click();
    await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
    const path = new URL(page.url()).pathname;
    await expect(
      page.getByRole("heading", { level: 1, name: `${property.address}, íbúð ${property.unit}`, exact: true }),
    ).toBeVisible();
    await expect(isLandlordLine(page, name)).toBeVisible();
    await expect(page.getByText(IS.unconfirmed, { exact: true })).toBeVisible();
    // The renter who added it can change it: "Breyta leigusala".
    await expect(page.locator("details summary")).toHaveText("Breyta leigusala");

    // The same place again.
    await page.goto("/properties/new");
    await address.fill(property.address.toUpperCase());
    await unit.fill(property.unit!);
    await postcode.selectOption(property.postalCode);
    await submit.click();
    await expect(formAlert(page)).toHaveText(IS.alreadyListed);
    await expect(page.getByRole("link", { name: "Fara á eignina" })).toHaveAttribute("href", path);
    await landlord.context.close();
  });

  test("claiming a property and “Ekki mín eign”", async ({ page, browser }) => {
    const renter = await createActor(browser, "renter");
    const path = await addProperty(renter.page, makeProperty());
    const landlord = makeUser("landlord");
    await signUp(page, landlord);
    await setLanguage(page.context(), "is");
    await page.goto(path);
    await expect(page.getByRole("main").getByText(IS.noLandlord, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: IS.claim }).click();
    await expect(formStatus(page)).toHaveText(IS.claimed);
    await expect(isLandlordLine(page, landlord.name)).toBeVisible();
    await expect(page.getByText(IS.unconfirmed)).toHaveCount(0);
    await expect(
      page.getByText("Þú ert leigusali þessarar eignar. Umsagnir leigjenda þinna birtast hér.", { exact: true }),
    ).toBeVisible();

    let message = "";
    page.once("dialog", (dialog) => {
      message = dialog.message();
      void dialog.accept();
    });
    await page.getByRole("button", { name: IS.unlink }).click();
    await expect(formStatus(page)).toHaveText(IS.unlinked);
    expect(message).toBe(IS.unlinkConfirm);
    await expect(page.getByRole("main").getByText(IS.noLandlord, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: IS.claim })).toBeVisible();
    await renter.context.close();
  });
});
