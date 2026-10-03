import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  addProperty,
  cardMeta,
  cardSubtitle,
  createActor,
  DEMO,
  escapeRegExp,
  expectNoKennitala,
  expectNoKennitalaInUrls,
  fillReview,
  fillSignup,
  findPersonPath,
  findPropertyPath,
  firstName,
  FIX_FIELDS,
  formAlert,
  formatKennitala,
  formStatus,
  freshKennitala,
  homeSearchBox,
  idOf,
  INVALID_KENNITALA,
  KENNITALA_POINTER,
  KEPT_NAME,
  keptNameNotice,
  kennitalaLeaks,
  landlordLink,
  logInAs,
  lookupField,
  lookUpKennitala,
  lookupSection,
  makeProperty,
  makeReview,
  makeUser,
  MISMATCH,
  NO_ACCOUNT_NOTE,
  NO_KENNITALA_IN_TEXT,
  noAccountBadge,
  NOT_A_KENNITALA,
  notYouLink,
  personCard,
  personName,
  postButton,
  propertyLabel,
  recordRequests,
  reviewBodyInput,
  reviewCard,
  reviewKennitalaInput,
  reviewTitleInput,
  robotsMeta,
  searchBox,
  signUp,
  startReviewByKennitala,
  thisMonth,
  unconfirmedNote,
  wizardSubjectHeading,
  writeReviewByKennitala,
} from "./helpers";

/*
 * Kennitalas identify people, but are never shown: not on anyone else's page,
 * not in the React Server Component payloads those pages are built from, and
 * never in a URL. The only places one comes back are the form its author is
 * typing it into and the account owner's own dashboard.
 */

const NOT_FOUND = "Nobody with this kennitala has been reviewed yet.";

/**
 * A page as a visitor gets it: its HTML (with the page's metadata), and the
 * RSC payload the client router fetches when navigating to it (`RSC: 1`).
 */
async function htmlAndRsc(request: APIRequestContext, path: string): Promise<{ html: string; rsc: string }> {
  const html = await request.get(path);
  expect(html.status(), path).toBe(200);
  const rsc = await request.get(path, { headers: { RSC: "1" } });
  expect(rsc.status(), `${path} (RSC)`).toBe(200);
  expect(rsc.headers()["content-type"], `${path} (RSC)`).toContain("text/x-component");
  return { html: await html.text(), rsc: await rsc.text() };
}

/** Fetch each path's HTML and RSC payload with `request` and check none of them contains a kennitala. */
async function expectPagesFreeOf(
  request: APIRequestContext,
  paths: Iterable<string>,
  kennitalas: readonly string[],
  who: string,
): Promise<void> {
  const leaks: string[] = [];
  for (const path of paths) {
    const { html, rsc } = await htmlAndRsc(request, path);
    leaks.push(...kennitalaLeaks(html, kennitalas, `${path} as ${who}`));
    leaks.push(...kennitalaLeaks(rsc, kennitalas, `${path} RSC as ${who}`));
  }
  expect(leaks).toEqual([]);
}

// ---------------------------------------------------------------------------
// Never shown
// ---------------------------------------------------------------------------

