import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  clickAndConfirm,
  createActor,
  DEMO,
  fillSignup,
  findPersonPath,
  findPropertyPath,
  formAlert,
  formatKennitala,
  formStatus,
  freshKennitala,
  logInAs,
  makeReview,
  makeUser,
  postReview,
  propertyLabel,
  propertyPlace,
  reviewCard,
  setLanguage,
  signUp,
} from "./helpers";

/*
 * Reporting a review, a profile, a property, or "someone has an account with
 * my kennitala" (/report), and the privacy page. Reports are only read by the
 * people who run the site; nothing on the site changes when one is sent.
 */

const SENT = "Thanks. We'll look into it.";
const CANT_REPORT = "This can't be reported.";

const REASONS = {
  wrong_person: "It's about the wrong person",
  wrong_name: "The name is wrong",
  false_or_abusive: "It's false, abusive or defamatory",
  personal_data: "It shares personal information (e.g. health, debts, a kennitala or a phone number)",
  identity_claimed: "Someone else has an account with my kennitala",
  other: "Something else",
} as const;

/** The reasons each kind of report offers, in order, after "Choose a reason". */
const REASONS_FOR = {
  review: [REASONS.false_or_abusive, REASONS.personal_data, REASONS.wrong_person, REASONS.other],
  profile: [REASONS.wrong_name, REASONS.wrong_person, REASONS.identity_claimed, REASONS.personal_data, REASONS.other],
  property: [REASONS.wrong_person, REASONS.personal_data, REASONS.false_or_abusive, REASONS.other],
  account: [REASONS.identity_claimed, REASONS.other],
} as const;

function reasonSelect(page: Page): Locator {
  return page.getByRole("combobox", { name: "Reason" });
}

function detailsInput(page: Page): Locator {
  return page.getByRole("textbox", { name: "What's wrong?" });
}

/** "Your email" when signed out, "Email for a reply (optional)" when signed in. */
function emailInput(page: Page): Locator {
  return page.getByRole("textbox", { name: /^(Your email|Email for a reply \(optional\))$/ });
}

function sendButton(page: Page): Locator {
  return page.getByRole("button", { name: "Send report" });
}

/** The "What you're reporting" box. */
function subjectBox(page: Page): Locator {
  return page.getByRole("region", { name: "What you're reporting" });
}

/** The box's rows as [label, value] pairs, e.g. [["Review", "“Great”"], ["Landlord", "Sigrún Helgadóttir"]]. */
async function subjectRows(page: Page): Promise<string[][]> {
  return subjectBox(page)
    .locator("dl > div")
    .evaluateAll((rows) =>
      rows.map((row) => [
        row.querySelector("dt")!.textContent!.trim(),
        (row.querySelector("dd") as HTMLElement).innerText.trim(),
      ]),
    );
}

/** Expect the report form for `target` (offering its reasons) about the thing in `rows`. */
async function expectReportPage(
  page: Page,
  target: keyof typeof REASONS_FOR,
  rows: string[][],
  viewHref: string | null,
): Promise<void> {
  await expect(page).toHaveTitle("Report a problem · GossipRent");
  await expect(page.getByRole("heading", { level: 1, name: "Report a problem" })).toBeVisible();
  await expect(
    page.getByText(
      "Tell us what's wrong. Reports are only read by the people who run GossipRent and are never shown on the site.",
      { exact: true },
    ),
  ).toBeVisible();
  // Report pages aren't for search engines.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  expect(await subjectRows(page)).toEqual(rows);
  const view = subjectBox(page).getByRole("link", { name: "View the page" });
  if (viewHref) await expect(view).toHaveAttribute("href", viewHref);
  else await expect(view).toHaveCount(0);
  await expect(reasonSelect(page).locator("option")).toHaveText(["Choose a reason", ...REASONS_FOR[target]]);
}

/** Fill the report form. Leaves the email alone unless one is given. */
async function fillReport(page: Page, report: { reason?: string; details?: string; email?: string }): Promise<void> {
  if (report.reason !== undefined) await reasonSelect(page).selectOption({ label: report.reason });
  if (report.details !== undefined) await detailsInput(page).fill(report.details);
  if (report.email !== undefined) await emailInput(page).fill(report.email);
}

