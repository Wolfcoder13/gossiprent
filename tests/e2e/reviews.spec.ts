import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import {
  addProperty,
  clickAndCancel,
  clickAndConfirm,
  createActor,
  DEMO,
  DEMO_PASSWORD,
  demoProfilePath,
  escapeRegExp,
  fillLogin,
  fillReview,
  formAlert,
  formatKennitala,
  formStatus,
  freshKennitala,
  kennitalaVariants,
  logInAs,
  logOut,
  makeProperty,
  makeReview,
  makeUser,
  myProfilePath,
  nameToken,
  NOT_A_KENNITALA,
  otherRolePath,
  pickStars,
  postReview,
  propertyAddressText,
  propertyLabel,
  reviewBodyInput,
  reviewCard,
  reviewKennitalaInput,
  reviewTitleInput,
  setLanguage,
  signUp,
  starRadio,
  startReviewByKennitala,
  summaryAverage,
  summaryCount,
  uid,
  wizardSubjectHeading,
  writeReviewByKennitala,
  type Review,
} from "./helpers";

// ---------------------------------------------------------------------------
// UI text (src/i18n/messages/en)
// ---------------------------------------------------------------------------

const LIVE = "Thanks! Your review is live.";
const UPDATED = "Your review was updated.";
const FIX = "Please fix the highlighted fields.";
const GUIDELINES =
  "Write about your own experience. Don't mention debts or money owed, health, criminal accusations or family details, and don't include anyone's kennitala, phone number or address.";
const KENNITALA_HINT = "Their Icelandic ID number: 10 digits, e.g. 123456-7890. It's never shown on GossipRent.";
const MISMATCH =
  "That kennitala doesn't match this profile. Several people can share a name, so check you're on the right page.";
const OWN_KENNITALA = "That's your own kennitala.";
const MINOR = "We can't accept a review for this kennitala.";
const INVALID_KENNITALA = "That isn't a valid kennitala. Enter 10 digits, e.g. 123456-7890.";
const KENNITALA_REQUIRED = "Enter a kennitala.";
const NO_KENNITALA_IN_TEXT = "Don't include a kennitala here. ID numbers are never shown on GossipRent.";
const NOT_FOUND = "Nobody with this kennitala is on GossipRent yet. Your review will create a page for them.";
const CONFIRM = "I've checked that this kennitala is right";
const CONFIRM_REQUIRED = "Tick the box to confirm the kennitala is right.";
const NAME_TOO_SHORT = "Name must be at least 2 characters.";
const NAME_CHARS = "Use only letters, spaces, hyphens, apostrophes and periods in a name.";
const NAME_HINT = "Shown on their page. Use the name they usually go by.";
const NO_ACCOUNT_NOTE =
  "This person doesn't have a GossipRent account. The page was created when the first review was written, and the name is the one its author entered. Is this you? Sign up with your kennitala to take over the page. Reviews others wrote about you stay on it.";
const COMPANY_NOTE =
  "This company doesn't have a GossipRent account. The page was created when the first review was written, and the name is the one its author entered.";
const CANT_REMOVE = "You can't remove reviews other people write about you, but you can report one that breaks the rules.";
const NOT_FOUND_PAGE = "We couldn't find that page";

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function reviewsHeading(page: Page, count: number, label = "Reviews"): Locator {
  return page.getByRole("heading", { name: `${label} (${count})`, exact: true });
}

/** The "write a review" box next to a profile or property (#your-review). */
function reviewPanel(page: Page): Locator {
  return page.locator("#your-review");
}

function postButton(page: Page): Locator {
  return page.getByRole("button", { name: "Post review", exact: true });
}

function updateButton(page: Page): Locator {
  return page.getByRole("button", { name: "Update review", exact: true });
}

function continueButton(page: Page): Locator {
  return page.getByRole("button", { name: "Continue", exact: true });
}

/** The wizard's "Full name" (person) or "Company name" field, shown for a kennitala nobody has yet. */
function subjectNameInput(page: Page, label: "Full name" | "Company name" = "Full name"): Locator {
  return page.getByRole("textbox", { name: label, exact: true });
}

function confirmCheckbox(page: Page): Locator {
  return page.getByRole("checkbox", { name: CONFIRM });
}

function startOverLink(page: Page): Locator {
  return page.getByRole("link", { name: "Start over", exact: true });
}

/** The "No account" badge next to the name on a profile page. */
function noAccountBadge(page: Page): Locator {
  return page.getByRole("main").locator("h1 ~ span").filter({ hasText: /^No account$/ });
}

function robotsMeta(page: Page): Locator {
  return page.locator('meta[name="robots"]');
}

/** A review card's id (its article is `review-<uuid>`). */
async function reviewIdOf(card: Locator): Promise<string> {
  const id = await card.getAttribute("id");
  expect(id).toMatch(/^review-[0-9a-f-]{36}$/);
  return id!.slice("review-".length);
}

/** Fill a new person review on a profile page: their kennitala first, then the review. */
async function fillPersonReview(page: Page, kennitala: string, review: Partial<Review> & Pick<Review, "title" | "body">) {
  await reviewKennitalaInput(page).fill(kennitala);
  await fillReview(page, review);
}

/** The kennitala (in any of its usual spellings) is nowhere in the page's HTML or URL. */
async function expectNoKennitala(page: Page, kennitala: string): Promise<void> {
  const html = await page.content();
  for (const variant of kennitalaVariants(kennitala)) {
    expect(html, `page HTML contains ${variant}`).not.toContain(variant);
    expect(page.url()).not.toContain(variant);
  }
}

/** "15 May 1980": how the wizard shows a new kennitala's date of birth, in English. */
function birthDateText(kennitala: string): string {
  const century: Record<string, number> = { "8": 1800, "9": 1900, "0": 2000 };
  const year = century[kennitala[9]] + Number(kennitala.slice(4, 6));
  const date = new Date(Date.UTC(year, Number(kennitala.slice(2, 4)) - 1, Number(kennitala.slice(0, 2))));
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Atlantic/Reykjavik",
  }).format(date);
}

/** "October 2026": the month the profile's first review was written (today). */
function thisMonth(): string {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "Atlantic/Reykjavik" }).format(
    new Date(),
  );
}

/** A person's name for a new profile ("Gervi Bqhzkxlwpcb"): letters only, unique. */
function newPersonName(): string {
  return `Gervi ${nameToken()}`;
}

/** A new page with JavaScript turned off, signed in as whoever `page` is signed in as. */
async function withoutJavaScript(browser: Browser, page: Page): Promise<Page> {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  return context.newPage();
}

// ---------------------------------------------------------------------------
// Profile pages
// ---------------------------------------------------------------------------