test.describe("kennitalas are never shown", () => {
  test("no public page or RSC payload contains a demo person's kennitala, signed out or signed in", async ({
    page,
    request,
  }) => {
    const people = Object.values(DEMO.people);
    const everyone = people.map((person) => person.kennitala);

    const paths = new Set<string>([
      "/",
      "/landlords",
      "/landlords?sort=name",
      "/renters",
      "/renters?sort=newest",
      "/properties",
      "/search",
      "/search?kt=1",
      "/search?q=Reykjav%C3%ADk",
      "/privacy",
      "/report?target=account",
    ]);
    for (const person of people) {
      for (const role of person.roles) {
        const path = await findPersonPath(page, role, person.name);
        paths.add(path);
        paths.add(`/report?target=profile&id=${idOf(path)}`);
      }
      paths.add(`/search?q=${encodeURIComponent(person.name)}`);
    }
    for (const property of Object.values(DEMO.properties)) {
      const path = await findPropertyPath(page, property.address, propertyLabel(property));
      paths.add(path);
      paths.add(`/report?target=property&id=${idOf(path)}`);
      // The report form for each review on the page.
      await page.goto(path);
      for (const href of await page
        .locator("article")
        .getByRole("link", { name: "Report", exact: true })
        .evaluateAll((links) => links.map((a) => a.getAttribute("href")!))) {
        paths.add(href);
      }
    }
    expect(paths.size).toBeGreaterThan(50);

    // Signed out.
    await expectPagesFreeOf(request, paths, everyone, "a visitor");

    // Signed in as Kári: nobody else's kennitala, and not even his own on his public pages.
    await logInAs(page, "kari");
    await expectPagesFreeOf(page.request, paths, everyone, "Kári");

    // Only his dashboard shows him his own (and only his own).
    const kari = DEMO.people.kari;
    await page.goto("/dashboard");
    await expect(page.getByText(`Your kennitala: ${formatKennitala(kari.kennitala)}`, { exact: true })).toBeVisible();
    await expect(page.getByText("Only you can see it here. It's never shown publicly.", { exact: true })).toBeVisible();
    const dashboard = await htmlAndRsc(page.request, "/dashboard");
    // (So the checks above would have seen one.)
    expect(dashboard.html).toContain(formatKennitala(kari.kennitala));
    expect(dashboard.rsc).toContain(formatKennitala(kari.kennitala));
    const others = everyone.filter((kennitala) => kennitala !== kari.kennitala);
    expectNoKennitala(dashboard.html, others, "Kári's dashboard");
    expectNoKennitala(dashboard.rsc, others, "Kári's dashboard RSC");
  });

  test("text fields refuse a kennitala, so one can't be published by hand", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    const someone = formatKennitala(freshKennitala());

    // A review's headline or text.
    await page.goto(landlord.profilePath);
    await reviewKennitalaInput(page).fill(landlord.user.kennitala);
    await fillReview(page, {
      stars: 4,
      title: `About ${someone}`,
      body: `They gave me the kennitala ${someone} for the lease.`,
    });
    await postButton(page).click();
    await expect(formAlert(page)).toHaveText(FIX_FIELDS);
    await expect(page.getByText(NO_KENNITALA_IN_TEXT, { exact: true })).toHaveCount(2);
    await expect(reviewTitleInput(page)).toHaveAttribute("aria-invalid", "true");
    await expect(reviewBodyInput(page)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("heading", { name: "Reviews (0)" })).toBeVisible();

    // Written without spaces or with a space instead of the hyphen, too.
    await reviewTitleInput(page).fill("Fair landlord");
    await reviewBodyInput(page).fill(`My landlord's number is ${someone.replace("-", " ")}, ask them.`);
    await postButton(page).click();
    await expect(page.getByText(NO_KENNITALA_IN_TEXT, { exact: true })).toHaveCount(1);
    await expect(reviewBodyInput(page)).toHaveAttribute("aria-invalid", "true");

    // However the two parts are spaced or dashed (each on a fresh form, so the
    // error is this attempt's).
    const [birth, rest] = someone.split("-");
    for (const spelled of [`${birth} - ${rest}`, `${birth} -${rest}`, `${birth}  ${rest}`, `${birth}–${rest}`, `${birth} – ${rest}`]) {
      await page.goto(landlord.profilePath);
      await reviewKennitalaInput(page).fill(landlord.user.kennitala);
      await fillReview(page, { stars: 4, title: "Fair landlord", body: `My landlord's number is ${spelled}, ask them.` });
      await postButton(page).click();
      await expect(reviewBodyInput(page), spelled).toHaveAccessibleDescription(
        new RegExp(`${escapeRegExp(NO_KENNITALA_IN_TEXT)}$`),
      );
    }
    await expect(page.getByRole("heading", { name: "Reviews (0)" })).toBeVisible();

    // The dashboard's bio.
    await page.goto("/dashboard");
    await page.getByLabel("Bio").fill(`Reach me via ${someone.replace("-", "")}.`);
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText(NO_KENNITALA_IN_TEXT, { exact: true })).toBeVisible();

    // A property's description.
    await page.goto("/properties/new");
    await page.getByLabel("Address", { exact: true }).fill(makeProperty().address);
    await page.getByRole("combobox", { name: "Postcode" }).selectOption("101");
    await page.getByLabel("Short description").fill(`Owner: ${someone}`);
    await page.getByRole("button", { name: "Add property" }).click();
    await expect(page.getByText(NO_KENNITALA_IN_TEXT, { exact: true })).toBeVisible();
    await expect(page).toHaveURL("/properties/new");
    await landlord.context.close();
  });
});