/** The id in a review card's `id="review-<uuid>"`. */
async function reviewIdOf(card: Locator): Promise<string> {
  const id = await card.getAttribute("id");
  expect(id).toMatch(/^review-[0-9a-f-]{36}$/);
  return id!.slice("review-".length);
}

function idOf(path: string): string {
  return path.split("/").pop()!;
}

function reportThisPage(page: Page): Locator {
  return page.getByRole("main").getByRole("link", { name: "Report this page", exact: true });
}

// ---------------------------------------------------------------------------
// Report links
// ---------------------------------------------------------------------------

test.describe("report links", () => {
  test("profiles, properties and every review card link to the report form for that thing", async ({ page }) => {
    const { sigrun, eva, gunnar } = DEMO.people;
    const sigrunPath = await findPersonPath(page, "landlord", sigrun.name);

    // A profile.
    await page.goto(sigrunPath);
    await expect(reportThisPage(page)).toHaveAttribute("href", `/report?target=profile&id=${idOf(sigrunPath)}`);
    await expect(reportThisPage(page)).toHaveAttribute("rel", "nofollow");
    await reportThisPage(page).click();
    await expect(page).toHaveURL(`/report?target=profile&id=${idOf(sigrunPath)}`);
    await expectReportPage(page, "profile", [["Profile", sigrun.name]], sigrunPath);

    // A review of a landlord, from its card.
    await page.goto(sigrunPath);
    const evasReview = reviewCard(page, "Sanngjörn og fljót að svara");
    const reviewId = await reviewIdOf(evasReview);
    const report = evasReview.getByRole("link", { name: "Report", exact: true });
    await expect(report).toHaveAttribute("href", `/report?target=review&id=${reviewId}`);
    await report.click();
    await expect(page).toHaveURL(`/report?target=review&id=${reviewId}`);
    await expectReportPage(
      page,
      "review",
      [
        ["Review", "“Sanngjörn og fljót að svara”"],
        ["Landlord", sigrun.name],
      ],
      sigrunPath,
    );
    await subjectBox(page).getByRole("link", { name: "View the page" }).click();
    await expect(page).toHaveURL(sigrunPath);

    // A review of a renter.
    const evaPath = await findPersonPath(page, "renter", eva.name);
    await page.goto(evaPath);
    await reviewCard(page, "Til fyrirmyndar").getByRole("link", { name: "Report", exact: true }).click();
    await expect(page).toHaveURL(/\/report\?target=review&id=[0-9a-f-]{36}$/);
    await expectReportPage(
      page,
      "review",
      [
        ["Review", "“Til fyrirmyndar”"],
        ["Renter", eva.name],
      ],
      evaPath,
    );

    // A property, and a review of it.
    const njalsgata = DEMO.properties.njalsgata;
    const address = `${propertyLabel(njalsgata)}\n${propertyPlace(njalsgata)}`;
    const propertyPath = await findPropertyPath(page, njalsgata.address, propertyLabel(njalsgata));
    await page.goto(propertyPath);
    await reportThisPage(page).click();
    await expect(page).toHaveURL(`/report?target=property&id=${idOf(propertyPath)}`);
    await expectReportPage(page, "property", [["Property", address]], propertyPath);
    await page.goto(propertyPath);
    await reviewCard(page, "Björt íbúð í hjarta bæjarins").getByRole("link", { name: "Report", exact: true }).click();
    await expectReportPage(
      page,
      "review",
      [
        ["Review", "“Björt íbúð í hjarta bæjarins”"],
        ["Property", address],
      ],
      propertyPath,
    );

    // A profile without an account can be reported too.
    const gunnarPath = await findPersonPath(page, "landlord", gunnar.name);
    await page.goto(gunnarPath);
    await reportThisPage(page).click();
    await expectReportPage(page, "profile", [["Profile", gunnar.name]], gunnarPath);

    // The home page's latest reviews.
    await page.goto("/");
    const latest = page.getByRole("region", { name: "Latest reviews" }).locator("article");
    await expect(latest).toHaveCount(6);
    for (const card of await latest.all()) {
      await expect(card.getByRole("link", { name: "Report", exact: true })).toHaveAttribute(
        "href",
        `/report?target=review&id=${await reviewIdOf(card)}`,
      );
    }
  });

  test("your own reviews have Edit and Delete instead of Report", async ({ page }) => {
    const sigrunPath = await findPersonPath(page, "landlord", DEMO.people.sigrun.name);
    await logInAs(page, "eva");
    await page.goto(sigrunPath);
    const mine = reviewCard(page, "Sanngjörn og fljót að svara");
    await expect(mine.getByText("You", { exact: true })).toBeVisible();
    await expect(mine.getByRole("link", { name: "Edit" })).toBeVisible();
    await expect(mine.getByRole("button", { name: "Delete" })).toBeVisible();
    await expect(mine.getByRole("link", { name: "Report", exact: true })).toHaveCount(0);
    const theirs = reviewCard(page, "Góð samskipti og skýr samningur");
    await expect(theirs.getByRole("link", { name: "Report", exact: true })).toBeVisible();
    await expect(theirs.getByRole("link", { name: "Edit" })).toHaveCount(0);
  });

  test("“Not you? Report it” after a refused sign-up leads to the account report", async ({ page }) => {
    await page.goto("/signup");
    await fillSignup(page, makeUser("renter", { kennitala: formatKennitala(DEMO.people.jon.kennitala) }));
    await expect(page.getByText("This kennitala already has an account.", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Not you? Report it" }).click();
    await expect(page).toHaveURL("/report?target=account");
    await expectReportPage(
      page,
      "account",
      [["Account", "For example, someone else has signed up with your kennitala."]],
      null,
    );
    // The likely reason is already picked, and the hint says what to include.
    await expect(reasonSelect(page)).toHaveValue("identity_claimed");
    await expect(detailsInput(page)).toHaveAccessibleDescription(
      "Give your name and kennitala so we can find the account.",
    );
  });
});

// ---------------------------------------------------------------------------
// Sending a report
// ---------------------------------------------------------------------------

test.describe("sending a report", () => {
  test("signed out, it needs an email address; every problem shows at once", async ({ page }) => {
    const sigrunPath = await findPersonPath(page, "landlord", DEMO.people.sigrun.name);
    await page.goto(sigrunPath);
    await reviewCard(page, "Góð samskipti og skýr samningur").getByRole("link", { name: "Report", exact: true }).click();
    await expect(page).toHaveURL(/\/report\?target=review&id=[0-9a-f-]{36}$/);
    const reportUrl = page.url();

    // Signed out, the email is required (no "(optional)") and explained.
    await expect(emailInput(page)).toHaveAccessibleName("Your email");
    await expect(emailInput(page)).toHaveAccessibleDescription("So we can reply to you. It's never shown.");
    await expect(detailsInput(page)).toHaveAccessibleName("What's wrong?");
    await expect(detailsInput(page)).toHaveAttribute("maxlength", "2000");

    await sendButton(page).click();
    await expect(formAlert(page)).toHaveText("Please fix the highlighted fields.");
    const main = page.getByRole("main");
    for (const message of ["Choose a reason.", "Describe the problem.", "Enter your email address so we can reply."]) {
      await expect(main.getByText(message, { exact: true })).toBeVisible();
    }
    await expect(reasonSelect(page)).toBeFocused();

    // Only the email missing: what was entered is kept.
    const details = "The review mentions my neighbour by name.";
    await fillReport(page, { reason: REASONS.personal_data, details });
    await sendButton(page).click();
    await expect(main.getByText("Enter your email address so we can reply.", { exact: true })).toBeVisible();
    await expect(main.getByText("Choose a reason.", { exact: true })).toHaveCount(0);
    await expect(reasonSelect(page)).toHaveValue("personal_data");
    await expect(detailsInput(page)).toHaveValue(details);
    await expect(emailInput(page)).toBeFocused();

    await emailInput(page).fill("not-an-email");
    await sendButton(page).click();
    await expect(main.getByText("Enter a valid email address.", { exact: true })).toBeVisible();
    await expect(emailInput(page)).toHaveValue("not-an-email");

    await emailInput(page).fill("  Reporter@Example.com ");
    await sendButton(page).click();
    await expect(formStatus(page)).toHaveText(SENT);
    await expect(formStatus(page)).toBeFocused();
    await expect(sendButton(page)).toHaveCount(0);
    // Sent by POST: nothing about it in the address.
    expect(page.url()).toBe(reportUrl);

    // "← Go back" returns to the page the review is on. A report changes nothing there.
    await main.getByRole("link", { name: "← Go back" }).click();
    await expect(page).toHaveURL(sigrunPath);
    await expect(reviewCard(page, "Góð samskipti og skýr samningur")).toBeVisible();
  });

  test("signed in, the email is optional", async ({ page }) => {
    const gunnarPath = await findPersonPath(page, "landlord", DEMO.people.gunnar.name);
    await logInAs(page, "kari");
    await page.goto(gunnarPath);
    await reportThisPage(page).click();
    await expect(emailInput(page)).toHaveAccessibleName("Email for a reply (optional)");
    await expect(emailInput(page)).toHaveAccessibleDescription(
      "Leave it empty to get the reply at your account's email.",
    );
    await fillReport(page, { reason: REASONS.wrong_name, details: "His middle name is spelled wrong." });
    await sendButton(page).click();
    await expect(formStatus(page)).toHaveText(SENT);
    await page.getByRole("main").getByRole("link", { name: "← Go back" }).click();
    await expect(page).toHaveURL(gunnarPath);
    // Nothing on the page changes because of a report.
    await expect(page.getByRole("heading", { level: 1, name: DEMO.people.gunnar.name })).toBeVisible();
  });

  test("details are required, at most 2,000 characters, and may name a kennitala", async ({ page }) => {
    await page.goto("/report?target=account");
    await fillReport(page, { details: "   ", email: "someone@example.com" });
    await sendButton(page).click();
    await expect(page.getByText("Describe the problem.", { exact: true })).toBeVisible();
    // The reason stays picked after an error.
    await expect(reasonSelect(page)).toHaveValue("identity_claimed");

    // The browser stops at 2,000 characters; the server checks too.
    await detailsInput(page).evaluate((textarea) => textarea.removeAttribute("maxlength"));
    await detailsInput(page).fill("x".repeat(2001));
    await sendButton(page).click();
    await expect(page.getByText("Must be 2,000 characters or fewer.", { exact: true })).toBeVisible();

    // Someone whose kennitala was used to sign up has to say which one.
    const mine = formatKennitala(freshKennitala());
    await detailsInput(page).fill(`Someone signed up with my kennitala, ${mine}. ${"x".repeat(1900)}`);
    await sendButton(page).click();
    await expect(formStatus(page)).toHaveText(SENT);
    await expect(page.getByRole("main").getByRole("link", { name: "← Go back" })).toHaveAttribute("href", "/");
  });

  test("works without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const propertyPath = await findPropertyPath(page, "Hamraborg", propertyLabel(DEMO.properties.hamraborg));
    await page.goto(propertyPath);
    await reportThisPage(page).click();
    await sendButton(page).click();
    await expect(page.getByText("Choose a reason.", { exact: true })).toBeVisible();
    await expect(page.getByText("Enter your email address so we can reply.", { exact: true })).toBeVisible();
    await fillReport(page, {
      reason: REASONS.wrong_person,
      details: "The landlord linked here is wrong.",
      email: "visitor@example.com",
    });
    await sendButton(page).click();
    await expect(formStatus(page)).toHaveText(SENT);
    await page.getByRole("main").getByRole("link", { name: "← Go back" }).click();
    await expect(page).toHaveURL(propertyPath);
    await context.close();
  });

  test("in Icelandic", async ({ page, context }) => {
    await setLanguage(context, "is");
    await page.goto("/report?target=account");
    await expect(page.getByRole("heading", { level: 1, name: "Tilkynna vandamál" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Ástæða" })).toHaveValue("identity_claimed");
    await page.getByRole("button", { name: "Senda tilkynningu" }).click();
    await expect(formAlert(page)).toHaveText("Lagaðu merktu reitina.");
    await expect(page.getByText("Lýstu vandanum.", { exact: true })).toBeVisible();
    await expect(page.getByText("Sláðu inn netfang svo hægt sé að svara þér.", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Hvað er að?" }).fill("Einhver annar notar kennitöluna mína.");
    await page.getByRole("textbox", { name: "Netfangið þitt" }).fill("eg@example.com");
    await page.getByRole("button", { name: "Senda tilkynningu" }).click();
    await expect(formStatus(page)).toHaveText("Takk. Við skoðum málið.");
    await expect(page.getByRole("main").getByRole("link", { name: "← Til baka" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Links that can't be reported
// ---------------------------------------------------------------------------

test.describe("what can't be reported", () => {
  test("a broken or out-of-date link says so instead of showing the form", async ({ page }) => {
    const sigrunPath = await findPersonPath(page, "landlord", DEMO.people.sigrun.name);
    const profileId = idOf(sigrunPath);
    const propertyId = idOf(
      await findPropertyPath(page, DEMO.properties.njalsgata.address, propertyLabel(DEMO.properties.njalsgata)),
    );
    await page.goto(sigrunPath);
    const reviewId = await reviewIdOf(reviewCard(page, "Sanngjörn og fljót að svara"));

    for (const url of [
      "/report",
      `/report?id=${profileId}`,
      `/report?target=bogus&id=${profileId}`,
      "/report?target=review",
      "/report?target=review&id=not-a-uuid",
      `/report?target=review&id=${reviewId.slice(0, -1)}`,
      `/report?target=review&id=${randomUUID()}`,
      `/report?target=profile&id=${randomUUID()}`,
      `/report?target=property&id=${randomUUID()}`,
      // An id of the wrong kind.
      `/report?target=profile&id=${propertyId}`,
      `/report?target=property&id=${reviewId}`,
      `/report?target=review&id=${profileId}`,
    ]) {
      const response = await page.goto(url);
      expect(response?.status(), url).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Report a problem" }), url).toBeVisible();
      await expect(page.getByText(CANT_REPORT, { exact: true }), url).toBeVisible();
      await expect(
        page.getByText("The link may be wrong, or what it pointed to has been removed.", { exact: true }),
        url,
      ).toBeVisible();
      await expect(sendButton(page), url).toHaveCount(0);
      await expect(subjectBox(page), url).toHaveCount(0);
    }
    await page.getByRole("main").getByRole("link", { name: "Go home" }).click();
    await expect(page).toHaveURL("/");

    // An account report needs no id (and ignores one).
    await page.goto(`/report?target=account&id=${randomUUID()}`);
    await expect(sendButton(page)).toBeVisible();
  });

  test("a review deleted while the form is open, or a tampered form, is refused", async ({ page, browser }) => {
    // A renter reviews a landlord; a visitor opens the report form for that review.
    const landlord = await createActor(browser, "landlord");
    const renter = await createActor(browser, "renter");
    const review = makeReview(1);
    await postReview(renter.page, landlord.profilePath, review, landlord.user.kennitala);

    await page.goto(landlord.profilePath);
    await reviewCard(page, review.title).getByRole("link", { name: "Report", exact: true }).click();
    await expectReportPage(
      page,
      "review",
      [
        ["Review", `“${review.title}”`],
        ["Landlord", landlord.user.name],
      ],
      landlord.profilePath,
    );
    await fillReport(page, { reason: REASONS.false_or_abusive, details: "This isn't true.", email: "visitor@example.com" });

    // A tampered target or id is a broken link.
    const target = page.locator('main form input[name="target"]');
    const id = page.locator('main form input[name="id"]');
    const realId = await id.inputValue();
    await target.evaluate((input: HTMLInputElement) => (input.value = "bogus"));
    await sendButton(page).click();
    await expect(formAlert(page)).toHaveText("That page can't be reported.");
    await expect(detailsInput(page)).toHaveValue("This isn't true.");

    await id.evaluate((input: HTMLInputElement, value) => (input.value = value), randomUUID());
    await sendButton(page).click();
    await expect(formAlert(page)).toHaveText("That page can't be reported.");
    await expect(id).toHaveValue(realId);

    // The author deletes the review before the report is sent.
    await renter.page.goto(landlord.profilePath);
    await clickAndConfirm(renter.page, reviewCard(renter.page, review.title).getByRole("button", { name: "Delete" }));
    await expect(reviewCard(renter.page, review.title)).toHaveCount(0);

    await sendButton(page).click();
    await expect(formAlert(page)).toHaveText("That page can't be reported.");
    await page.reload();
    await expect(page.getByText(CANT_REPORT, { exact: true })).toBeVisible();

    await landlord.context.close();
    await renter.context.close();
  });
});

// ---------------------------------------------------------------------------
// The privacy page
// ---------------------------------------------------------------------------

const PRIVACY_HEADINGS = [
  "Why we use kennitalas",
  "Kennitalas are never shown",
  "Identities aren't verified",
  "Reviews about you",
  "Closing your account",
  "What we store",
  "Contact",
];

test.describe("the privacy page", () => {
  test("is linked from every page's footer and explains how kennitalas are used", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    const sigrunPath = await findPersonPath(page, "landlord", DEMO.people.sigrun.name);
    for (const path of ["/", "/landlords", sigrunPath, "/dashboard", "/report?target=account"]) {
      await page.goto(path);
      const footer = page.getByRole("contentinfo");
      await expect(
        footer.getByText("Reviews are the opinions of their authors. Identities aren't verified.", { exact: true }),
        path,
      ).toBeVisible();
      await expect(footer.getByRole("link", { name: "Privacy", exact: true }), path).toHaveAttribute("href", "/privacy");
    }

    await page.getByRole("contentinfo").getByRole("link", { name: "Privacy", exact: true }).click();
    await expect(page).toHaveURL("/privacy");
    await expect(page).toHaveTitle("Privacy · GossipRent");
    await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
    const intro = "What GossipRent stores, why, and what you can do about it.";
    await expect(page.getByText(intro, { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText(PRIVACY_HEADINGS);
    const main = page.getByRole("main");
    await expect(main.getByText(/^Many people in Iceland share a name\. A kennitala \(Icelandic ID number\)/)).toBeVisible();
    await expect(main.getByText(/^No kennitala is ever shown on the site/)).toBeVisible();
    await expect(main.getByText(/^GossipRent doesn't check that people enter their own kennitala/)).toBeVisible();
    await expect(main.getByText(/^You can't remove reviews others have written about you\./)).toBeVisible();
    await expect(main.getByText(/^You can close your account on My account\./)).toBeVisible();

    // "Contact" leads to the report form for a stolen kennitala.
    await main.getByRole("link", { name: "the report form" }).click();
    await expect(page).toHaveURL("/report?target=account");
    await expect(reasonSelect(page)).toHaveValue("identity_claimed");
  });

  test("is in Icelandic too", async ({ page, context }) => {
    await setLanguage(context, "is");
    await page.goto("/");
    await page.getByRole("contentinfo").getByRole("link", { name: "Persónuvernd", exact: true }).click();
    await expect(page).toHaveURL("/privacy");
    await expect(page).toHaveTitle("Persónuvernd · GossipRent");
    await expect(page.getByRole("heading", { level: 1, name: "Persónuvernd" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText([
      "Af hverju kennitala?",
      "Kennitölur eru aldrei birtar",
      "Ekki er gengið úr skugga um hver fólk er",
      "Umsagnir um þig",
      "Ef þú lokar aðganginum",
      "Hvað er geymt",
      "Hafa samband",
    ]);
    await expect(page.getByRole("main").getByRole("link", { name: "tilkynningarformið" })).toHaveAttribute(
      "href",
      "/report?target=account",
    );
  });
});