test.describe("renter reviews a landlord on their page", () => {
  test("asks for the kennitala first, then shows the review on the profile, dashboards and home page", async ({
    page,
    browser,
  }) => {
    const landlord = await createActor(browser, "landlord");
    const renter = makeUser("renter");
    await signUp(page, renter);

    await page.goto(landlord.profilePath);
    const panel = reviewPanel(page);
    await expect(panel.getByRole("heading", { name: `Review ${landlord.user.name}` })).toBeVisible();
    await expect(panel.getByText("Your review is public and shows your name. One review per landlord.")).toBeVisible();
    await expect(panel.getByText(GUIDELINES)).toBeVisible();
    await expect(page.getByText("Tap a star")).toBeVisible();
    await expect(page.getByText(`No reviews for ${landlord.user.name} yet`)).toBeVisible();
    await expect(page.getByText("Be the first to share your experience.")).toBeVisible();
    for (let n = 1; n <= 5; n++) await expect(starRadio(page, n)).not.toBeChecked();
    // No rating yet.
    await expect(summaryAverage(page)).toHaveText("—");
    await expect(summaryCount(page)).toHaveText("No reviews yet");
    await expect(page.getByRole("img", { name: "No ratings yet" })).toBeVisible();

    // The landlord's kennitala comes first, before the stars and the text.
    const kennitala = reviewKennitalaInput(page);
    const fields = panel.locator("input:not([type=hidden]), textarea");
    await expect(fields.first()).toHaveAttribute("name", "subjectKennitala");
    await expect(kennitala).toHaveAccessibleName("Landlord's kennitala");
    await expect(kennitala).toHaveAccessibleDescription(KENNITALA_HINT);
    await expect(kennitala).toHaveAttribute("inputmode", "numeric");
    await expect(kennitala).toHaveAttribute("autocomplete", "off");
    await expect(kennitala).toHaveValue("");

    const review = makeReview(4);
    await kennitala.fill(formatKennitala(landlord.user.kennitala));
    await pickStars(page, 4);
    await expect(page.getByText("Good", { exact: true })).toBeVisible();
    // Changing your mind is fine; only one star level is selected.
    await pickStars(page, 2);
    await expect(starRadio(page, 4)).not.toBeChecked();
    await pickStars(page, 4);
    await reviewTitleInput(page).fill(review.title);
    await reviewBodyInput(page).fill(review.body);
    await postButton(page).click();

    await expect(formStatus(page)).toHaveText(LIVE);
    const card = reviewCard(page, review.title);
    await expect(card).toBeVisible();
    await expect(card).toContainText(review.body);
    await expect(card.getByRole("link", { name: renter.name })).toBeVisible();
    await expect(card.getByText("Renter", { exact: true })).toBeVisible();
    await expect(card.getByText("You", { exact: true })).toBeVisible();
    await expect(card.getByRole("img", { name: "Rated 4 out of 5 stars" })).toBeVisible();
    // The rating is also written out as a number.
    await expect(card.getByText("4/5", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Delete" })).toBeVisible();
    await expect(card.getByRole("link", { name: "Edit" })).toHaveAttribute("href", `${landlord.profilePath}#your-review`);
    // Your own review has no "Report" link.
    await expect(card.getByRole("link", { name: "Report" })).toHaveCount(0);

    await expect(reviewsHeading(page, 1)).toBeVisible();
    await expect(summaryCount(page)).toHaveText("1 review");
    await expect(summaryAverage(page)).toHaveText("4");

    // The panel switches to "Your review" with an update button, and stops asking for the kennitala.
    await expect(panel.getByRole("heading", { name: "Your review" })).toBeVisible();
    await expect(updateButton(page)).toBeVisible();
    await expect(reviewKennitalaInput(page)).toHaveCount(0);
    // The kennitala the renter typed is gone from the page, also after a reload.
    await expectNoKennitala(page, landlord.user.kennitala);
    await page.reload();
    await expect(reviewCard(page, review.title)).toBeVisible();
    await expectNoKennitala(page, landlord.user.kennitala);

    // Renter's dashboard lists it under "Reviews you've written", with edit/delete controls.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Reviews you've written (1)" })).toBeVisible();
    const written = reviewCard(page, review.title);
    await expect(written.getByText(`Reviewed ${landlord.user.name}`)).toBeVisible();
    await expect(written.getByRole("link", { name: landlord.user.name })).toHaveAttribute("href", landlord.profilePath);
    await expect(written.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      `${landlord.profilePath}#your-review`,
    );
    await expect(written.getByRole("button", { name: "Delete" })).toBeVisible();

    // It's the newest review on the home page.
    await page.goto("/");
    const latest = page.getByRole("region", { name: "Latest reviews" }).locator("article").first();
    await expect(latest).toContainText(review.title);
    await expect(latest).toContainText(`Reviewed ${landlord.user.name}`);

    // The landlord sees it under "Reviews about you" but can't edit or delete it, only report it.
    await landlord.page.goto("/dashboard");
    await expect(landlord.page.getByRole("heading", { name: "Reviews about you (1)" })).toBeVisible();
    await expect(landlord.page.getByText(CANT_REMOVE)).toBeVisible();
    const aboutMe = reviewCard(landlord.page, review.title);
    await expect(aboutMe).toContainText(review.body);
    await expect(aboutMe.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(aboutMe.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await expect(aboutMe.getByRole("link", { name: "Report", exact: true })).toBeVisible();
    await expect(summaryAverage(landlord.page)).toHaveText("4");

    // And the directory card shows the new rating.
    await page.goto(`/landlords?q=${encodeURIComponent(landlord.user.name)}`);
    await expect(page.getByRole("link", { name: new RegExp(escapeRegExp(landlord.user.name)) })).toContainText(
      "4 · 1 review",
    );

    await landlord.context.close();
  });

  test("a kennitala that doesn't match the profile is refused, whoever it belongs to", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const renter = makeUser("renter");
    await signUp(page, renter);
    await page.goto(landlord.profilePath);
    const kennitala = reviewKennitalaInput(page);
    const review = makeReview(4);

    // A number nobody has, and a number that belongs to someone else (a demo
    // landlord), get the same answer, so the form can't be used to find out whose a number is.
    for (const wrong of [formatKennitala(freshKennitala()), formatKennitala(DEMO.people.sigrun.kennitala)]) {
      await fillPersonReview(page, wrong, review);
      await postButton(page).click();
      await expect(formAlert(page)).toHaveText(FIX);
      await expect(kennitala).toHaveAttribute("aria-invalid", "true");
      await expect(kennitala).toHaveAccessibleDescription(`${KENNITALA_HINT} ${MISMATCH}`);
      // Focus goes to the field to fix, and everything typed is kept.
      await expect(kennitala).toBeFocused();
      await expect(kennitala).toHaveValue(wrong);
      await expect(starRadio(page, 4)).toBeChecked();
      await expect(reviewTitleInput(page)).toHaveValue(review.title);
      await expect(reviewBodyInput(page)).toHaveValue(review.body);
      // Nothing was saved.
      await expect(page.getByText(`No reviews for ${landlord.user.name} yet`)).toBeVisible();
    }

    // Other problems with the number.
    const cases: [string, string][] = [
      ["", "Enter the landlord's kennitala."],
      [NOT_A_KENNITALA, INVALID_KENNITALA],
      [formatKennitala(renter.kennitala), OWN_KENNITALA],
      [freshKennitala("minor"), MINOR],
    ];
    for (const [typed, message] of cases) {
      await fillPersonReview(page, typed, review);
      await postButton(page).click();
      await expect(kennitala, typed).toHaveAccessibleDescription(`${KENNITALA_HINT} ${message}`);
      await expect(formAlert(page)).toHaveText(FIX);
      await expect(kennitala).toHaveValue(typed);
      await expect(page.getByText(`No reviews for ${landlord.user.name} yet`)).toBeVisible();
    }

    // The right number, typed with a space instead of a hyphen, posts the review.
    const right = landlord.user.kennitala;
    await kennitala.fill(`${right.slice(0, 6)} ${right.slice(6)}`);
    await postButton(page).click();
    await expect(formStatus(page)).toHaveText(LIVE);
    await expect(reviewCard(page, review.title)).toBeVisible();
    await expect(page.getByText(MISMATCH)).toHaveCount(0);
    await expect(reviewsHeading(page, 1)).toBeVisible();

    // Only this landlord got a review: Sigrún's page didn't change.
    await page.goto(await demoProfilePath(page, "sigrun"));
    await expect(reviewCard(page, review.title)).toHaveCount(0);
    await landlord.context.close();
  });

  test("review text is shown as plain text, keeping line breaks", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    const review = makeReview(3, {
      title: `<i>Not italic</i> ${uid()}`,
      body: "First line <b>not bold</b> & <script>window.__xss = 1</script>\nSecond line of the review.",
    });
    await postReview(page, landlord.profilePath, review, landlord.user.kennitala);
    const card = reviewCard(page, review.title);
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(review.title);
    await expect(card.locator("i, b, script")).toHaveCount(0);
    expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
    const body = card.locator("p", { hasText: "First line" });
    expect(await body.innerText()).toBe(review.body);
    await landlord.context.close();
  });

  test("a kennitala in the review text is refused", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    await page.goto(landlord.profilePath);
    const someone = formatKennitala(freshKennitala());
    const review = makeReview(2, { body: `The landlord's brother (kt. ${someone}) handled the repairs, slowly.` });
    await fillPersonReview(page, landlord.user.kennitala, review);
    await postButton(page).click();
    await expect(formAlert(page)).toHaveText(FIX);
    await expect(reviewBodyInput(page)).toHaveAttribute("aria-invalid", "true");
    await expect(reviewBodyInput(page)).toHaveAccessibleDescription(`At least 20 characters. ${NO_KENNITALA_IN_TEXT}`);
    await expect(reviewBodyInput(page)).toBeFocused();

    // In the headline too.
    await reviewTitleInput(page).fill(`Ask ${someone.replace("-", "")}`);
    await reviewBodyInput(page).fill("The landlord's brother handled the repairs, slowly.");
    await postButton(page).click();
    await expect(reviewTitleInput(page)).toHaveAccessibleDescription(NO_KENNITALA_IN_TEXT);
    await expect(page.getByText(`No reviews for ${landlord.user.name} yet`)).toBeVisible();

    await reviewTitleInput(page).fill(review.title);
    await postButton(page).click();
    await expect(formStatus(page)).toHaveText(LIVE);
    await expectNoKennitala(page, someone);
    await landlord.context.close();
  });

  test("editing: the form is prefilled, doesn't ask for the kennitala, and updates the same review", async ({
    page,
    browser,
  }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    const original = makeReview(4);
    await postReview(page, landlord.profilePath, original, landlord.user.kennitala);

    // Come back later via the dashboard's Edit link.
    await page.goto("/dashboard");
    await reviewCard(page, original.title).getByRole("link", { name: "Edit" }).click();
    await expect(page).toHaveURL(`${landlord.profilePath}#your-review`);

    await expect(reviewPanel(page).getByRole("heading", { name: "Your review" })).toBeVisible();
    await expect(page.getByText("You can update your review any time. It's shown publicly with your name.")).toBeVisible();
    await expect(reviewPanel(page).getByText(GUIDELINES)).toBeVisible();
    await expect(reviewKennitalaInput(page)).toHaveCount(0);
    await expect(starRadio(page, 4)).toBeChecked();
    await expect(page.getByText("Good", { exact: true })).toBeVisible();
    await expect(reviewTitleInput(page)).toHaveValue(original.title);
    await expect(reviewBodyInput(page)).toHaveValue(original.body);
    await expect(updateButton(page)).toBeVisible();
    await expect(postButton(page)).toHaveCount(0);
    // No success banner left over from earlier.
    await expect(formStatus(page)).toHaveCount(0);

    const updated = makeReview(2);
    await fillReview(page, updated);
    await updateButton(page).click();
    await expect(formStatus(page)).toHaveText(UPDATED);

    await expect(reviewCard(page, updated.title)).toBeVisible();
    await expect(reviewCard(page, updated.title).getByRole("img", { name: "Rated 2 out of 5 stars" })).toBeVisible();
    await expect(reviewCard(page, original.title)).toHaveCount(0);
    await expect(reviewsHeading(page, 1)).toBeVisible();
    await expect(summaryAverage(page)).toHaveText("2");
    await expect(page.getByRole("list", { name: "Rating breakdown" }).getByRole("listitem").nth(3)).toHaveText(
      /2 stars\s*1 review/,
    );

    // The form now holds the updated review, also after a reload.
    await page.reload();
    await expect(starRadio(page, 2)).toBeChecked();
    await expect(reviewTitleInput(page)).toHaveValue(updated.title);
    await expect(reviewBodyInput(page)).toHaveValue(updated.body);
    await expect(reviewKennitalaInput(page)).toHaveCount(0);

    // Still exactly one review on the dashboard.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Reviews you've written (1)" })).toBeVisible();
    await expect(reviewCard(page, updated.title)).toBeVisible();
    await landlord.context.close();
  });

  test("validation errors keep the typed text, the kennitala and the star selection", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    await page.goto(landlord.profilePath);

    await reviewKennitalaInput(page).fill(formatKennitala(landlord.user.kennitala));
    await pickStars(page, 5);
    await reviewTitleInput(page).fill("ok");
    await reviewBodyInput(page).fill("Too short.");
    await postButton(page).click();

    await expect(formAlert(page)).toHaveText(FIX);
    await expect(page.getByText("Title must be at least 3 characters.")).toBeVisible();
    await expect(page.getByText("Your review must be at least 20 characters.")).toBeVisible();
    await expect(reviewTitleInput(page)).toHaveAttribute("aria-invalid", "true");
    await expect(reviewBodyInput(page)).toHaveAttribute("aria-invalid", "true");
    await expect(reviewKennitalaInput(page)).not.toHaveAttribute("aria-invalid", "true");
    await expect(reviewKennitalaInput(page)).toHaveValue(formatKennitala(landlord.user.kennitala));
    await expect(starRadio(page, 5)).toBeChecked();
    await expect(page.getByText("Excellent", { exact: true })).toBeVisible();
    await expect(reviewTitleInput(page)).toHaveValue("ok");
    await expect(reviewBodyInput(page)).toHaveValue("Too short.");
    // Nothing was saved.
    await expect(page.getByText(`No reviews for ${landlord.user.name} yet`)).toBeVisible();
    await expect(postButton(page)).toBeVisible();

    // Whitespace doesn't count towards the minimum length.
    await reviewTitleInput(page).fill("   ab   ");
    await postButton(page).click();
    await expect(page.getByText("Title must be at least 3 characters.")).toBeVisible();
    await expect(starRadio(page, 5)).toBeChecked();

    // Fixing the errors posts the review with the remembered rating and kennitala.
    const fixed = makeReview(5);
    await reviewTitleInput(page).fill(fixed.title);
    await reviewBodyInput(page).fill(fixed.body);
    await postButton(page).click();
    await expect(formStatus(page)).toHaveText(LIVE);
    await expect(reviewCard(page, fixed.title).getByRole("img", { name: "Rated 5 out of 5 stars" })).toBeVisible();
    await expect(page.getByText("Title must be at least 3 characters.")).toHaveCount(0);
    await landlord.context.close();
  });

  test("the star picker works with the keyboard", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    await page.goto(landlord.profilePath);

    // Keyboard only (no mouse hover): type the kennitala, Tab into the stars,
    // select the first with Space, then move with the arrow keys like any radio group.
    await reviewKennitalaInput(page).focus();
    await page.keyboard.type(landlord.user.kennitala);
    await page.keyboard.press("Tab");
    await expect(starRadio(page, 1)).toBeFocused();
    await page.keyboard.press("Space");
    await expect(starRadio(page, 1)).toBeChecked();
    await expect(page.getByText("Terrible", { exact: true })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(starRadio(page, 4)).toBeChecked();
    await expect(starRadio(page, 4)).toBeFocused();
    await expect(page.getByText("Good", { exact: true })).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(starRadio(page, 2)).toBeChecked();
    await expect(page.getByText("Poor", { exact: true })).toBeVisible();

    // Tab on to the text fields and post.
    const review = makeReview(2);
    await page.keyboard.press("Tab");
    await expect(reviewTitleInput(page)).toBeFocused();
    await page.keyboard.type(review.title);
    await page.keyboard.press("Tab");
    await expect(reviewBodyInput(page)).toBeFocused();
    await page.keyboard.type(review.body);
    await page.keyboard.press("Tab");
    await expect(postButton(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(formStatus(page)).toHaveText(LIVE);
    await expect(reviewCard(page, review.title).getByRole("img", { name: "Rated 2 out of 5 stars" })).toBeVisible();
    await landlord.context.close();
  });

  test("an invalid edit keeps the new text instead of reverting to the saved review", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    const saved = makeReview(3);
    await postReview(page, landlord.profilePath, saved, landlord.user.kennitala);

    await pickStars(page, 1);
    await reviewTitleInput(page).fill("Changed my mind completely");
    await reviewBodyInput(page).fill("Short");
    await updateButton(page).click();
    await expect(page.getByText("Your review must be at least 20 characters.")).toBeVisible();
    await expect(starRadio(page, 1)).toBeChecked();
    await expect(reviewTitleInput(page)).toHaveValue("Changed my mind completely");
    await expect(reviewBodyInput(page)).toHaveValue("Short");
    // An edit still doesn't ask for the kennitala.
    await expect(reviewKennitalaInput(page)).toHaveCount(0);
    // The saved review is unchanged.
    await expect(reviewCard(page, saved.title).getByRole("img", { name: "Rated 3 out of 5 stars" })).toBeVisible();
    await landlord.context.close();
  });

  // Regression: submitting without a star used to show zod's raw
  // "Invalid input: expected number, received NaN" under the stars.
  test("submitting without a star rating asks you to pick one and keeps the typed text", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    await page.goto(landlord.profilePath);
    const review = makeReview(1);
    await reviewKennitalaInput(page).fill(landlord.user.kennitala);
    await reviewTitleInput(page).fill(review.title);
    await reviewBodyInput(page).fill(review.body);
    await postButton(page).click();

    await expect(formAlert(page)).toHaveText(FIX);
    const stars = page.getByRole("group", { name: "Your rating" });
    await expect(stars).toHaveAttribute("aria-invalid", "true");
    await expect(stars).toContainText("Pick a star rating from 1 to 5.");
    await expect(stars).toHaveAccessibleDescription("Pick a star rating from 1 to 5.");
    await expect(page.getByText(/expected number|NaN|Invalid input/)).toHaveCount(0);
    await expect(reviewTitleInput(page)).toHaveValue(review.title);
    await expect(reviewBodyInput(page)).toHaveValue(review.body);
    await expect(reviewKennitalaInput(page)).toHaveValue(landlord.user.kennitala);
    await expect(page.getByText(`No reviews for ${landlord.user.name} yet`)).toBeVisible();
    // Focus moves to the stars so keyboard users can fix it straight away.
    await expect(starRadio(page, 1)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(starRadio(page, 2)).toBeChecked();
    await postButton(page).click();
    await expect(formStatus(page)).toHaveText(LIVE);
    await expect(reviewCard(page, review.title).getByRole("img", { name: "Rated 2 out of 5 stars" })).toBeVisible();
    await landlord.context.close();
  });

  // Regression: a NUL character pasted into a review used to make the insert
  // fail with a 500 "Something went wrong" page. It's now silently dropped.
  test("a review containing a NUL character is saved without it", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    await page.goto(landlord.profilePath);
    const id = uid();
    const review = makeReview(3, {
      title: `Nul\u0000 title ${id}`,
      body: "Pasted from a PDF:\u0000 the heating was broken all winter.",
    });
    await fillPersonReview(page, landlord.user.kennitala, review);
    await postButton(page).click();
    await expect(formStatus(page)).toHaveText(LIVE);
    await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
    const card = reviewCard(page, `Nul title ${id}`);
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(`Nul title ${id}`);
    await expect(card).toContainText("Pasted from a PDF: the heating was broken all winter.");
    // The form holds the cleaned-up text too.
    await expect(reviewTitleInput(page)).toHaveValue(`Nul title ${id}`);
    await landlord.context.close();
  });

  test("a NUL character in other forms doesn't crash them either", async ({ page }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    await page.getByLabel("Bio").fill("Quiet\u0000 tenant");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(formStatus(page)).toHaveText("Profile saved.");
    await expect(page.getByLabel("Bio")).toHaveValue("Quiet tenant");

    const property = makeProperty({ description: "Nul\u0000 description" });
    await addProperty(page, property);
    await expect(page.getByText("Nul description")).toBeVisible();

    await logOut(page);
    await page.goto("/login");
    await fillLogin(page, `${user.email}\u0000`, user.password);
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("after a failed submit, focus moves to the first field to fix; after success, to the message", async ({
    page,
    browser,
  }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    await page.goto(landlord.profilePath);
    await pickStars(page, 4);
    await reviewTitleInput(page).fill("ok");
    await reviewBodyInput(page).fill("Too short.");
    await postButton(page).click();
    await expect(page.getByText("Title must be at least 3 characters.")).toBeVisible();
    await expect(reviewTitleInput(page)).toBeFocused();

    await reviewTitleInput(page).fill("A proper headline");
    await postButton(page).click();
    await expect(page.getByText("Your review must be at least 20 characters.")).toBeVisible();
    await expect(reviewBodyInput(page)).toBeFocused();

    // The kennitala is checked once the rest is fine.
    await reviewBodyInput(page).fill("Long enough this time, and all of it true.");
    await postButton(page).click();
    await expect(reviewKennitalaInput(page)).toHaveAccessibleDescription(
      `${KENNITALA_HINT} Enter the landlord's kennitala.`,
    );
    await expect(reviewKennitalaInput(page)).toBeFocused();

    await page.keyboard.type(landlord.user.kennitala);
    await postButton(page).click();
    await expect(formStatus(page)).toHaveText(LIVE);
    await expect(formStatus(page)).toBeFocused();
    await landlord.context.close();
  });

  test("deleting a review asks for confirmation and removes it", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    const review = makeReview(1);
    await postReview(page, landlord.profilePath, review, landlord.user.kennitala);
    const card = reviewCard(page, review.title);

    // Cancelling the confirm dialog keeps it.
    await clickAndCancel(page, card.getByRole("button", { name: "Delete" }));
    await page.reload();
    await expect(reviewCard(page, review.title)).toBeVisible();

    await clickAndConfirm(page, reviewCard(page, review.title).getByRole("button", { name: "Delete" }));
    await expect(reviewCard(page, review.title)).toHaveCount(0);
    await expect(page.getByText(`No reviews for ${landlord.user.name} yet`)).toBeVisible();
    await expect(reviewsHeading(page, 0)).toBeVisible();
    await expect(summaryCount(page)).toHaveText("No reviews yet");
    // A landlord with an account keeps their page.
    await expect(page).toHaveURL(landlord.profilePath);

    // The form is empty again (asking for the kennitala again), without a stale success message.
    await expect(reviewPanel(page).getByRole("heading", { name: `Review ${landlord.user.name}` })).toBeVisible();
    await expect(postButton(page)).toBeVisible();
    await expect(reviewKennitalaInput(page)).toHaveValue("");
    await expect(reviewTitleInput(page)).toHaveValue("");
    await expect(reviewBodyInput(page)).toHaveValue("");
    await expect(starRadio(page, 1)).not.toBeChecked();
    await expect(formStatus(page)).toHaveCount(0);

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Reviews you've written (0)" })).toBeVisible();
    await landlord.page.goto("/dashboard");
    await expect(landlord.page.getByRole("heading", { name: "Reviews about you (0)" })).toBeVisible();
    await landlord.context.close();
  });

  test("a review can be deleted from the dashboard", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    const review = makeReview(5);
    await postReview(page, landlord.profilePath, review, landlord.user.kennitala);

    await page.goto("/dashboard");
    await clickAndConfirm(page, reviewCard(page, review.title).getByRole("button", { name: "Delete" }));
    await expect(reviewCard(page, review.title)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Reviews you've written (0)" })).toBeVisible();
    await page.goto(landlord.profilePath);
    await expect(reviewsHeading(page, 0)).toBeVisible();
    await landlord.context.close();
  });

  test("posting from two tabs at the same time still leaves a single review", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    const other = await page.context().newPage();
    const a = makeReview(5);
    const b = makeReview(1);
    await page.goto(landlord.profilePath);
    await other.goto(landlord.profilePath);
    await fillPersonReview(page, landlord.user.kennitala, a);
    await fillPersonReview(other, landlord.user.kennitala, b);
    await Promise.all([postButton(page).click(), postButton(other).click()]);
    await expect(formStatus(page)).toHaveText(new RegExp(`${escapeRegExp(LIVE)}|${escapeRegExp(UPDATED)}`));
    await expect(formStatus(other)).toHaveText(new RegExp(`${escapeRegExp(LIVE)}|${escapeRegExp(UPDATED)}`));

    await page.reload();
    await expect(reviewsHeading(page, 1)).toBeVisible();
    await expect(page.locator("article")).toHaveCount(1);
    await expect(summaryCount(page)).toHaveText("1 review");
    // Whichever save finished last wins.
    await expect(page.locator("article").getByRole("heading", { level: 3 })).toHaveText(
      new RegExp(`${a.title}|${b.title}`),
    );
    await other.close();
    await landlord.context.close();
  });

  test("several renters' reviews are averaged, and each can only manage their own", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const first = await createActor(browser, "renter");
    const mine = makeReview(5);
    await postReview(first.page, landlord.profilePath, mine, landlord.user.kennitala);
    const firstReviewId = await reviewIdOf(reviewCard(first.page, mine.title));

    await signUp(page, makeUser("renter"));
    const theirs = makeReview(2);
    await postReview(page, landlord.profilePath, theirs, formatKennitala(landlord.user.kennitala));

    await expect(reviewsHeading(page, 2)).toBeVisible();
    await expect(summaryCount(page)).toHaveText("2 reviews");
    await expect(summaryAverage(page)).toHaveText("3.5");
    await expect(page.getByRole("img", { name: "Rated 3.5 out of 5 stars" })).toBeVisible();
    const breakdown = page.getByRole("list", { name: "Rating breakdown" }).getByRole("listitem");
    await expect(breakdown).toHaveText([
      /^5 stars\s*1 review$/,
      /^4 stars\s*0 reviews$/,
      /^3 stars\s*0 reviews$/,
      /^2 stars\s*1 review$/,
      /^1 star\s*0 reviews$/,
    ]);

    // Newest first.
    await expect(page.locator("article").first()).toContainText(theirs.title);
    // The other renter's review has no controls for me, only a Report link.
    const other = reviewCard(page, mine.title);
    await expect(other.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(other.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await expect(other.getByText("You", { exact: true })).toHaveCount(0);
    await expect(other.getByRole("link", { name: "Report", exact: true })).toHaveAttribute(
      "href",
      `/report?target=review&id=${firstReviewId}`,
    );

    // Even a tampered delete form can't remove someone else's review.
    const myDelete = reviewCard(page, theirs.title).locator("form");
    await myDelete.locator('input[name="reviewId"]').evaluate((input, id) => {
      (input as HTMLInputElement).value = id;
    }, firstReviewId);
    const deleteRequest = page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === landlord.profilePath,
    );
    await clickAndConfirm(page, myDelete.getByRole("button", { name: "Delete" }));
    expect((await deleteRequest).ok()).toBe(true);
    await page.reload();
    await expect(reviewCard(page, mine.title)).toBeVisible();
    await expect(reviewCard(page, theirs.title)).toBeVisible();
    await expect(reviewsHeading(page, 2)).toBeVisible();

    await landlord.context.close();
    await first.context.close();
  });
});