// ---------------------------------------------------------------------------
// Reviewing someone by kennitala
// ---------------------------------------------------------------------------

test.describe("a review by kennitala", () => {
  test("creates a page for someone without an account, listed with “No account”", async ({
    page,
    browser,
    request,
  }) => {
    await signUp(page, makeUser("renter"));
    const requests = recordRequests(page.context());
    const kennitala = freshKennitala();
    const name = personName("Gerður");
    const review = makeReview(2);

    const path = await writeReviewByKennitala(page, "landlord", { kennitala: formatKennitala(kennitala), name }, review);
    expect(path).toMatch(/^\/landlords\/[0-9a-f-]{36}$/);

    // The new page: the name the author typed, "No account", and where it came from.
    const header = page.getByRole("main").locator("section").first();
    await expect(header.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(header.getByText("Landlord", { exact: true })).toBeVisible();
    await expect(noAccountBadge(page)).toBeVisible();
    await expect(header.getByText(`First reviewed ${thisMonth()}`, { exact: true })).toBeVisible();
    await expect(header.getByText(/Member since/)).toHaveCount(0);
    await expect(header.getByText("Identity not verified")).toHaveCount(0);
    await expect(header.getByText(NO_ACCOUNT_NOTE, { exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: "Sign up with your kennitala" })).toHaveAttribute("href", "/signup");
    await expect(page.getByRole("link", { name: "Report this page" })).toHaveAttribute(
      "href",
      `/report?target=profile&id=${idOf(path)}`,
    );
    // A person without an account isn't indexed.
    await expect(robotsMeta(page)).toHaveAttribute("content", /noindex/);
    await expect(robotsMeta(page)).toHaveAttribute("content", /nofollow/);
    await expect(page).toHaveTitle(`${name} — landlord reviews · GossipRent`);
    await expect(reviewCard(page, review.title).getByRole("img", { name: "Rated 2 out of 5 stars" })).toBeVisible();

    // The directory lists the page, marked "No account".
    await page.goto(`/landlords?q=${encodeURIComponent(name)}`);
    await expect(page.getByText(`1 landlord matching “${name}”`)).toBeVisible();
    const card = personCard(page, name);
    await expect(card).toHaveAttribute("href", path);
    expect(await cardMeta(card)).toEqual(["Landlord", "No account"]);
    expect(await cardSubtitle(card)).toBe("No properties yet");
    await expect(card).toContainText("2 · 1 review");
    // ...and so does search.
    await page.goto(`/search?q=${encodeURIComponent(name)}`);
    const landlords = page.getByRole("region", { name: /^Landlords/ });
    expect(await cardMeta(personCard(landlords, name))).toEqual(["Landlord", "No account"]);

    // The next renter to enter that kennitala finds the page, and reviews the same person.
    const second = await createActor(browser, "renter");
    const secondRequests = recordRequests(second.context);
    await startReviewByKennitala(second.page, "landlord", kennitala);
    await expect(wizardSubjectHeading(second.page)).toHaveAccessibleName(
      new RegExp(`^This kennitala belongs to ${escapeRegExp(name)}\\s*No account$`),
    );
    // Only the person typing it sees the number again, in their own form.
    await expect(second.page.getByText(`Kennitala: ${formatKennitala(kennitala)}`, { exact: true })).toBeVisible();
    await expect(second.page.getByRole("textbox", { name: "Full name" })).toHaveCount(0);
    const secondReview = makeReview(4);
    await fillReview(second.page, secondReview);
    await postButton(second.page).click();
    await expect(second.page).toHaveURL(new RegExp(`${escapeRegExp(path)}\\?saved=1(#your-review)?$`));
    await expect(formStatus(second.page)).toHaveText("Thanks! Your review is live.");
    await expect(second.page.getByRole("heading", { name: "Reviews (2)" })).toBeVisible();
    await page.goto(`/landlords?q=${encodeURIComponent(name)}`);
    await expect(card).toContainText("3 · 2 reviews");

    // The number went to the server in form posts only: never in a URL.
    expectNoKennitalaInUrls(requests, [kennitala]);
    expectNoKennitalaInUrls(secondRequests, [kennitala]);
    // Nobody sees it afterwards: not the authors, nor anyone else.
    const q = encodeURIComponent(name);
    const pages = [path, `/landlords?q=${q}`, `/search?q=${q}`, "/", "/dashboard"];
    await expectPagesFreeOf(page.request, pages, [kennitala], "the author");
    await expectPagesFreeOf(second.context.request, pages, [kennitala], "the second author");
    await expectPagesFreeOf(request, pages.slice(0, -1), [kennitala], "a visitor");
    await second.context.close();
  });

  test("the person can take the page over by signing up with their kennitala", async ({ page, browser, request }) => {
    // A renter reviews someone nobody has reviewed yet.
    const renter = await createActor(browser, "renter");
    const kennitala = freshKennitala();
    const name = personName("Hrafnhildur");
    const review = makeReview(4);
    const path = await writeReviewByKennitala(renter.page, "landlord", { kennitala, name }, review);

    // That person signs up, as a renter, under another name.
    const requests = recordRequests(page.context());
    const user = makeUser("renter", { kennitala, name: personName("Hildur") });
    await signUp(page, user);
    // The page had been reviewed, so it keeps its name: the dashboard says why.
    await expect(page).toHaveURL("/dashboard?name=kept");
    await expect(page.getByRole("heading", { level: 1, name: `Hi, ${firstName(name)}` })).toBeVisible();
    await expect(keptNameNotice(page)).toHaveText(KEPT_NAME);
    await expect(keptNameNotice(page).getByRole("link", { name: "report it" })).toHaveAttribute(
      "href",
      `/report?target=profile&id=${idOf(path)}`,
    );
    // Their kennitala, shown to them only, here.
    await expect(page.getByText(`Your kennitala: ${formatKennitala(kennitala)}`, { exact: true })).toBeVisible();
    // The roles they were reviewed in are kept alongside the one they picked.
    await expect(page.getByRole("heading", { name: "Reviews about you as a landlord (1)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reviews about you as a renter (0)" })).toBeVisible();
    await expect(reviewCard(page, review.title)).toBeVisible();

    // Same page (same address), now an account: no "No account", indexable again.
    await expect(page.getByRole("link", { name: "View public profile" })).toHaveAttribute("href", path);
    await page.goto(path);
    const header = page.getByRole("main").locator("section").first();
    await expect(header.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(noAccountBadge(page)).toHaveCount(0);
    await expect(header.getByText(NO_ACCOUNT_NOTE)).toHaveCount(0);
    await expect(header.getByText(`Testbær · Member since ${thisMonth()}`, { exact: true })).toBeVisible();
    await expect(header.getByText("Identity not verified", { exact: true })).toBeVisible();
    await expect(robotsMeta(page)).toHaveCount(0);
    await expect(reviewCard(page, review.title)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Ratings by role" }).getByRole("link")).toHaveCount(2);

    await page.goto(`/landlords?q=${encodeURIComponent(name)}`);
    expect(await cardMeta(personCard(page, name))).toEqual(["Landlord", "· Also a renter"]);

    // The kennitala went in the sign-up form post only, and isn't on their public pages.
    expectNoKennitalaInUrls(requests, [kennitala]);
    const publicPages = [path, `/renters/${idOf(path)}`, `/landlords?q=${encodeURIComponent(name)}`];
    await expectPagesFreeOf(request, publicPages, [kennitala], "a visitor");
    await expectPagesFreeOf(page.request, [path], [kennitala], "the owner");

    // Nobody else can sign up with it now.
    const thief = await browser.newContext();
    const thiefPage = await thief.newPage();
    await thiefPage.goto("/signup");
    await fillSignup(thiefPage, makeUser("renter", { kennitala: formatKennitala(kennitala) }));
    await expect(thiefPage.getByText("This kennitala already has an account.", { exact: true })).toBeVisible();
    await expect(notYouLink(thiefPage)).toHaveAttribute(
      "href",
      "/report?target=account",
    );
    await expect(thiefPage).toHaveURL("/signup");
    await thief.close();
    await renter.context.close();
  });

  test("a profile page asks for the person's kennitala and refuses one that doesn't match", async ({
    page,
    browser,
    request,
  }) => {
    const landlord = await createActor(browser, "landlord");
    const renter = makeUser("renter");
    await signUp(page, renter);
    const requests = recordRequests(page.context());
    const unknown = freshKennitala();
    const sigrun = DEMO.people.sigrun.kennitala;
    const review = makeReview(5);

    await page.goto(landlord.profilePath);
    const field = reviewKennitalaInput(page);
    await expect(field).toHaveAccessibleName("Landlord's kennitala");
    await expect(field).toHaveAccessibleDescription(
      "Their Icelandic ID number: 10 digits, e.g. 123456-7890. It's never shown on GossipRent.",
    );

    // Nobody has the number, someone else has it: the same answer either way.
    for (const wrong of [formatKennitala(unknown), sigrun]) {
      await field.fill(wrong);
      await fillReview(page, review);
      await postButton(page).click();
      await expect(formAlert(page)).toHaveText(FIX_FIELDS);
      await expect(page.getByText(MISMATCH, { exact: true })).toBeVisible();
      await expect(field).toBeFocused();
      await expect(field).toHaveAttribute("aria-invalid", "true");
      // Only the author's own form gives the number back; the review is kept too.
      await expect(field).toHaveValue(wrong);
      await expect(reviewTitleInput(page)).toHaveValue(review.title);
      await expect(page.getByRole("heading", { name: "Reviews (0)" })).toBeVisible();
    }

    // Their own number, and something that isn't a kennitala.
    await field.fill(formatKennitala(renter.kennitala));
    await postButton(page).click();
    await expect(page.getByText("That's your own kennitala.", { exact: true })).toBeVisible();
    await field.fill(NOT_A_KENNITALA);
    await postButton(page).click();
    await expect(page.getByText(INVALID_KENNITALA, { exact: true })).toBeVisible();
    await field.fill("");
    await postButton(page).click();
    await expect(page.getByText("Enter the landlord's kennitala.", { exact: true })).toBeVisible();

    // The right one, typed with a space, posts the review.
    const right = landlord.user.kennitala;
    await field.fill(`${right.slice(0, 6)} ${right.slice(6)}`);
    await postButton(page).click();
    await expect(formStatus(page)).toHaveText("Thanks! Your review is live.");
    await expect(reviewCard(page, review.title)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reviews (1)" })).toBeVisible();

    // Editing doesn't ask again.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your review" })).toBeVisible();
    await expect(reviewKennitalaInput(page)).toHaveCount(0);
    await reviewTitleInput(page).fill(`${review.title} (edited)`);
    await page.getByRole("button", { name: "Update review" }).click();
    await expect(formStatus(page)).toHaveText("Your review was updated.");

    const tried = [unknown, sigrun, renter.kennitala, right];
    expectNoKennitalaInUrls(requests, tried);
    await expectPagesFreeOf(page.request, [landlord.profilePath, "/dashboard"], [unknown, sigrun, right], "the author");
    await expectPagesFreeOf(request, [landlord.profilePath, "/"], tried, "a visitor");
    await landlord.context.close();
  });

  test("a landlord reviewing a renter's page is checked the same way", async ({ page, browser }) => {
    const renter = await createActor(browser, "renter");
    await signUp(page, makeUser("landlord"));
    await page.goto(renter.profilePath);
    const field = reviewKennitalaInput(page);
    await expect(field).toHaveAccessibleName("Renter's kennitala");
    await field.fill(freshKennitala());
    await fillReview(page, makeReview(3));
    await postButton(page).click();
    await expect(page.getByText(MISMATCH, { exact: true })).toBeVisible();
    await field.fill(renter.user.kennitala);
    await postButton(page).click();
    await expect(formStatus(page)).toHaveText("Thanks! Your review is live.");
    await renter.context.close();
  });
});

// ---------------------------------------------------------------------------
// Looking a kennitala up
// ---------------------------------------------------------------------------

test.describe("looking up a kennitala", () => {
  test("needs a login, and then finds the person's page or offers to write the first review", async ({ page }) => {
    const requests = recordRequests(page.context());
    const people = DEMO.people;
    const paths = {
      sigrun: await findPersonPath(page, "landlord", people.sigrun.name),
      olafur: await findPersonPath(page, "landlord", people.olafur.name),
      magnus: await findPersonPath(page, "renter", people.magnus.name),
      leigufelag: await findPersonPath(page, "landlord", people.leigufelag.name),
      kari: await findPersonPath(page, "renter", people.kari.name),
    };

    // Signed out: the form is there, but asks you to log in, then brings you back.
    await page.goto("/search");
    await expect(lookupSection(page).getByText("You need to log in to look up a kennitala.")).toBeVisible();
    await lookUpKennitala(page, formatKennitala(people.sigrun.kennitala));
    const alert = lookupSection(page).getByRole("alert");
    await expect(alert).toHaveText("Log in to look up a kennitala. Log in");
    await expect(page).toHaveURL("/search");
    await alert.getByRole("link", { name: "Log in" }).click();
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent("/search")}`);
    await page.getByLabel("Email").fill(people.kari.email);
    await page.getByLabel("Password").fill(DEMO.password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL("/search");
    await expect(lookupSection(page).getByText("You need to log in")).toHaveCount(0);

    // Found: straight to their page, however the number is typed. People with
    // both roles go to their landlord page.
    const found: [kennitala: string, path: string, name: string][] = [
      [formatKennitala(people.sigrun.kennitala), paths.sigrun, people.sigrun.name],
      [people.olafur.kennitala, paths.olafur, people.olafur.name],
      [` ${people.magnus.kennitala.slice(0, 6)} ${people.magnus.kennitala.slice(6)} `, paths.magnus, people.magnus.name],
      [formatKennitala(people.leigufelag.kennitala), paths.leigufelag, people.leigufelag.name],
      // Your own number finds your own page.
      [people.kari.kennitala, paths.kari, people.kari.name],
    ];
    for (const [typed, path, name] of found) {
      await page.goto("/search");
      await lookUpKennitala(page, typed);
      await expect(page).toHaveURL(path);
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      expectNoKennitala(await page.content(), [typed], `${name}'s page`);
    }

    // Not found: a neutral answer, the number kept in the field, and a way to review them.
    const unknown = freshKennitala();
    await page.goto("/");
    await lookUpKennitala(page, formatKennitala(unknown));
    const answer = lookupSection(page).getByRole("status");
    await expect(answer).toHaveText(`${NOT_FOUND} Write the first review`);
    await expect(answer).toBeFocused();
    await expect(page).toHaveURL("/");
    await expect(lookupField(page)).toHaveValue(formatKennitala(unknown));
    await answer.getByRole("link", { name: "Write the first review" }).click();
    await expect(page).toHaveURL("/reviews/new");
    await expect(page.getByRole("heading", { level: 2, name: "Who do you want to review?" })).toBeVisible();

    // Not a kennitala, or nothing at all.
    await page.goto("/search");
    await lookUpKennitala(page, NOT_A_KENNITALA);
    await expect(lookupSection(page).getByText(INVALID_KENNITALA, { exact: true })).toBeVisible();
    await expect(lookupField(page)).toBeFocused();
    await lookUpKennitala(page, "");
    await expect(lookupSection(page).getByText("Enter a kennitala.", { exact: true })).toBeVisible();
    await expect(page).toHaveURL("/search");

    expectNoKennitalaInUrls(requests, [
      ...Object.values(people).map((person) => person.kennitala),
      unknown,
    ]);
  });

  test("works without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const requests = recordRequests(context);
    const gunnar = DEMO.people.gunnar;
    const gunnarPath = await findPersonPath(page, "landlord", gunnar.name);
    await logInAs(page, "asdis");

    await page.goto("/");
    await lookUpKennitala(page, gunnar.kennitala);
    await expect(page).toHaveURL(gunnarPath);
    await expect(page.getByRole("heading", { level: 1, name: gunnar.name })).toBeVisible();

    const unknown = freshKennitala();
    await page.goto("/search");
    await lookUpKennitala(page, unknown);
    await expect(lookupSection(page).getByRole("status")).toHaveText(`${NOT_FOUND} Write the first review`);
    await expect(page).toHaveURL("/search");
    expectNoKennitalaInUrls(requests, [gunnar.kennitala, unknown]);
    await context.close();
  });

  test("a kennitala typed into a search box is handed to the lookup, never sent in a URL", async ({ page, browser }) => {
    await logInAs(page, "kari");
    const requests = recordRequests(page.context());
    const kennitala = formatKennitala(DEMO.people.gunnar.kennitala);

    // The home page has the lookup form: the number moves into it.
    await page.goto("/");
    const search = homeSearchBox(page);
    await search.fill(kennitala);
    await search.press("Enter");
    const field = lookupField(page);
    await expect(field).toHaveValue(kennitala);
    await expect(field).toBeFocused();
    await expect(search).toHaveValue("");
    await expect(page.getByRole("main").getByRole("status").filter({ hasText: KENNITALA_POINTER })).toHaveText(KENNITALA_POINTER);
    await expect(page).toHaveURL("/");
    await lookupSection(page).getByRole("button", { name: "Look up", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: DEMO.people.gunnar.name })).toBeVisible();

    // A directory has none: the visitor is sent to /search?kt=1, without the number.
    await page.goto("/renters");
    await searchBox(page).fill(`kt. ${kennitala}`);
    await searchBox(page).press("Enter");
    await expect(page).toHaveURL("/search?kt=1");
    await expect(page.getByText(KENNITALA_POINTER, { exact: true })).toBeVisible();
    // The cursor is in the lookup field, which is empty: the number isn't carried over.
    await expect(lookupField(page)).toBeFocused();
    await expect(lookupField(page)).toHaveValue("");
    expectNoKennitalaInUrls(requests, [kennitala]);

    // Without JavaScript the search is sent, but the page redirects without
    // searching for it or showing it.
    const noJs = await browser.newContext({ javaScriptEnabled: false });
    const noJsPage = await noJs.newPage();
    await noJsPage.goto("/landlords");
    await searchBox(noJsPage).fill(kennitala);
    await noJsPage.getByRole("main").getByRole("button", { name: "Search", exact: true }).click();
    await expect(noJsPage).toHaveURL("/search?kt=1");
    await expect(noJsPage.getByText(KENNITALA_POINTER, { exact: true })).toBeVisible();
    // The page itself puts the cursor in the lookup field (autofocus, no script needed).
    await expect(lookupField(noJsPage)).toHaveAttribute("autofocus", "");
    await expect(lookupField(noJsPage)).toBeFocused();
    expectNoKennitala(await noJsPage.content(), [kennitala], "/search?kt=1");
    await noJs.close();
  });
});