test.describe("renter reviews a property", () => {
  test("posts a review (no kennitala) that shows on the property, directory, and both dashboards", async ({
    page,
    browser,
  }) => {
    const landlord = await createActor(browser, "landlord");
    const property = makeProperty();
    const label = propertyLabel(property);
    const address = propertyAddressText(property);
    const propertyPath = await addProperty(landlord.page, property);

    await signUp(page, makeUser("renter"));
    await page.goto(propertyPath);
    const panel = reviewPanel(page);
    await expect(panel.getByRole("heading", { name: `Review ${label}` })).toBeVisible();
    await expect(panel.getByText("Your review is public and shows your name. One review per property.")).toBeVisible();
    await expect(panel.getByText(GUIDELINES)).toBeVisible();
    await expect(page.getByText("No reviews for this property yet")).toBeVisible();
    // A property review doesn't ask for anyone's kennitala.
    await expect(reviewKennitalaInput(page)).toHaveCount(0);
    await expect(panel.getByRole("textbox", { name: /kennitala/i })).toHaveCount(0);

    const review = makeReview(5, { body: "Bright rooms, quiet street, and the heating actually works in winter." });
    await fillReview(page, review);
    await postButton(page).click();
    await expect(formStatus(page)).toHaveText(LIVE);
    const card = reviewCard(page, review.title);
    await expect(card.getByRole("img", { name: "Rated 5 out of 5 stars" })).toBeVisible();
    await expect(card.getByText("Renter", { exact: true })).toBeVisible();
    await expect(reviewsHeading(page, 1)).toBeVisible();
    await expect(summaryAverage(page)).toHaveText("5");
    await expect(summaryCount(page)).toHaveText("1 review");

    // Directory card.
    await page.goto(`/properties?q=${encodeURIComponent(property.address)}`);
    await expect(page.getByRole("link", { name: new RegExp(escapeRegExp(label)) })).toContainText("5 · 1 review");

    // Renter's dashboard: "Lived at …", with the whole address on one line.
    await page.goto("/dashboard");
    const written = reviewCard(page, review.title);
    await expect(written.getByText(`Lived at ${address}`)).toBeVisible();
    await expect(written.getByRole("link", { name: address })).toHaveAttribute("href", propertyPath);

    // Landlord's dashboard: "Reviews of your properties".
    await landlord.page.goto("/dashboard");
    await expect(landlord.page.getByRole("heading", { name: "Reviews of your properties (1)" })).toBeVisible();
    const ofMine = reviewCard(landlord.page, review.title);
    await expect(ofMine).toContainText(`Lived at ${address}`);
    // The landlord can report it but not delete it.
    await expect(ofMine.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(ofMine.getByRole("link", { name: "Report", exact: true })).toBeVisible();
    // A property review is not a review of the landlord personally.
    await expect(landlord.page.getByRole("heading", { name: "Reviews about you (0)" })).toBeVisible();

    // Editing works the same way as for people.
    await page.goto(propertyPath);
    await expect(starRadio(page, 5)).toBeChecked();
    await expect(reviewPanel(page).getByRole("heading", { name: "Your review" })).toBeVisible();
    await pickStars(page, 3);
    await updateButton(page).click();
    await expect(formStatus(page)).toHaveText(UPDATED);
    await expect(summaryAverage(page)).toHaveText("3");
    await expect(reviewsHeading(page, 1)).toBeVisible();

    // And deleting.
    await clickAndConfirm(page, reviewCard(page, review.title).getByRole("button", { name: "Delete" }));
    await expect(reviewCard(page, review.title)).toHaveCount(0);
    await expect(reviewsHeading(page, 0)).toBeVisible();
    await expect(page.getByText("No reviews for this property yet")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();

    await landlord.context.close();
  });

  test("a renter can review the place they added, whose landlord has no account yet", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    const landlordName = newPersonName();
    const property = makeProperty();
    const propertyPath = await addProperty(page, property, { kennitala: freshKennitala(), name: landlordName });
    await expect(page.getByText("Added by a renter, not confirmed")).toBeVisible();

    const review = makeReview(2, { body: "Damp in the bedroom every winter, and the laundry room is always full." });
    await postReview(page, propertyPath, review);
    await expect(reviewsHeading(page, 1)).toBeVisible();
    // A property review isn't a review of its landlord.
    await page.getByRole("link", { name: landlordName }).click();
    await expect(page.getByRole("heading", { level: 1, name: landlordName })).toBeVisible();
    await expect(reviewsHeading(page, 0)).toBeVisible();
  });
});

test.describe("landlord reviews a renter", () => {
  test("posts a review that shows on the renter's profile and dashboard", async ({ page, browser }) => {
    const renter = await createActor(browser, "renter");
    const landlord = makeUser("landlord");
    await signUp(page, landlord);

    await page.goto(renter.profilePath);
    const panel = reviewPanel(page);
    await expect(panel.getByRole("heading", { name: `Review ${renter.user.name}` })).toBeVisible();
    await expect(panel.getByText("Your review is public and shows your name. One review per renter.")).toBeVisible();
    await expect(reviewKennitalaInput(page)).toHaveAccessibleName("Renter's kennitala");

    // The kennitala has to be this renter's.
    const review = makeReview(4, { body: "Kept the flat spotless and told us right away when the radiator leaked." });
    await fillPersonReview(page, freshKennitala(), review);
    await postButton(page).click();
    await expect(reviewKennitalaInput(page)).toHaveAccessibleDescription(`${KENNITALA_HINT} ${MISMATCH}`);

    await reviewKennitalaInput(page).fill(renter.user.kennitala);
    await postButton(page).click();
    await expect(formStatus(page)).toHaveText(LIVE);

    const card = reviewCard(page, review.title);
    await expect(card.getByRole("link", { name: landlord.name })).toBeVisible();
    await expect(card.getByText("Landlord", { exact: true })).toBeVisible();
    await expect(card.getByRole("img", { name: "Rated 4 out of 5 stars" })).toBeVisible();
    await expect(page.getByText(`${renter.user.name}, as rated by their landlords.`)).toBeVisible();
    await expect(reviewKennitalaInput(page)).toHaveCount(0);
    await expectNoKennitala(page, renter.user.kennitala);

    await page.goto("/dashboard");
    await expect(reviewCard(page, review.title).getByText(`Reviewed ${renter.user.name}`)).toBeVisible();

    await renter.page.goto("/dashboard");
    await expect(renter.page.getByRole("heading", { name: "Reviews about you (1)" })).toBeVisible();
    await expect(reviewCard(renter.page, review.title)).toContainText(review.body);
    await expect(reviewCard(renter.page, review.title).getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(summaryAverage(renter.page)).toHaveText("4");

    await page.goto(`/renters?q=${encodeURIComponent(renter.user.name)}`);
    await expect(page.getByRole("link", { name: new RegExp(escapeRegExp(renter.user.name)) })).toContainText(
      "4 · 1 review",
    );
    await renter.context.close();
  });
});

// ---------------------------------------------------------------------------
// /reviews/new
// ---------------------------------------------------------------------------

test.describe("writing a review by kennitala (/reviews/new)", () => {
  test("is linked from the header and needs you to log in first", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("banner").getByRole("link", { name: "Write a review", exact: true }).click();
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent("/reviews/new")}`);
    await fillLogin(page, DEMO.people.kari.email, DEMO_PASSWORD);
    await expect(page).toHaveURL("/reviews/new");
    await expect(page.getByRole("heading", { level: 1, name: "Write a review" })).toBeVisible();
    await expect(page).toHaveTitle("Write a review · GossipRent");
    await expect(robotsMeta(page)).toHaveAttribute("content", "noindex, nofollow");

    // A chosen kind survives the detour through the login page.
    await logOut(page);
    await page.goto("/reviews/new?kind=landlord");
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent("/reviews/new?kind=landlord")}`);
    await fillLogin(page, DEMO.people.kari.email, DEMO_PASSWORD);
    await expect(page).toHaveURL("/reviews/new?kind=landlord");
    await expect(page.getByRole("heading", { level: 2, name: "Review a landlord" })).toBeVisible();
  });

  test("the first step offers only the kinds of review you can write", async ({ page, browser }) => {
    // A renter reviews landlords (and properties, on their pages).
    await logInAs(page, "kari");
    await page.goto("/reviews/new");
    await expect(page.getByText("Share your experience with a landlord or a renter.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Who do you want to review?" })).toBeVisible();
    const landlordChoice = page.getByRole("main").getByRole("link", { name: "A landlord" });
    await expect(landlordChoice).toHaveAttribute("href", "/reviews/new?kind=landlord");
    await expect(landlordChoice).toHaveAccessibleDescription("You've rented a home from them.");
    await expect(page.getByRole("main").getByRole("link", { name: "A renter" })).toHaveCount(0);
    await expect(
      page.getByText("Reviewing a property? Property reviews are written on each property's page."),
    ).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Find a property" })).toHaveAttribute(
      "href",
      "/properties",
    );
    await expect(page.getByRole("main").getByRole("link", { name: "Add a property" })).toHaveAttribute(
      "href",
      "/properties/new",
    );
    // Asking for a kind you can't write gets the choice instead.
    await page.goto("/reviews/new?kind=renter");
    await expect(page.getByRole("heading", { level: 2, name: "Who do you want to review?" })).toBeVisible();
    await expect(reviewKennitalaInput(page)).toHaveCount(0);

    // Choosing moves on; "Choose again" goes back.
    await landlordChoice.click();
    await expect(page).toHaveURL("/reviews/new?kind=landlord");
    await expect(page.getByRole("heading", { level: 2, name: "Review a landlord" })).toBeVisible();
    await expect(
      page.getByText(
        "Enter the landlord's kennitala so it's clear who the review is about. Several people can share a name.",
      ),
    ).toBeVisible();
    await expect(reviewKennitalaInput(page)).toHaveAccessibleName("Landlord's kennitala");
    await expect(reviewKennitalaInput(page)).toHaveAccessibleDescription(KENNITALA_HINT);
    await page.getByRole("link", { name: "Choose again" }).click();
    await expect(page).toHaveURL("/reviews/new");
    await expect(page.getByRole("heading", { level: 2, name: "Who do you want to review?" })).toBeVisible();

    // Someone with both roles can review either.
    const both = await browser.newContext();
    const bothPage = await both.newPage();
    await logInAs(bothPage, "olafur");
    await bothPage.goto("/reviews/new");
    const choices = bothPage.getByRole("main").getByRole("listitem").getByRole("link");
    await expect(choices).toHaveText([/^A landlord/, /^A renter/]);
    await expect(bothPage.getByRole("main").getByRole("link", { name: "A renter" })).toHaveAccessibleDescription(
      "You've rented a home to them.",
    );
    await expect(bothPage.getByRole("main").getByRole("link", { name: "Find a property" })).toBeVisible();
    await bothPage.getByRole("main").getByRole("link", { name: "A renter" }).click();
    await expect(bothPage.getByRole("heading", { level: 2, name: "Review a renter" })).toBeVisible();
    await expect(reviewKennitalaInput(bothPage)).toHaveAccessibleName("Renter's kennitala");
    await both.close();

    // A landlord can only review renters, so there's nothing to choose (and no "Choose again").
    const landlord = await browser.newContext();
    const landlordPage = await landlord.newPage();
    await logInAs(landlordPage, "sigrun");
    for (const path of ["/reviews/new", "/reviews/new?kind=landlord"]) {
      await landlordPage.goto(path);
      await expect(landlordPage.getByRole("heading", { level: 2, name: "Review a renter" })).toBeVisible();
      await expect(landlordPage.getByRole("heading", { name: "Who do you want to review?" })).toHaveCount(0);
      await expect(landlordPage.getByRole("link", { name: "Choose again" })).toHaveCount(0);
      await expect(landlordPage.getByRole("main").getByRole("link", { name: "Find a property" })).toHaveCount(0);
    }
    await landlord.close();
  });

  test("Continue shows who a kennitala belongs to, with or without an account", async ({ page }) => {
    await logInAs(page, "kari");

    // A demo landlord with an account.
    await startReviewByKennitala(page, "landlord", formatKennitala(DEMO.people.sigrun.kennitala));
    const heading = wizardSubjectHeading(page);
    await expect(heading).toHaveAccessibleName(`This kennitala belongs to ${DEMO.people.sigrun.name}`);
    // Focus moves to the answer, so screen readers start there.
    await expect(heading).toBeFocused();
    await expect(heading.getByText("No account", { exact: true })).toHaveCount(0);
    await expect(page.getByText(`Kennitala: ${formatKennitala(DEMO.people.sigrun.kennitala)}`, { exact: true })).toBeVisible();
    // Nothing to fill in about them: the review fields follow straight away.
    await expect(subjectNameInput(page)).toHaveCount(0);
    await expect(confirmCheckbox(page)).toHaveCount(0);
    await expect(page.getByText(/^Date of birth:/)).toHaveCount(0);
    await expect(page.getByText(GUIDELINES)).toBeVisible();
    await expect(page.getByRole("group", { name: "Your rating" })).toBeVisible();
    await expect(reviewTitleInput(page)).toBeVisible();
    await expect(reviewBodyInput(page)).toBeVisible();
    await expect(postButton(page)).toBeVisible();
    // The kennitala field itself is gone (it's carried along in the form).
    await expect(reviewKennitalaInput(page)).toHaveCount(0);
    await expect(page.getByText("Wrong kennitala? Start over")).toBeVisible();

    // "Start over" goes back to an empty kennitala field.
    await startOverLink(page).click();
    await expect(page).toHaveURL("/reviews/new?kind=landlord");
    await expect(wizardSubjectHeading(page)).toHaveCount(0);
    await expect(reviewKennitalaInput(page)).toHaveValue("");

    // A landlord profile without an account, typed without the hyphen.
    await startReviewByKennitala(page, "landlord", DEMO.people.leigufelag.kennitala);
    await expect(heading).toContainText(`This kennitala belongs to ${DEMO.people.leigufelag.name}`);
    await expect(heading.getByText("No account", { exact: true })).toBeVisible();
    await expect(page.getByText(`Kennitala: ${formatKennitala(DEMO.people.leigufelag.kennitala)}`)).toBeVisible();
    await expect(subjectNameInput(page, "Company name")).toHaveCount(0);
    await expect(subjectNameInput(page)).toHaveCount(0);
    await expect(confirmCheckbox(page)).toHaveCount(0);

    // Someone who is only a renter so far is still found (a review would make them a landlord too).
    await startOverLink(page).click();
    await startReviewByKennitala(page, "landlord", DEMO.people.eva.kennitala);
    await expect(heading).toHaveAccessibleName(`This kennitala belongs to ${DEMO.people.eva.name}`);
  });

  test("a kennitala you already reviewed goes straight to your review", async ({ page }) => {
    // Kári (demo) has already reviewed Gunnar, a landlord without an account.
    await logInAs(page, "kari");
    const gunnarPath = await demoProfilePath(page, "gunnar");
    const existing = DEMO.reviews.find((r) => r.author === "kari" && "landlord" in r && r.landlord === "gunnar")!;

    await startReviewByKennitala(page, "landlord", DEMO.people.gunnar.kennitala);
    await expect(page).toHaveURL(`${gunnarPath}#your-review`);
    const panel = reviewPanel(page);
    await expect(panel.getByRole("heading", { name: "Your review" })).toBeVisible();
    await expect(reviewTitleInput(page)).toHaveValue(existing.title);
    await expect(starRadio(page, existing.rating)).toBeChecked();
    await expect(updateButton(page)).toBeVisible();
    await expect(reviewKennitalaInput(page)).toHaveCount(0);
    await expectNoKennitala(page, DEMO.people.gunnar.kennitala);
  });

  test("a new kennitala: give their name, confirm, and the review creates their page", async ({ page }) => {
    const renter = makeUser("renter");
    await signUp(page, renter);
    const kennitala = freshKennitala();
    const name = newPersonName();

    await page.goto("/reviews/new");
    await page.getByRole("main").getByRole("link", { name: "A landlord" }).click();
    await reviewKennitalaInput(page).fill(formatKennitala(kennitala));
    await continueButton(page).click();

    const heading = wizardSubjectHeading(page);
    await expect(heading).toHaveAccessibleName(NOT_FOUND);
    await expect(heading).toBeFocused();
    await expect(page.getByText(`Kennitala: ${formatKennitala(kennitala)}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`Date of birth: ${birthDateText(kennitala)}`, { exact: true })).toBeVisible();
    const nameInput = subjectNameInput(page);
    await expect(nameInput).toHaveAccessibleDescription(NAME_HINT);
    await expect(confirmCheckbox(page)).not.toBeChecked();
    await expect(page.getByText(GUIDELINES)).toBeVisible();

    // The review itself is checked first…
    await postButton(page).click();
    await expect(formAlert(page)).toHaveText(FIX);
    await expect(page.getByRole("group", { name: "Your rating" })).toHaveAccessibleDescription(
      "Pick a star rating from 1 to 5.",
    );
    await expect(page.getByText("Title must be at least 3 characters.")).toBeVisible();
    await expect(page.getByText("Your review must be at least 20 characters.")).toBeVisible();
    await expect(starRadio(page, 1)).toBeFocused();
    // …still about the same kennitala.
    await expect(heading).toHaveAccessibleName(NOT_FOUND);
    await expect(page.getByText(`Kennitala: ${formatKennitala(kennitala)}`, { exact: true })).toBeVisible();

    // …then the name…
    const review = makeReview(2, { body: "Mould in the bathroom that never got fixed, but the deposit came back." });
    await fillReview(page, review);
    await postButton(page).click();
    await expect(nameInput).toHaveAccessibleDescription(`${NAME_HINT} ${NAME_TOO_SHORT}`);
    await expect(nameInput).toBeFocused();
    await expect(reviewTitleInput(page)).toHaveValue(review.title);
    await expect(starRadio(page, 2)).toBeChecked();

    await nameInput.fill("Gervi 2");
    await postButton(page).click();
    await expect(nameInput).toHaveAccessibleDescription(`${NAME_HINT} ${NAME_CHARS}`);
    await expect(nameInput).toHaveValue("Gervi 2");

    // …then the confirmation.
    await nameInput.fill(name);
    await postButton(page).click();
    await expect(page.getByText(CONFIRM_REQUIRED)).toBeVisible();
    await expect(confirmCheckbox(page)).toHaveAttribute("aria-invalid", "true");
    await expect(confirmCheckbox(page)).toHaveAccessibleDescription(CONFIRM_REQUIRED);
    await expect(confirmCheckbox(page)).toBeFocused();
    await expect(nameInput).toHaveValue(name);
    await expect(reviewBodyInput(page)).toHaveValue(review.body);

    await confirmCheckbox(page).check();
    await postButton(page).click();

    // The new page: the name typed, "No account", and the review.
    await expect(page).toHaveURL(/\/landlords\/[0-9a-f-]{36}\?saved=1(#your-review)?$/);
    const path = new URL(page.url()).pathname;
    await expect(formStatus(page)).toHaveText(LIVE);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(noAccountBadge(page)).toBeVisible();
    await expect(page.getByText(NO_ACCOUNT_NOTE)).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign up with your kennitala" })).toHaveAttribute("href", "/signup");
    await expect(page.getByText(`First reviewed ${thisMonth()}`, { exact: true })).toBeVisible();
    await expect(page.getByText(/Member since/)).toHaveCount(0);
    await expect(page.getByText("Identity not verified")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Report this page" })).toHaveAttribute(
      "href",
      `/report?target=profile&id=${path.split("/").pop()}`,
    );
    // A person who didn't sign up stays out of search engines.
    await expect(robotsMeta(page)).toHaveAttribute("content", "noindex, nofollow");
    const card = reviewCard(page, review.title);
    await expect(card.getByText("You", { exact: true })).toBeVisible();
    await expect(card.getByRole("img", { name: "Rated 2 out of 5 stars" })).toBeVisible();
    await expect(reviewsHeading(page, 1)).toBeVisible();
    await expect(summaryAverage(page)).toHaveText("2");
    // The panel is now "Your review", and the number is nowhere on the page.
    await expect(reviewPanel(page).getByRole("heading", { name: "Your review" })).toBeVisible();
    await expect(updateButton(page)).toBeVisible();
    await expectNoKennitala(page, kennitala);

    // The page is in the directory, badged "No account".
    await page.goto(`/landlords?q=${encodeURIComponent(name)}`);
    const directoryCard = page.getByRole("main").getByRole("link", { name: new RegExp(escapeRegExp(name)) });
    await expect(directoryCard).toHaveAttribute("href", path);
    await expect(directoryCard).toContainText("No account");
    await expect(directoryCard).toContainText("2 · 1 review");

    // The dashboard lists it with the other reviews you wrote.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Reviews you've written (1)" })).toBeVisible();
    await expect(reviewCard(page, review.title).getByRole("link", { name })).toHaveAttribute("href", path);

    // Trying again with the same kennitala goes to that review.
    await startReviewByKennitala(page, "landlord", kennitala);
    await expect(page).toHaveURL(`${path}#your-review`);
    await expect(reviewTitleInput(page)).toHaveValue(review.title);
  });

  test("the next review of that kennitala finds the page the first one created", async ({ page, browser }) => {
    const first = await createActor(browser, "renter");
    const kennitala = freshKennitala();
    const name = newPersonName();
    const firstReview = makeReview(5);
    const path = await writeReviewByKennitala(first.page, "landlord", { kennitala, name }, firstReview);

    await signUp(page, makeUser("renter"));
    await startReviewByKennitala(page, "landlord", kennitala);
    const heading = wizardSubjectHeading(page);
    await expect(heading).toContainText(`This kennitala belongs to ${name}`);
    await expect(heading.getByText("No account", { exact: true })).toBeVisible();
    await expect(subjectNameInput(page)).toHaveCount(0);
    await expect(confirmCheckbox(page)).toHaveCount(0);

    const second = makeReview(2);
    await fillReview(page, second);
    await postButton(page).click();
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(path)}\\?saved=1(#your-review)?$`));
    await expect(formStatus(page)).toHaveText(LIVE);
    await expect(reviewsHeading(page, 2)).toBeVisible();
    await expect(summaryAverage(page)).toHaveText("3.5");
    await expect(reviewCard(page, firstReview.title)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await first.context.close();
  });

  test("a company's kennitala asks for the company's name", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    const kennitala = freshKennitala("company");
    const company = `E2e ${nameToken()} & 2 ehf.`;
    await startReviewByKennitala(page, "landlord", kennitala);
    await expect(wizardSubjectHeading(page)).toHaveAccessibleName(NOT_FOUND);
    await expect(page.getByText("Company", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Date of birth:/)).toHaveCount(0);
    await expect(subjectNameInput(page)).toHaveCount(0);

    // Company names may have digits and "&".
    await subjectNameInput(page, "Company name").fill(company);
    await confirmCheckbox(page).check();
    const review = makeReview(3, { body: "Everything goes through a service portal, but repairs are done properly." });
    await fillReview(page, review);
    await postButton(page).click();

    await expect(page).toHaveURL(/\/landlords\/[0-9a-f-]{36}\?saved=1(#your-review)?$/);
    await expect(formStatus(page)).toHaveText(LIVE);
    await expect(page.getByRole("heading", { level: 1, name: company })).toBeVisible();
    await expect(noAccountBadge(page)).toBeVisible();
    await expect(page.getByText(COMPANY_NOTE, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign up with your kennitala" })).toHaveCount(0);
    await expect(reviewCard(page, review.title)).toBeVisible();
    await expectNoKennitala(page, kennitala);
  });

  test("a landlord reviews a renter nobody has reviewed yet", async ({ page }) => {
    await signUp(page, makeUser("landlord"));
    const kennitala = freshKennitala();
    const name = newPersonName();
    // A landlord has only one kind to choose, so the wizard starts at the kennitala.
    await page.goto("/reviews/new");
    await expect(page.getByRole("heading", { level: 2, name: "Review a renter" })).toBeVisible();
    await expect(
      page.getByText("Enter the renter's kennitala so it's clear who the review is about. Several people can share a name."),
    ).toBeVisible();
    await reviewKennitalaInput(page).fill(kennitala);
    await continueButton(page).click();
    await expect(wizardSubjectHeading(page)).toHaveAccessibleName(NOT_FOUND);
    await subjectNameInput(page).fill(name);
    await confirmCheckbox(page).check();
    const review = makeReview(5, { body: "Looked after the home well and was always considerate to the neighbours." });
    await fillReview(page, review);
    await postButton(page).click();

    await expect(page).toHaveURL(/\/renters\/[0-9a-f-]{36}\?saved=1(#your-review)?$/);
    await expect(formStatus(page)).toHaveText(LIVE);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(noAccountBadge(page)).toBeVisible();
    await expect(page.getByText(`${name}, as rated by their landlords.`)).toBeVisible();
    await expect(reviewCard(page, review.title).getByText("Landlord", { exact: true })).toBeVisible();
    await expect(robotsMeta(page)).toHaveAttribute("content", "noindex, nofollow");
    await expectNoKennitala(page, kennitala);
  });

  test("reviewing someone as a landlord for the first time gives them a landlord page", async ({ page, browser }) => {
    const other = await createActor(browser, "renter");
    expect(other.profilePath).toMatch(/^\/renters\//);
    await signUp(page, makeUser("renter"));
    const review = makeReview(4);
    const path = await writeReviewByKennitala(page, "landlord", { kennitala: other.user.kennitala }, review);
    expect(path).toBe(otherRolePath(other.profilePath));

    // Their page now has both roles, with a tab for each rating.
    await expect(page.getByRole("heading", { level: 1, name: other.user.name })).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Ratings by role" });
    await expect(tabs.getByRole("link", { name: /^As a landlord \(4 stars\s*, 1 review\)$/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(tabs.getByRole("link", { name: "As a renter (no reviews)" })).toHaveAttribute("href", other.profilePath);
    // It's their account, so no "No account" badge.
    await expect(noAccountBadge(page)).toHaveCount(0);

    await other.page.goto("/dashboard");
    await expect(other.page.getByRole("heading", { name: "Reviews about you as a landlord (1)" })).toBeVisible();
    await expect(reviewCard(other.page, review.title)).toBeVisible();
    await other.context.close();
  });

  test("your own kennitala, a child's, and malformed numbers are refused at the first step", async ({ page }) => {
    const renter = makeUser("renter");
    await signUp(page, renter);
    await page.goto("/reviews/new?kind=landlord");
    const field = reviewKennitalaInput(page);

    const cases: [string, string][] = [
      ["", KENNITALA_REQUIRED],
      [NOT_A_KENNITALA, INVALID_KENNITALA],
      [formatKennitala(renter.kennitala), OWN_KENNITALA],
      [freshKennitala("minor"), MINOR],
    ];
    for (const [typed, message] of cases) {
      await field.fill(typed);
      await continueButton(page).click();
      await expect(field, typed).toHaveAccessibleDescription(`${KENNITALA_HINT} ${message}`);
      await expect(formAlert(page)).toHaveText(FIX);
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(field).toBeFocused();
      await expect(field).toHaveValue(typed);
      // Still on the first step.
      await expect(page.getByRole("heading", { level: 2, name: "Review a landlord" })).toBeVisible();
      await expect(wizardSubjectHeading(page)).toHaveCount(0);
      await expect(postButton(page)).toHaveCount(0);
    }
    // Nothing was written.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Reviews you've written (0)" })).toBeVisible();
  });

  test("a kennitala in the review text is refused here too, and nothing is created", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    const kennitala = freshKennitala();
    const name = newPersonName();
    await startReviewByKennitala(page, "landlord", kennitala);
    await subjectNameInput(page).fill(name);
    await confirmCheckbox(page).check();
    const review = makeReview(1, { title: `Ask for ${formatKennitala(kennitala)}` });
    await fillReview(page, review);
    await postButton(page).click();
    await expect(reviewTitleInput(page)).toHaveAccessibleDescription(NO_KENNITALA_IN_TEXT);
    await expect(wizardSubjectHeading(page)).toHaveAccessibleName(NOT_FOUND);
    await expect(subjectNameInput(page)).toHaveValue(name);
    // No page was created for them.
    await page.goto(`/landlords?q=${encodeURIComponent(name)}`);
    await expect(page.getByRole("main").getByRole("link", { name: new RegExp(escapeRegExp(name)) })).toHaveCount(0);
  });

  test("deleting the only review of a page without an account removes that page", async ({ page, browser }) => {
    await signUp(page, makeUser("renter"));
    const name = newPersonName();
    const review = makeReview(3);
    const path = await writeReviewByKennitala(page, "landlord", { kennitala: freshKennitala(), name }, review);

    await clickAndConfirm(page, reviewCard(page, review.title).getByRole("button", { name: "Delete" }));
    // The page is gone, so you land on your dashboard.
    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByRole("heading", { name: "Reviews you've written (0)" })).toBeVisible();

    const visitor = await browser.newContext();
    const visitorPage = await visitor.newPage();
    const response = await visitorPage.goto(path);
    expect(response?.status()).toBe(404);
    await expect(visitorPage.getByRole("heading", { name: NOT_FOUND_PAGE })).toBeVisible();
    await visitorPage.goto(`/landlords?q=${encodeURIComponent(name)}`);
    await expect(
      visitorPage.getByRole("main").getByRole("link", { name: new RegExp(escapeRegExp(name)) }),
    ).toHaveCount(0);
    await visitor.close();
  });
});

test.describe("without JavaScript", () => {
  test("the wizard works with plain form posts", async ({ page, browser }) => {
    await signUp(page, makeUser("renter"));
    const noJs = await withoutJavaScript(browser, page);
    const kennitala = freshKennitala();
    const name = newPersonName();

    await noJs.goto("/reviews/new");
    await noJs.getByRole("main").getByRole("link", { name: "A landlord" }).click();
    await expect(noJs.getByRole("heading", { level: 2, name: "Review a landlord" })).toBeVisible();

    // A mistake comes back with the typed value.
    await reviewKennitalaInput(noJs).fill(NOT_A_KENNITALA);
    await continueButton(noJs).click();
    await expect(reviewKennitalaInput(noJs)).toHaveAccessibleDescription(`${KENNITALA_HINT} ${INVALID_KENNITALA}`);
    await expect(reviewKennitalaInput(noJs)).toHaveValue(NOT_A_KENNITALA);

    await reviewKennitalaInput(noJs).fill(kennitala);
    await continueButton(noJs).click();
    await expect(wizardSubjectHeading(noJs)).toHaveAccessibleName(NOT_FOUND);
    await expect(noJs.getByText(`Kennitala: ${formatKennitala(kennitala)}`, { exact: true })).toBeVisible();

    // Forgetting the confirmation keeps everything typed.
    const review = makeReview(4, { body: "Answered quickly, fixed the heating within a week, fair lease." });
    await subjectNameInput(noJs).fill(name);
    await fillReview(noJs, review);
    await postButton(noJs).click();
    await expect(noJs.getByText(CONFIRM_REQUIRED)).toBeVisible();
    await expect(subjectNameInput(noJs)).toHaveValue(name);
    await expect(starRadio(noJs, 4)).toBeChecked();
    await expect(reviewTitleInput(noJs)).toHaveValue(review.title);
    await expect(reviewBodyInput(noJs)).toHaveValue(review.body);

    await confirmCheckbox(noJs).check();
    await postButton(noJs).click();
    await expect(noJs).toHaveURL(/\/landlords\/[0-9a-f-]{36}\?saved=1(#your-review)?$/);
    await expect(formStatus(noJs)).toHaveText(LIVE);
    await expect(noJs.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(reviewCard(noJs, review.title).getByRole("img", { name: "Rated 4 out of 5 stars" })).toBeVisible();
    await expectNoKennitala(noJs, kennitala);

    // "Start over" is a plain link.
    await noJs.goto("/reviews/new?kind=landlord");
    await reviewKennitalaInput(noJs).fill(DEMO.people.sigrun.kennitala);
    await continueButton(noJs).click();
    await expect(wizardSubjectHeading(noJs)).toHaveAccessibleName(`This kennitala belongs to ${DEMO.people.sigrun.name}`);
    await startOverLink(noJs).click();
    await expect(noJs).toHaveURL("/reviews/new?kind=landlord");
    await expect(reviewKennitalaInput(noJs)).toHaveValue("");
    await noJs.context().close();
  });

  test("the profile page's review form works with plain form posts", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    const noJs = await withoutJavaScript(browser, page);
    await noJs.goto(landlord.profilePath);
    const review = makeReview(5);

    await fillPersonReview(noJs, freshKennitala(), review);
    await postButton(noJs).click();
    await expect(reviewKennitalaInput(noJs)).toHaveAccessibleDescription(`${KENNITALA_HINT} ${MISMATCH}`);
    await expect(starRadio(noJs, 5)).toBeChecked();
    await expect(reviewTitleInput(noJs)).toHaveValue(review.title);

    await reviewKennitalaInput(noJs).fill(landlord.user.kennitala);
    await postButton(noJs).click();
    await expect(formStatus(noJs)).toHaveText(LIVE);
    await expect(reviewCard(noJs, review.title)).toBeVisible();
    await expect(reviewKennitalaInput(noJs)).toHaveCount(0);

    // Editing, then deleting (the confirm dialog needs JavaScript; without it the form just posts).
    await pickStars(noJs, 3);
    await updateButton(noJs).click();
    await expect(formStatus(noJs)).toHaveText(UPDATED);
    await expect(reviewCard(noJs, review.title).getByRole("img", { name: "Rated 3 out of 5 stars" })).toBeVisible();
    await reviewCard(noJs, review.title).getByRole("button", { name: "Delete" }).click();
    await expect(reviewCard(noJs, review.title)).toHaveCount(0);
    await expect(reviewsHeading(noJs, 0)).toBeVisible();
    await noJs.context().close();
    await landlord.context.close();
  });
});

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

test.describe("who can review whom", () => {
  test("visitors who aren't logged in are invited to sign up or log in", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const renter = await createActor(browser, "renter");
    const propertyPath = await addProperty(landlord.page, makeProperty());

    const cases = [
      { path: landlord.profilePath, invite: "Have you rented from this landlord?", signUp: "Sign up as a renter", role: "renter" },
      { path: renter.profilePath, invite: "Have you rented to this renter?", signUp: "Sign up as a landlord", role: "landlord" },
      { path: propertyPath, invite: "Have you lived at this property?", signUp: "Sign up as a renter", role: "renter" },
    ];
    for (const { path, invite, signUp: signUpLabel, role } of cases) {
      await page.goto(path);
      const panel = reviewPanel(page);
      await expect(panel.getByRole("heading", { name: invite })).toBeVisible();
      await expect(panel.getByRole("link", { name: signUpLabel })).toHaveAttribute(
        "href",
        `/signup?role=${role}&next=${encodeURIComponent(path)}`,
      );
      await expect(panel.getByRole("link", { name: "Log in", exact: true })).toHaveAttribute(
        "href",
        `/login?next=${encodeURIComponent(path)}`,
      );
      await expect(postButton(page)).toHaveCount(0);
      await expect(reviewKennitalaInput(page)).toHaveCount(0);
    }
    await landlord.context.close();
    await renter.context.close();
  });

  test("landlords can't review landlords or properties; renters can't review renters", async ({ page, browser }) => {
    const otherLandlord = await createActor(browser, "landlord");
    const otherRenter = await createActor(browser, "renter");
    const propertyPath = await addProperty(otherLandlord.page, makeProperty());

    // As a landlord.
    await signUp(page, makeUser("landlord"));
    await page.goto(otherLandlord.profilePath);
    await expect(page.getByText("Only renters can review landlords.").first()).toHaveText(
      "Only renters can review landlords. If you rent too, add the renter role to your account.",
    );
    // The link remembers this page, for the way back after adding the role.
    await expect(page.getByRole("link", { name: "add the renter role to your account" })).toHaveAttribute(
      "href",
      `/dashboard?next=${encodeURIComponent(otherLandlord.profilePath)}#roles`,
    );
    await expect(postButton(page)).toHaveCount(0);
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(reviewKennitalaInput(page)).toHaveCount(0);

    await page.goto(propertyPath);
    await expect(page.getByText("Only renters can review properties.").first()).toHaveText(
      "Only renters can review properties. If you rent too, add the renter role to your account.",
    );
    await expect(postButton(page)).toHaveCount(0);

    // ...but they can review renters.
    await page.goto(otherRenter.profilePath);
    await expect(postButton(page)).toBeVisible();
    await expect(reviewKennitalaInput(page)).toBeVisible();

    // As a renter.
    await logOut(page);
    await signUp(page, makeUser("renter"));
    await page.goto(otherRenter.profilePath);
    await expect(page.getByText("Only landlords can review renters.").first()).toHaveText(
      "Only landlords can review renters. If you rent out a home too, add the landlord role to your account.",
    );
    await expect(page.getByRole("link", { name: "add the landlord role to your account" })).toHaveAttribute(
      "href",
      `/dashboard?next=${encodeURIComponent(otherRenter.profilePath)}#roles`,
    );
    await expect(postButton(page)).toHaveCount(0);

    await otherLandlord.context.close();
    await otherRenter.context.close();
  });

  test("you can't review yourself or your own property", async ({ page, browser }) => {
    // Landlord on their own profile and their own property.
    const landlord = makeUser("landlord");
    await signUp(page, landlord);
    const landlordPath = await myProfilePath(page);
    await page.goto(landlordPath);
    await expect(
      page.getByText("This is your public profile. Reviews from renters appear here — you can't review yourself."),
    ).toBeVisible();
    await expect(postButton(page)).toHaveCount(0);
    await expect(reviewKennitalaInput(page)).toHaveCount(0);
    await expect(page.getByText("When renters review you, their reviews will show up here.")).toBeVisible();

    await addProperty(page, makeProperty());
    await expect(
      page.getByText("You're the landlord for this property. Reviews from your renters appear here."),
    ).toBeVisible();
    await expect(postButton(page)).toHaveCount(0);

    // Renter on their own profile, and in the wizard with their own number.
    const renter = await createActor(browser, "renter");
    await renter.page.goto(renter.profilePath);
    await expect(
      renter.page.getByText("This is your public profile. Reviews from landlords appear here — you can't review yourself."),
    ).toBeVisible();
    await expect(postButton(renter.page)).toHaveCount(0);
    await startReviewByKennitala(renter.page, "landlord", renter.user.kennitala);
    await expect(reviewKennitalaInput(renter.page)).toHaveAccessibleDescription(`${KENNITALA_HINT} ${OWN_KENNITALA}`);
    await expect(wizardSubjectHeading(renter.page)).toHaveCount(0);

    // Another landlord's number, entered on a renter's page, is still a mismatch, not a way in.
    await renter.page.goto(landlordPath);
    await fillPersonReview(renter.page, renter.user.kennitala, makeReview(1));
    await postButton(renter.page).click();
    await expect(reviewKennitalaInput(renter.page)).toHaveAccessibleDescription(`${KENNITALA_HINT} ${OWN_KENNITALA}`);
    await renter.context.close();
  });

  test("after removing the role you reviewed in, your review stays and can be deleted but not edited", async ({
    page,
    browser,
  }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("both"));
    const review = makeReview(4);
    await postReview(page, landlord.profilePath, review, landlord.user.kennitala);
    const lostRole =
      "You reviewed this landlord as a renter. To edit that review, add the renter role to your account again. You can still delete it from the reviews list.";

    async function removeRenterRole() {
      await page.goto("/dashboard");
      await clickAndConfirm(page, page.getByRole("button", { name: "Remove renter role" }));
      await expect(page.getByText("Done. You're no longer listed as a renter.")).toBeVisible();
    }

    await removeRenterRole();
    await page.goto(landlord.profilePath);
    const panel = reviewPanel(page);
    await expect(panel).toHaveText(lostRole);
    await expect(updateButton(page)).toHaveCount(0);
    await expect(postButton(page)).toHaveCount(0);
    await expect(reviewKennitalaInput(page)).toHaveCount(0);
    // The review is still up.
    await expect(reviewCard(page, review.title)).toBeVisible();
    await expect(reviewsHeading(page, 1)).toBeVisible();

    // The link adds the role back and returns here, where the review can be edited again.
    await panel.getByRole("link", { name: "add the renter role to your account" }).click();
    await expect(page).toHaveURL(`/dashboard?next=${encodeURIComponent(landlord.profilePath)}#roles`);
    await page.getByRole("button", { name: "I'm also a renter" }).click();
    await expect(page.getByText("Done. You're now listed as a renter too.")).toBeVisible();
    await page.getByRole("link", { name: "Back to write your review" }).click();
    await expect(page).toHaveURL(landlord.profilePath);
    await expect(panel.getByRole("heading", { name: "Your review" })).toBeVisible();
    await expect(reviewTitleInput(page)).toHaveValue(review.title);
    await pickStars(page, 5);
    await updateButton(page).click();
    await expect(formStatus(page)).toHaveText(UPDATED);

    // Without the role again, it can still be deleted from the list.
    await removeRenterRole();
    await page.goto(landlord.profilePath);
    await expect(panel).toHaveText(lostRole);
    await clickAndConfirm(page, reviewCard(page, review.title).getByRole("button", { name: "Delete" }));
    await expect(reviewCard(page, review.title)).toHaveCount(0);
    await expect(reviewsHeading(page, 0)).toBeVisible();
    await expect(panel).toHaveText(
      "Only renters can review landlords. If you rent too, add the renter role to your account.",
    );
    await landlord.context.close();
  });

  test("the server enforces the rules even for tampered forms", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const otherRenter = await createActor(browser, "renter");
    await signUp(page, makeUser("renter"));
    const myPath = await myProfilePath(page);
    const myId = myPath.split("/").pop()!;
    const otherRenterId = otherRenter.profilePath.split("/").pop()!;
    const landlordId = landlord.profilePath.split("/").pop()!;

    /** Change the review form's hidden fields on the landlord's page, then post a review with `kennitala`. */
    async function submitTampered(fields: Record<string, string>, kennitala: string = landlord.user.kennitala) {
      await page.goto(landlord.profilePath);
      await page.evaluate((values) => {
        for (const [name, value] of Object.entries(values)) {
          const input = document.querySelector<HTMLInputElement>(`form input[type=hidden][name="${name}"]`);
          if (!input) throw new Error(`no hidden input ${name}`);
          input.value = value;
        }
      }, fields);
      await fillPersonReview(page, kennitala, makeReview(1));
      await postButton(page).click();
    }

    // Reviewing yourself (whatever number is typed).
    await submitTampered({ subjectId: myId });
    await expect(formAlert(page)).toHaveText("You can't review yourself.");

    // A renter reviewing a renter.
    await submitTampered({ kind: "renter", subjectId: otherRenterId }, otherRenter.user.kennitala);
    await expect(formAlert(page)).toHaveText("Only landlords can review renters.");

    // A "landlord" review of someone else's page with the landlord's number: it doesn't match that page.
    await submitTampered({ subjectId: otherRenterId });
    await expect(reviewKennitalaInput(page)).toHaveAccessibleDescription(`${KENNITALA_HINT} ${MISMATCH}`);

    // A profile that doesn't exist.
    await submitTampered({ subjectId: randomUUID() });
    await expect(formAlert(page)).toHaveText("That landlord no longer exists.");

    // A "property" review of something that isn't a property.
    await submitTampered({ kind: "property", subjectId: landlordId });
    await expect(formAlert(page)).toHaveText("That property no longer exists.");

    // Not an id at all.
    await submitTampered({ subjectId: "not-a-uuid" });
    await expect(formAlert(page)).toHaveText(FIX);

    // None of these created a review anywhere, or gave anyone a new role.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Reviews you've written (0)" })).toBeVisible();
    await otherRenter.page.goto("/dashboard");
    await expect(otherRenter.page.getByRole("heading", { name: "Reviews about you (0)" })).toBeVisible();
    await landlord.page.goto("/dashboard");
    await expect(landlord.page.getByRole("heading", { name: "Reviews about you (0)" })).toBeVisible();
    await page.goto(otherRolePath(otherRenter.profilePath));
    await expect(page).toHaveURL(otherRenter.profilePath);

    await landlord.context.close();
    await otherRenter.context.close();
  });
});

// ---------------------------------------------------------------------------
// Review cards and ratings
// ---------------------------------------------------------------------------

test.describe("review cards", () => {
  test("every card shows the rating as N/5 next to the stars", async ({ page }) => {
    await page.goto("/");
    const cards = page.getByRole("region", { name: "Latest reviews" }).locator("article");
    await expect(cards).toHaveCount(6);
    for (const card of await cards.all()) {
      const label = await card.getByRole("img", { name: /^Rated [1-5] out of 5 stars$/ }).getAttribute("aria-label");
      const stars = label!.match(/Rated (\d)/)![1];
      await expect(card.getByText(`${stars}/5`, { exact: true })).toBeVisible();
    }
  });

  test("other people's reviews have a Report link; your own have Edit and Delete instead", async ({
    page,
    browser,
  }) => {
    const landlord = await createActor(browser, "landlord");
    const first = await createActor(browser, "renter");
    const theirs = makeReview(4);
    await postReview(first.page, landlord.profilePath, theirs, landlord.user.kennitala);
    await signUp(page, makeUser("renter"));
    const mine = makeReview(2);
    await postReview(page, landlord.profilePath, mine, landlord.user.kennitala);
    const theirId = await reviewIdOf(reviewCard(page, theirs.title));
    const myId = await reviewIdOf(reviewCard(page, mine.title));

    // As one of the authors.
    const myCard = reviewCard(page, mine.title);
    await expect(myCard.getByRole("link", { name: "Edit" })).toBeVisible();
    await expect(myCard.getByRole("button", { name: "Delete" })).toBeVisible();
    await expect(myCard.getByRole("link", { name: "Report" })).toHaveCount(0);
    const theirCard = reviewCard(page, theirs.title);
    await expect(theirCard.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await expect(theirCard.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(theirCard.getByRole("link", { name: "Report", exact: true })).toHaveAttribute(
      "href",
      `/report?target=review&id=${theirId}`,
    );
    // Report links aren't for search engines to follow.
    await expect(theirCard.getByRole("link", { name: "Report", exact: true })).toHaveAttribute("rel", "nofollow");

    // As the landlord they're about, and as a visitor: Report on both, no controls.
    const visitor = await browser.newContext();
    const viewers = [landlord.page, await visitor.newPage()];
    for (const viewer of viewers) {
      await viewer.goto(landlord.profilePath);
      for (const [title, id] of [
        [mine.title, myId],
        [theirs.title, theirId],
      ]) {
        const card = reviewCard(viewer, title);
        await expect(card.getByRole("link", { name: "Report", exact: true })).toHaveAttribute(
          "href",
          `/report?target=review&id=${id}`,
        );
        await expect(card.getByRole("button", { name: "Delete" })).toHaveCount(0);
        await expect(card.getByRole("link", { name: "Edit" })).toHaveCount(0);
        await expect(card.getByText("You", { exact: true })).toHaveCount(0);
      }
    }

    // The link opens the report form for that review.
    await viewers[1].getByRole("link", { name: "Report", exact: true }).first().click();
    await expect(viewers[1]).toHaveURL(/\/report\?target=review&id=[0-9a-f-]{36}$/);
    await expect(viewers[1].getByRole("heading", { level: 1, name: "Report a problem" })).toBeVisible();
    await expect(viewers[1].getByRole("main")).toContainText(mine.title);

    await visitor.close();
    await landlord.context.close();
    await first.context.close();
  });

  test("nobody can delete a review about themselves, not even with a tampered form", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const renter = makeUser("renter");
    await signUp(page, renter);
    const renterPath = await myProfilePath(page);
    const aboutLandlord = makeReview(1);
    await postReview(page, landlord.profilePath, aboutLandlord, landlord.user.kennitala);
    const aboutLandlordId = await reviewIdOf(reviewCard(page, aboutLandlord.title));
    // The landlord reviews the renter back, so they have a delete form of their own.
    const aboutRenter = makeReview(3);
    await postReview(landlord.page, renterPath, aboutRenter, renter.kennitala);

    // No control for it on their page or their dashboard.
    for (const path of [landlord.profilePath, "/dashboard"]) {
      await landlord.page.goto(path);
      const card = reviewCard(landlord.page, aboutLandlord.title);
      await expect(card, path).toBeVisible();
      await expect(card.getByRole("button", { name: "Delete" })).toHaveCount(0);
      await expect(card.getByRole("link", { name: "Edit" })).toHaveCount(0);
      await expect(card.getByRole("link", { name: "Report", exact: true })).toBeVisible();
    }
    await expect(landlord.page.getByText(CANT_REMOVE)).toBeVisible();

    // Pointing their own review's delete form at it does nothing.
    const ownDelete = reviewCard(landlord.page, aboutRenter.title).locator("form");
    await ownDelete.locator('input[name="reviewId"]').evaluate((input, id) => {
      (input as HTMLInputElement).value = id;
    }, aboutLandlordId);
    const deleteRequest = landlord.page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/dashboard",
    );
    await clickAndConfirm(landlord.page, ownDelete.getByRole("button", { name: "Delete" }));
    expect((await deleteRequest).ok()).toBe(true);
    await landlord.page.reload();
    await expect(reviewCard(landlord.page, aboutLandlord.title)).toBeVisible();
    await expect(reviewCard(landlord.page, aboutRenter.title)).toBeVisible();
    await expect(landlord.page.getByRole("heading", { name: "Reviews about you (1)" })).toBeVisible();
    await page.goto(landlord.profilePath);
    await expect(reviewsHeading(page, 1)).toBeVisible();
    await landlord.context.close();
  });
});

test.describe("rating summaries", () => {
  test("someone with both roles has a separate rating for each", async ({ page, browser }) => {
    const person = await createActor(browser, "both");
    expect(person.profilePath).toMatch(/^\/landlords\//);
    const landlordPath = person.profilePath;
    const renterPath = otherRolePath(landlordPath);

    // A renter reviews them as a landlord on their page…
    const renter = await createActor(browser, "renter");
    const asLandlord = makeReview(5);
    await postReview(renter.page, landlordPath, asLandlord, person.user.kennitala);
    // …and a landlord reviews them as a renter through /reviews/new.
    await signUp(page, makeUser("landlord"));
    const asRenter = makeReview(2);
    const path = await writeReviewByKennitala(page, "renter", { kennitala: person.user.kennitala }, asRenter);
    expect(path).toBe(renterPath);

    await page.goto(landlordPath);
    const tabs = page.getByRole("navigation", { name: "Ratings by role" });
    await expect(tabs.getByRole("link", { name: /^As a landlord \(5 stars\s*, 1 review\)$/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(tabs.getByRole("link", { name: /^As a renter \(2 stars\s*, 1 review\)$/ })).toHaveAttribute(
      "href",
      renterPath,
    );
    await expect(page.getByRole("heading", { name: `${person.user.name}'s rating as a landlord` })).toBeVisible();
    await expect(summaryAverage(page)).toHaveText("5");
    await expect(summaryCount(page)).toHaveText("1 review");
    await expect(reviewsHeading(page, 1, "Reviews as a landlord")).toBeVisible();
    await expect(reviewCard(page, asLandlord.title)).toBeVisible();
    await expect(reviewCard(page, asRenter.title)).toHaveCount(0);

    await tabs.getByRole("link", { name: /^As a renter/ }).click();
    await expect(page).toHaveURL(renterPath);
    await expect(page.getByRole("heading", { name: `${person.user.name}'s rating as a renter` })).toBeVisible();
    await expect(summaryAverage(page)).toHaveText("2");
    await expect(reviewsHeading(page, 1, "Reviews as a renter")).toBeVisible();
    await expect(page.getByText(`${person.user.name}, as rated by their landlords.`)).toBeVisible();
    await expect(reviewCard(page, asRenter.title)).toBeVisible();
    await expect(reviewCard(page, asLandlord.title)).toHaveCount(0);

    // Each directory shows the rating for its role.
    await page.goto(`/landlords?q=${encodeURIComponent(person.user.name)}`);
    await expect(page.getByRole("link", { name: new RegExp(escapeRegExp(person.user.name)) })).toContainText(
      "5 · 1 review",
    );
    await page.goto(`/renters?q=${encodeURIComponent(person.user.name)}`);
    await expect(page.getByRole("link", { name: new RegExp(escapeRegExp(person.user.name)) })).toContainText(
      "2 · 1 review",
    );

    // Their dashboard has a section (and a rating) per role.
    await person.page.goto("/dashboard");
    await expect(person.page.getByRole("heading", { name: "Reviews about you as a landlord (1)" })).toBeVisible();
    await expect(person.page.getByRole("heading", { name: "Reviews about you as a renter (1)" })).toBeVisible();
    await expect(summaryAverage(person.page)).toHaveText(["5", "2"]);

    await person.context.close();
    await renter.context.close();
  });
});

// ---------------------------------------------------------------------------
// Icelandic
// ---------------------------------------------------------------------------

test.describe("in Icelandic", () => {
  test("the review form and the wizard speak Icelandic", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    await setLanguage(page.context(), "is");

    // The profile page form, with a wrong kennitala first.
    await page.goto(landlord.profilePath);
    await expect(page.locator("html")).toHaveAttribute("lang", "is");
    const panel = reviewPanel(page);
    await expect(panel.getByRole("heading", { name: `Skrifa umsögn: ${landlord.user.name}` })).toBeVisible();
    const kennitala = page.getByRole("textbox", { name: "Kennitala leigusala" });
    await kennitala.fill(freshKennitala());
    await page.locator("label").filter({ has: page.getByRole("radio", { name: "4 stjörnur (Gott)" }) }).click();
    const review = makeReview(4);
    await page.getByLabel("Fyrirsögn").fill(review.title);
    await page.getByLabel("Umsögnin þín", { exact: true }).fill(review.body);
    await page.getByRole("button", { name: "Birta umsögn" }).click();
    await expect(formAlert(page)).toHaveText("Lagaðu merktu reitina.");
    await expect(
      panel.getByText(
        "Kennitalan passar ekki við þessa síðu. Nöfn eru ekki einstök, svo athugaðu hvort þú sért á réttri síðu.",
      ),
    ).toBeVisible();
    await kennitala.fill(landlord.user.kennitala);
    await page.getByRole("button", { name: "Birta umsögn" }).click();
    await expect(formStatus(page)).toHaveText("Takk! Umsögnin þín er komin á vefinn.");
    await expect(panel.getByRole("heading", { name: "Umsögnin þín" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Uppfæra umsögn" })).toBeVisible();
    await expect(reviewCard(page, review.title).getByRole("img", { name: "Einkunn 4 af 5" })).toBeVisible();

    // The wizard, for a kennitala nobody has yet.
    const name = newPersonName();
    const someone = freshKennitala();
    await page.goto("/reviews/new");
    await expect(page.getByRole("heading", { level: 1, name: "Skrifa umsögn" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Um hvern viltu skrifa?" })).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "Leigusala" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Umsögn um leigusala" })).toBeVisible();
    await page.getByRole("textbox", { name: "Kennitala leigusala" }).fill(someone);
    await page.getByRole("button", { name: "Áfram", exact: true }).click();
    await expect(page.getByRole("heading", { level: 3 })).toHaveAccessibleName(
      "Þessi kennitala er ekki enn á GossipRent. Umsögnin þín býr til síðu fyrir viðkomandi.",
    );
    await expect(page.getByText(`Kennitala: ${formatKennitala(someone)}`, { exact: true })).toBeVisible();
    await expect(page.getByText(/^Fæðingardagur: /)).toBeVisible();
    await page.getByRole("textbox", { name: "Fullt nafn" }).fill(name);
    await page.getByRole("checkbox", { name: "Ég hef gengið úr skugga um að kennitalan sé rétt" }).check();
    await page.locator("label").filter({ has: page.getByRole("radio", { name: "5 stjörnur (Frábært)" }) }).click();
    const second = makeReview(5);
    await page.getByLabel("Fyrirsögn").fill(second.title);
    await page.getByLabel("Umsögnin þín", { exact: true }).fill(second.body);
    await expect(page.getByText("Röng kennitala? Byrja aftur")).toBeVisible();
    await page.getByRole("button", { name: "Birta umsögn" }).click();
    await expect(page).toHaveURL(/\/landlords\/[0-9a-f-]{36}\?saved=1(#your-review)?$/);
    await expect(formStatus(page)).toHaveText("Takk! Umsögnin þín er komin á vefinn.");
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByRole("main").locator("h1 ~ span").filter({ hasText: /^Án aðgangs$/ })).toBeVisible();

    // An existing kennitala is named after a colon.
    await page.goto("/reviews/new?kind=landlord");
    await page.getByRole("textbox", { name: "Kennitala leigusala" }).fill(DEMO.people.sigrun.kennitala);
    await page.getByRole("button", { name: "Áfram", exact: true }).click();
    await expect(page.getByRole("heading", { level: 3 })).toHaveAccessibleName(
      `Þessi kennitala tilheyrir: ${DEMO.people.sigrun.name}`,
    );
    await landlord.context.close();
  });
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

test.describe("long text on a phone (390px wide)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("a long URL or unbroken word in a review doesn't make the page scroll sideways", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const renter = makeUser("renter");
    await signUp(page, renter);
    const id = uid();
    const url = `https://example.com/${"very-long-path-segment-without-spaces".repeat(8)}?ref=${id}`;
    const title = `Headline${"x".repeat(80)}${id}`.slice(0, 120);
    await page.goto(landlord.profilePath);
    await fillPersonReview(page, landlord.user.kennitala, { stars: 3, title, body: `See ${url} for the photos of the mould.` });
    await postButton(page).click();
    await expect(formStatus(page)).toHaveText(LIVE);
    await expect(reviewCard(page, url)).toBeVisible();

    for (const path of [landlord.profilePath, "/", "/dashboard"]) {
      await page.goto(path);
      await expect(reviewCard(page, url).first()).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.scrollingElement!.scrollWidth);
      expect(scrollWidth, path).toBeLessThanOrEqual(390);
      // The card itself fits on screen.
      const box = await reviewCard(page, url).first().boundingBox();
      expect(box!.x + box!.width, path).toBeLessThanOrEqual(390);
    }
    await landlord.page.goto("/dashboard");
    await landlord.page.setViewportSize({ width: 390, height: 844 });
    await expect(reviewCard(landlord.page, url)).toBeVisible();
    expect(await landlord.page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(390);
    await landlord.context.close();
  });

  test("a button near the top jumps to the review form, then to your review", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    const property = makeProperty();
    const propertyPath = await addProperty(landlord.page, property);

    await page.goto(landlord.profilePath);
    const jump = page.getByRole("main").getByRole("link", { name: `Review ${landlord.user.name}` });
    await expect(jump).toHaveAttribute("href", "#your-review");
    await jump.click();
    await expect(page).toHaveURL(`${landlord.profilePath}#your-review`);
    await expect(reviewKennitalaInput(page)).toBeInViewport();
    const review = makeReview(4);
    await fillPersonReview(page, landlord.user.kennitala, review);
    await postButton(page).click();
    await expect(formStatus(page)).toHaveText(LIVE);
    await expect(page.getByRole("main").getByRole("link", { name: "Edit your review" })).toHaveAttribute(
      "href",
      "#your-review",
    );
    expect(await pageWidth(page)).toBeLessThanOrEqual(390);

    await page.goto(propertyPath);
    await page.getByRole("main").getByRole("link", { name: "Review this property" }).click();
    await expect(reviewTitleInput(page)).toBeInViewport();
    await fillReview(page, makeReview(3));
    await postButton(page).click();
    await expect(formStatus(page)).toHaveText(LIVE);
    await expect(page.getByRole("main").getByRole("link", { name: "Edit your review" })).toBeVisible();
    await landlord.context.close();
  });

  test("the wizard fits on a phone, with a long name for a new page", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    const name = `Gervi ${"Langtnafnánbils".repeat(4)}${nameToken()}`.slice(0, 80);
    await startReviewByKennitala(page, "landlord", freshKennitala());
    await expect(wizardSubjectHeading(page)).toHaveAccessibleName(NOT_FOUND);
    expect(await pageWidth(page)).toBeLessThanOrEqual(390);
    await subjectNameInput(page).fill(name);
    await confirmCheckbox(page).check();
    await fillReview(page, makeReview(4));
    await postButton(page).click();
    await expect(formStatus(page)).toHaveText(LIVE);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    expect(await pageWidth(page)).toBeLessThanOrEqual(390);
  });

  test("a long URL in a property description doesn't overflow the property page", async ({ page, browser }) => {
    await signUp(page, makeUser("renter"));
    const property = makeProperty({ description: `Photos: https://example.com/${"gallery-".repeat(25)}${uid()}` });
    const path = await addProperty(page, property);
    await page.goto(path);
    await expect(page.getByText(property.description!)).toBeVisible();
    expect(await pageWidth(page)).toBeLessThanOrEqual(390);

    const visitor = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const visitorPage = await visitor.newPage();
    await visitorPage.goto(path);
    await expect(visitorPage.getByText(property.description!)).toBeVisible();
    expect(await pageWidth(visitorPage)).toBeLessThanOrEqual(390);
    await visitor.close();
  });

  const LONG_TOWN = "Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch";

  // Regression: a company name like "SunbeltPropertyManagementGroup", a real
  // town such as "Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch",
  // or a long unbroken address token used to make pages scroll sideways.
  test("a long single-word name, city, or address doesn't make pages scroll sideways", async ({ page, browser }) => {
    const user = makeUser("landlord", { name: "SunbeltPropertyManagementGroup", city: LONG_TOWN });
    await signUp(page, user);
    const profile = await myProfilePath(page);
    const property = makeProperty({ address: `${"Unbrokenstreetnamewithoutanyspaces".repeat(2)}${uid()}` });
    const propertyPath = await addProperty(page, property);
    const targets = [
      profile,
      "/dashboard",
      propertyPath,
      `/search?q=${encodeURIComponent(LONG_TOWN)}`,
      `/search?q=${encodeURIComponent(property.address)}`,
      // Directory cards with the long name, city, and address (short queries).
      "/landlords?q=Sunbelt",
      "/properties?q=Unbrokenstreetname",
    ];
    for (const target of targets) {
      await page.goto(target);
      await expect(page.getByRole("heading", { level: 1 }).first(), target).toBeVisible();
      expect(await pageWidth(page), target).toBeLessThanOrEqual(390);
    }
    // What a renter and a signed-out visitor see (the review panel's heading names the subject).
    const renter = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const renterPage = await renter.newPage();
    await signUp(renterPage, makeUser("renter"));
    const visitor = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const visitorPage = await visitor.newPage();
    for (const viewer of [renterPage, visitorPage]) {
      for (const target of [profile, propertyPath]) {
        await viewer.goto(target);
        await expect(viewer.getByRole("heading", { level: 1 }).first(), target).toBeVisible();
        expect(await pageWidth(viewer), target).toBeLessThanOrEqual(390);
      }
    }
    await renter.close();
    await visitor.close();
  });

  test("a long one-word search doesn't make the directories scroll sideways", async ({ page }) => {
    const user = makeUser("landlord", { city: LONG_TOWN });
    await signUp(page, user);
    const property = makeProperty({ address: `${"Unbrokenstreetnamewithoutanyspaces".repeat(2)}${uid()}` });
    await addProperty(page, property);
    for (const target of [
      `/landlords?q=${encodeURIComponent(LONG_TOWN)}`,
      `/renters?q=${encodeURIComponent(LONG_TOWN)}`,
      `/properties?q=${encodeURIComponent(property.address)}`,
      `/properties?q=${encodeURIComponent("x".repeat(100))}`,
    ]) {
      await page.goto(target);
      await expect(page.getByRole("heading", { level: 1 }).first(), target).toBeVisible();
      expect(await pageWidth(page), target).toBeLessThanOrEqual(390);
    }
  });
});

async function pageWidth(page: Page): Promise<number> {
  return page.evaluate(() => document.scrollingElement!.scrollWidth);
}