// ---------------------------------------------------------------------------
// A property's landlord by kennitala
// ---------------------------------------------------------------------------

test("linking a new landlord to a property creates their page without putting the number anywhere", async ({
  page,
  request,
}) => {
  await signUp(page, makeUser("renter"));
  const requests = recordRequests(page.context());
  const kennitala = freshKennitala();
  const name = personName("Snorri");
  const property = makeProperty();

  const propertyPath = await addProperty(page, property, { kennitala: formatKennitala(kennitala), name });
  await expect(unconfirmedNote(page)).toBeVisible();
  const landlordPath = await landlordLink(page, name).getAttribute("href");
  expect(landlordPath).toMatch(/^\/landlords\/[0-9a-f-]{36}$/);

  // The landlord's new page: no account, nobody has reviewed them, one property.
  await landlordLink(page, name).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(noAccountBadge(page)).toBeVisible();
  // No review made this page: the note doesn't say one did.
  await expect(page.getByText(NO_ACCOUNT_NOTE, { exact: true })).toBeVisible();
  await expect(page.getByText(/review was written|its author entered/)).toHaveCount(0);
  await expect(page.getByText(/^First reviewed/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Properties (1)" })).toBeVisible();
  await page.goto(`/landlords?q=${encodeURIComponent(name)}`);
  const card = personCard(page, name);
  expect(await cardMeta(card)).toEqual(["Landlord", "No account"]);
  expect(await cardSubtitle(card)).toBe("1 property");

  expectNoKennitalaInUrls(requests, [kennitala]);
  const pages = [propertyPath, landlordPath!, "/properties", `/landlords?q=${encodeURIComponent(name)}`];
  await expectPagesFreeOf(page.request, [...pages, "/dashboard"], [kennitala], "the renter who added it");
  await expectPagesFreeOf(request, pages, [kennitala], "a visitor");
});
