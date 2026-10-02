import { expect, test, type Page } from "@playwright/test";
import {
  addProperty,
  clickAndCancel,
  clickAndConfirm,
  createActor,
  fillReview,
  formAlert,
  formStatus,
  makeProperty,
  makeUser,
  myProfilePath,
  pickStars,
  propertyLabel,
  reviewBodyInput,
  reviewCard,
  reviewTitleInput,
  signUp,
  starRadio,
  uid,
} from "./helpers";

type Review = { stars: number; title: string; body: string };

function makeReview(stars: number, overrides: Partial<Review> = {}): Review {
  const id = uid();
  return {
    stars,
    title: `Headline ${id}`,
    body: `Review body ${id}: responsive, fair, and the deposit came back in full.`,
    ...overrides,
  };
}

/** Write a review on the subject page `path` and wait for it to be saved. */
async function postReview(page: Page, path: string, review: Review): Promise<void> {
  await page.goto(path);
  await fillReview(page, review);
  await page.getByRole("button", { name: "Post review" }).click();
  await expect(formStatus(page)).toHaveText("Thanks! Your review is live.");
  await expect(reviewCard(page, review.title)).toBeVisible();
}

/** The "N reviews" line under the big average. */
function summaryCount(page: Page) {
  return page.locator("p").filter({ hasText: /^(\d+ reviews?|No reviews yet)$/ }).first();
}

/** The big average number in the rating summary. */
function summaryAverage(page: Page) {
  return page.locator("p.text-5xl");
}

function reviewsHeading(page: Page, count: number) {
  return page.getByRole("heading", { name: `Reviews (${count})`, exact: true });
}

test.describe("renter reviews a landlord", () => {
  test("posts a star rating and written review, shown on the profile, dashboards, and home page", async ({
    page,
    browser,
  }) => {
    const landlord = await createActor(browser, "landlord");
    const renter = makeUser("renter");
    await signUp(page, renter);

    await page.goto(landlord.profilePath);
    await expect(page.getByRole("heading", { name: `Review ${landlord.user.name}` })).toBeVisible();
    await expect(page.getByText("One review per landlord.", { exact: false })).toBeVisible();
    await expect(page.getByText("Tap a star")).toBeVisible();
    await expect(page.getByText(`No reviews for ${landlord.user.name} yet`)).toBeVisible();
    for (let n = 1; n <= 5; n++) await expect(starRadio(page, n)).not.toBeChecked();

    const review = makeReview(4);
    await pickStars(page, 4);
    await expect(page.getByText("Good", { exact: true })).toBeVisible();
    // Changing your mind is fine; only one star level is selected.
    await pickStars(page, 2);
    await expect(starRadio(page, 4)).not.toBeChecked();
    await pickStars(page, 4);
    await reviewTitleInput(page).fill(review.title);
    await reviewBodyInput(page).fill(review.body);
    await page.getByRole("button", { name: "Post review" }).click();

    await expect(formStatus(page)).toHaveText("Thanks! Your review is live.");
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

    await expect(reviewsHeading(page, 1)).toBeVisible();
    await expect(summaryCount(page)).toHaveText("1 review");
    await expect(summaryAverage(page)).toHaveText("4");

    // The panel switches to "Your review" with an update button.
    await expect(page.getByRole("heading", { name: "Your review" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Update review" })).toBeVisible();

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

    // It's the newest review on the home page.
    await page.goto("/");
    const latest = page.getByRole("region", { name: "Latest reviews" }).locator("article").first();
    await expect(latest).toContainText(review.title);
    await expect(latest).toContainText(`Reviewed ${landlord.user.name}`);

    // The landlord sees it under "Reviews about you" but can't edit or delete it.
    await landlord.page.goto("/dashboard");
    await expect(landlord.page.getByRole("heading", { name: "Reviews about you (1)" })).toBeVisible();
    const aboutMe = reviewCard(landlord.page, review.title);
    await expect(aboutMe).toContainText(review.body);
    await expect(aboutMe.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(aboutMe.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await expect(summaryAverage(landlord.page)).toHaveText("4");

    // And the directory card shows the new rating.
    await page.goto(`/landlords?q=${encodeURIComponent(landlord.user.name)}`);
    await expect(page.getByRole("link", { name: new RegExp(landlord.user.name) })).toContainText("4 · 1 review");

    await landlord.context.close();
  });

  test("review text is shown as plain text, keeping line breaks", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    const review = makeReview(3, {
      title: `<i>Not italic</i> ${uid()}`,
      body: "First line <b>not bold</b> & <script>window.__xss = 1</script>\nSecond line of the review.",
    });
    await postReview(page, landlord.profilePath, review);
    const card = reviewCard(page, review.title);
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(review.title);
    await expect(card.locator("i, b, script")).toHaveCount(0);
    expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
    const body = card.locator("p", { hasText: "First line" });
    expect(await body.innerText()).toBe(review.body);
    await landlord.context.close();
  });

  test("editing: the form is prefilled and saving updates the same review", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    const original = makeReview(4);
    await postReview(page, landlord.profilePath, original);

    // Come back later via the dashboard's Edit link.
    await page.goto("/dashboard");
    await reviewCard(page, original.title).getByRole("link", { name: "Edit" }).click();
    await expect(page).toHaveURL(`${landlord.profilePath}#your-review`);

    await expect(page.getByRole("heading", { name: "Your review" })).toBeVisible();
    await expect(page.getByText("You can update your review any time.", { exact: false })).toBeVisible();
    await expect(starRadio(page, 4)).toBeChecked();
    await expect(page.getByText("Good", { exact: true })).toBeVisible();
    await expect(reviewTitleInput(page)).toHaveValue(original.title);
    await expect(reviewBodyInput(page)).toHaveValue(original.body);
    await expect(page.getByRole("button", { name: "Update review" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Post review" })).toHaveCount(0);
    // No success banner left over from earlier.
    await expect(formStatus(page)).toHaveCount(0);

    const updated = makeReview(2);
    await fillReview(page, updated);
    await page.getByRole("button", { name: "Update review" }).click();
    await expect(formStatus(page)).toHaveText("Your review was updated.");

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

    // Still exactly one review on the dashboard.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Reviews you've written (1)" })).toBeVisible();
    await expect(reviewCard(page, updated.title)).toBeVisible();
    await landlord.context.close();
  });

  test("validation errors keep the typed text and the star selection", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    await page.goto(landlord.profilePath);

    await pickStars(page, 5);
    await reviewTitleInput(page).fill("ok");
    await reviewBodyInput(page).fill("Too short.");
    await page.getByRole("button", { name: "Post review" }).click();

    await expect(formAlert(page)).toHaveText("Please fix the highlighted fields.");
    await expect(page.getByText("Title must be at least 3 characters.")).toBeVisible();
    await expect(page.getByText("Your review must be at least 20 characters.")).toBeVisible();
    await expect(reviewTitleInput(page)).toHaveAttribute("aria-invalid", "true");
    await expect(reviewBodyInput(page)).toHaveAttribute("aria-invalid", "true");
    await expect(starRadio(page, 5)).toBeChecked();
    await expect(page.getByText("Excellent", { exact: true })).toBeVisible();
    await expect(reviewTitleInput(page)).toHaveValue("ok");
    await expect(reviewBodyInput(page)).toHaveValue("Too short.");
    // Nothing was saved.
    await expect(page.getByText(`No reviews for ${landlord.user.name} yet`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Post review" })).toBeVisible();

    // Whitespace doesn't count towards the minimum length.
    await reviewTitleInput(page).fill("   ab   ");
    await page.getByRole("button", { name: "Post review" }).click();
    await expect(page.getByText("Title must be at least 3 characters.")).toBeVisible();
    await expect(starRadio(page, 5)).toBeChecked();

    // Fixing the errors posts the review with the remembered rating.
    const fixed = makeReview(5);
    await reviewTitleInput(page).fill(fixed.title);
    await reviewBodyInput(page).fill(fixed.body);
    await page.getByRole("button", { name: "Post review" }).click();
    await expect(formStatus(page)).toHaveText("Thanks! Your review is live.");
    await expect(reviewCard(page, fixed.title).getByRole("img", { name: "Rated 5 out of 5 stars" })).toBeVisible();
    await expect(page.getByText("Title must be at least 3 characters.")).toHaveCount(0);
    await landlord.context.close();
  });

  test("the star picker works with the keyboard", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    await page.goto(landlord.profilePath);

    // Keyboard only (no mouse hover): focus the first star, select it with Space,
    // then move with the arrow keys like any radio group.
    await starRadio(page, 1).focus();
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
    await expect(page.getByRole("button", { name: "Post review" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(formStatus(page)).toHaveText("Thanks! Your review is live.");
    await expect(reviewCard(page, review.title).getByRole("img", { name: "Rated 2 out of 5 stars" })).toBeVisible();
    await landlord.context.close();
  });

  test("an invalid edit keeps the new text instead of reverting to the saved review", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    const saved = makeReview(3);
    await postReview(page, landlord.profilePath, saved);

    await pickStars(page, 1);
    await reviewTitleInput(page).fill("Changed my mind completely");
    await reviewBodyInput(page).fill("Short");
    await page.getByRole("button", { name: "Update review" }).click();
    await expect(page.getByText("Your review must be at least 20 characters.")).toBeVisible();
    await expect(starRadio(page, 1)).toBeChecked();
    await expect(reviewTitleInput(page)).toHaveValue("Changed my mind completely");
    await expect(reviewBodyInput(page)).toHaveValue("Short");
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
    await reviewTitleInput(page).fill(review.title);
    await reviewBodyInput(page).fill(review.body);
    await page.getByRole("button", { name: "Post review" }).click();

    await expect(formAlert(page)).toHaveText("Please fix the highlighted fields.");
    const stars = page.getByRole("group", { name: "Your rating" });
    await expect(stars).toHaveAttribute("aria-invalid", "true");
    await expect(stars).toContainText("Pick a star rating from 1 to 5.");
    await expect(stars).toHaveAccessibleDescription("Pick a star rating from 1 to 5.");
    await expect(page.getByText(/expected number|NaN|Invalid input/)).toHaveCount(0);
    await expect(reviewTitleInput(page)).toHaveValue(review.title);
    await expect(reviewBodyInput(page)).toHaveValue(review.body);
    await expect(page.getByText(`No reviews for ${landlord.user.name} yet`)).toBeVisible();
    // Focus moves to the stars so keyboard users can fix it straight away.
    await expect(starRadio(page, 1)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(starRadio(page, 2)).toBeChecked();
    await page.getByRole("button", { name: "Post review" }).click();
    await expect(formStatus(page)).toHaveText("Thanks! Your review is live.");
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
    await fillReview(page, review);
    await page.getByRole("button", { name: "Post review" }).click();
    await expect(formStatus(page)).toHaveText("Thanks! Your review is live.");
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

    await page.getByRole("button", { name: "Log out" }).click();
    await page.goto("/login");
    await page.getByLabel("Email").fill(`${user.email}\u0000`);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
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
    await page.getByRole("button", { name: "Post review" }).click();
    await expect(page.getByText("Title must be at least 3 characters.")).toBeVisible();
    await expect(reviewTitleInput(page)).toBeFocused();

    await reviewTitleInput(page).fill("A proper headline");
    await page.getByRole("button", { name: "Post review" }).click();
    await expect(page.getByText("Your review must be at least 20 characters.")).toBeVisible();
    await expect(reviewBodyInput(page)).toBeFocused();

    await reviewBodyInput(page).fill("Long enough this time, and all of it true.");
    await page.getByRole("button", { name: "Post review" }).click();
    await expect(formStatus(page)).toHaveText("Thanks! Your review is live.");
    await expect(formStatus(page)).toBeFocused();
    await landlord.context.close();
  });

  test("deleting a review asks for confirmation and removes it", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await signUp(page, makeUser("renter"));
    const review = makeReview(1);
    await postReview(page, landlord.profilePath, review);
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

    // The form is empty again, without a stale success message.
    await expect(page.getByRole("heading", { name: `Review ${landlord.user.name}` })).toBeVisible();
    await expect(page.getByRole("button", { name: "Post review" })).toBeVisible();
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
    await postReview(page, landlord.profilePath, review);

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
    await fillReview(page, a);
    await fillReview(other, b);
    await Promise.all([
      page.getByRole("button", { name: "Post review" }).click(),
      other.getByRole("button", { name: "Post review" }).click(),
    ]);
    await expect(formStatus(page)).toHaveText(/Thanks! Your review is live\.|Your review was updated\./);
    await expect(formStatus(other)).toHaveText(/Thanks! Your review is live\.|Your review was updated\./);

    await page.reload();
    await expect(reviewsHeading(page, 1)).toBeVisible();
    await expect(page.locator("article")).toHaveCount(1);
    await expect(summaryCount(page)).toHaveText("1 review");
    // Whichever save finished last wins.
    await expect(page.locator("article").getByRole("heading", { level: 3 })).toHaveText(new RegExp(`${a.title}|${b.title}`));
    await other.close();
    await landlord.context.close();
  });

  test("several renters' reviews are averaged, and each can only manage their own", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const first = await createActor(browser, "renter");
    const mine = makeReview(5);
    await postReview(first.page, landlord.profilePath, mine);
    const firstReviewId = (await reviewCard(first.page, mine.title).getAttribute("id"))!.replace("review-", "");

    await signUp(page, makeUser("renter"));
    const theirs = makeReview(2);
    await postReview(page, landlord.profilePath, theirs);

    await expect(reviewsHeading(page, 2)).toBeVisible();
    await expect(summaryCount(page)).toHaveText("2 reviews");
    await expect(summaryAverage(page)).toHaveText("3.5");
    await expect(page.getByRole("img", { name: "Rated 3.5 out of 5 stars" })).toBeVisible();

    // Newest first.
    await expect(page.locator("article").first()).toContainText(theirs.title);
    // The other renter's review has no controls for me.
    const other = reviewCard(page, mine.title);
    await expect(other.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(other.getByText("You", { exact: true })).toHaveCount(0);

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
  test("posts a review that shows on the property, directory, and both dashboards", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const property = makeProperty();
    const label = propertyLabel(property);
    const propertyPath = await addProperty(landlord.page, property);

    await signUp(page, makeUser("renter"));
    await page.goto(propertyPath);
    await expect(page.getByRole("heading", { name: `Review ${label}` })).toBeVisible();
    await expect(page.getByText("One review per property.", { exact: false })).toBeVisible();
    await expect(page.getByText("No reviews for this property yet")).toBeVisible();

    const review = makeReview(5, { body: "Bright rooms, quiet street, and the heating actually works in winter." });
    await fillReview(page, review);
    await page.getByRole("button", { name: "Post review" }).click();
    await expect(formStatus(page)).toHaveText("Thanks! Your review is live.");
    await expect(reviewCard(page, review.title).getByRole("img", { name: "Rated 5 out of 5 stars" })).toBeVisible();
    await expect(reviewsHeading(page, 1)).toBeVisible();
    await expect(summaryAverage(page)).toHaveText("5");

    // Directory card.
    await page.goto(`/properties?q=${encodeURIComponent(property.address)}`);
    await expect(page.getByRole("link", { name: new RegExp(label) })).toContainText("5 · 1 review");

    // Renter's dashboard: "Lived at …".
    await page.goto("/dashboard");
    const written = reviewCard(page, review.title);
    await expect(written.getByText(`Lived at ${label}, ${property.city}`)).toBeVisible();
    await expect(written.getByRole("link", { name: `${label}, ${property.city}` })).toHaveAttribute("href", propertyPath);

    // Landlord's dashboard: "Reviews of your properties".
    await landlord.page.goto("/dashboard");
    await expect(landlord.page.getByRole("heading", { name: "Reviews of your properties (1)" })).toBeVisible();
    await expect(reviewCard(landlord.page, review.title)).toContainText(`Lived at ${label}`);
    // A property review is not a review of the landlord personally.
    await expect(landlord.page.getByRole("heading", { name: "Reviews about you (0)" })).toBeVisible();

    // Editing works the same way as for people.
    await page.goto(propertyPath);
    await expect(starRadio(page, 5)).toBeChecked();
    await pickStars(page, 3);
    await page.getByRole("button", { name: "Update review" }).click();
    await expect(formStatus(page)).toHaveText("Your review was updated.");
    await expect(summaryAverage(page)).toHaveText("3");
    await expect(reviewsHeading(page, 1)).toBeVisible();

    await landlord.context.close();
  });
});

test.describe("landlord reviews a renter", () => {
  test("posts a review that shows on the renter's profile and dashboard", async ({ page, browser }) => {
    const renter = await createActor(browser, "renter");
    const landlord = makeUser("landlord");
    await signUp(page, landlord);

    await page.goto(renter.profilePath);
    await expect(page.getByRole("heading", { name: `Review ${renter.user.name}` })).toBeVisible();
    await expect(page.getByText("One review per renter.", { exact: false })).toBeVisible();
    const review = makeReview(2, { body: "Rent was late three months in a row, but the flat was kept clean." });
    await fillReview(page, review);
    await page.getByRole("button", { name: "Post review" }).click();
    await expect(formStatus(page)).toHaveText("Thanks! Your review is live.");

    const card = reviewCard(page, review.title);
    await expect(card.getByRole("link", { name: landlord.name })).toBeVisible();
    await expect(card.getByText("Landlord", { exact: true })).toBeVisible();
    await expect(card.getByRole("img", { name: "Rated 2 out of 5 stars" })).toBeVisible();
    await expect(page.getByText(`What landlords say about ${renter.user.name}.`)).toBeVisible();

    await page.goto("/dashboard");
    await expect(reviewCard(page, review.title).getByText(`Reviewed ${renter.user.name}`)).toBeVisible();

    await renter.page.goto("/dashboard");
    await expect(renter.page.getByRole("heading", { name: "Reviews about you (1)" })).toBeVisible();
    await expect(reviewCard(renter.page, review.title)).toContainText(review.body);
    await expect(summaryAverage(renter.page)).toHaveText("2");

    await page.goto(`/renters?q=${encodeURIComponent(renter.user.name)}`);
    await expect(page.getByRole("link", { name: new RegExp(renter.user.name) })).toContainText("2 · 1 review");
    await renter.context.close();
  });
});

test.describe("who can review whom", () => {
  test("landlords can't review landlords or properties; renters can't review renters", async ({ page, browser }) => {
    const otherLandlord = await createActor(browser, "landlord");
    const otherRenter = await createActor(browser, "renter");
    const propertyPath = await addProperty(otherLandlord.page, makeProperty());

    // As a landlord.
    await signUp(page, makeUser("landlord"));
    await page.goto(otherLandlord.profilePath);
    await expect(page.getByText("Only renters can review landlords. You're signed in as a landlord.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Post review" })).toHaveCount(0);
    await expect(page.getByRole("radio")).toHaveCount(0);

    await page.goto(propertyPath);
    await expect(page.getByText("Only renters can review properties. You're signed in as a landlord.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Post review" })).toHaveCount(0);

    // ...but they can review renters.
    await page.goto(otherRenter.profilePath);
    await expect(page.getByRole("button", { name: "Post review" })).toBeVisible();

    // As a renter.
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByRole("link", { name: "Sign up" }).first()).toBeVisible();
    await signUp(page, makeUser("renter"));
    await page.goto(otherRenter.profilePath);
    await expect(page.getByText("Only landlords can review renters. You're signed in as a renter.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Post review" })).toHaveCount(0);

    await otherLandlord.context.close();
    await otherRenter.context.close();
  });

  test("you can't review yourself or your own property", async ({ page, browser }) => {
    // Landlord on their own profile and their own property.
    await signUp(page, makeUser("landlord"));
    const landlordPath = await myProfilePath(page);
    await page.goto(landlordPath);
    await expect(
      page.getByText("This is your public profile. Reviews from renters appear here — you can't review yourself."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Post review" })).toHaveCount(0);
    await expect(page.getByText("When renters review you, their reviews will show up here.")).toBeVisible();

    const propertyPath = await addProperty(page, makeProperty());
    await expect(
      page.getByText("You're the landlord for this property. Reviews from your renters appear here."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Post review" })).toHaveCount(0);
    expect(propertyPath).toMatch(/^\/properties\//);

    // Renter on their own profile.
    const renter = await createActor(browser, "renter");
    await renter.page.goto(renter.profilePath);
    await expect(
      renter.page.getByText("This is your public profile. Reviews from landlords appear here — you can't review yourself."),
    ).toBeVisible();
    await expect(renter.page.getByRole("button", { name: "Post review" })).toHaveCount(0);
    await renter.context.close();
  });

  test("the server enforces the rules even for tampered forms", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    const otherRenter = await createActor(browser, "renter");
    await signUp(page, makeUser("renter"));
    const myPath = await myProfilePath(page);
    const myId = myPath.split("/").pop()!;
    const otherRenterId = otherRenter.profilePath.split("/").pop()!;
    const landlordId = landlord.profilePath.split("/").pop()!;

    async function submitTampered(fields: Record<string, string>) {
      await page.goto(landlord.profilePath);
      await page.evaluate((values) => {
        for (const [name, value] of Object.entries(values)) {
          const input = document.querySelector<HTMLInputElement>(`form input[type=hidden][name="${name}"]`);
          if (!input) throw new Error(`no hidden input ${name}`);
          input.value = value;
        }
      }, fields);
      await fillReview(page, makeReview(1));
      await page.getByRole("button", { name: "Post review" }).click();
    }

    // Reviewing yourself.
    await submitTampered({ subjectId: myId });
    await expect(formAlert(page)).toHaveText("You can't review yourself.");

    // A renter reviewing a renter.
    await submitTampered({ kind: "renter", subjectId: otherRenterId });
    await expect(formAlert(page)).toHaveText("Only landlords can review renters.");

    // A "landlord" review of someone who isn't a landlord.
    await submitTampered({ subjectId: otherRenterId });
    await expect(formAlert(page)).toHaveText("That landlord no longer exists.");

    // A "property" review of something that isn't a property.
    await submitTampered({ kind: "property", subjectId: landlordId });
    await expect(formAlert(page)).toHaveText("That property no longer exists.");

    // None of these created a review anywhere.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Reviews you've written (0)" })).toBeVisible();
    await otherRenter.page.goto("/dashboard");
    await expect(otherRenter.page.getByRole("heading", { name: "Reviews about you (0)" })).toBeVisible();

    await landlord.context.close();
    await otherRenter.context.close();
  });

  test("signed-out visitors can't post reviews", async ({ page, browser }) => {
    const landlord = await createActor(browser, "landlord");
    await page.goto(landlord.profilePath);
    await expect(page.getByRole("heading", { name: `Rented from ${landlord.user.name}?` })).toBeVisible();
    await expect(page.getByRole("button", { name: "Post review" })).toHaveCount(0);
    await expect(page.getByRole("radio")).toHaveCount(0);
    await landlord.context.close();
  });
});

test.describe("ratings on review cards", () => {
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
});

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
    await fillReview(page, { stars: 3, title, body: `See ${url} for the photos of the mold.` });
    await page.getByRole("button", { name: "Post review" }).click();
    await expect(formStatus(page)).toHaveText("Thanks! Your review is live.");
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

  test("a long URL in a property description doesn't overflow the property page", async ({ page, browser }) => {
    await signUp(page, makeUser("renter"));
    const property = makeProperty({ description: `Photos: https://example.com/${"gallery-".repeat(25)}${uid()}` });
    const path = await addProperty(page, property);
    await page.goto(path);
    await expect(page.getByText(property.description!)).toBeVisible();
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(390);

    const visitor = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const visitorPage = await visitor.newPage();
    await visitorPage.goto(path);
    await expect(visitorPage.getByText(property.description!)).toBeVisible();
    expect(await visitorPage.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(390);
    await visitor.close();
  });

  const LONG_TOWN = "Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch";

  async function pageWidth(page: Page): Promise<number> {
    return page.evaluate(() => document.scrollingElement!.scrollWidth);
  }

  // Regression: a company name like "SunbeltPropertyManagementGroup", a real
  // town such as "Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch",
  // or a long unbroken address token used to make pages scroll sideways.
  test("a long single-word name, city, or address doesn't make pages scroll sideways", async ({ page, browser }) => {
    const user = makeUser("landlord", { name: "SunbeltPropertyManagementGroup", city: LONG_TOWN });
    await signUp(page, user);
    const profile = await myProfilePath(page);
    const property = makeProperty({ address: `${"Unbrokenstreetnamewithoutanyspaces".repeat(2)}${uid()}` });
    const propertyPath = await addProperty(page, property);
    const inLongTown = makeProperty({ city: LONG_TOWN, region: "Ynysmonanglesey" });
    await addProperty(page, inLongTown);
    const targets = [
      profile,
      "/dashboard",
      propertyPath,
      `/search?q=${encodeURIComponent(LONG_TOWN)}`,
      `/search?q=${encodeURIComponent(property.address)}`,
      `/search?q=${encodeURIComponent(inLongTown.address)}`,
      // Directory cards with the long name, city, and address (short queries).
      "/landlords?q=Sunbelt",
      "/properties?q=Unbrokenstreetname",
      `/properties?q=${encodeURIComponent(inLongTown.address)}`,
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

  test("a property in a town with a long single-word name doesn't overflow its page", async ({ page, browser }) => {
    await signUp(page, makeUser("renter"));
    const property = makeProperty({ city: LONG_TOWN, region: "Ynysmonanglesey" });
    const path = await addProperty(page, property);
    await page.goto(path);
    await expect(page.getByText(LONG_TOWN).first()).toBeVisible();
    expect(await pageWidth(page)).toBeLessThanOrEqual(390);

    const visitor = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const visitorPage = await visitor.newPage();
    await visitorPage.goto(path);
    await expect(visitorPage.getByText(LONG_TOWN).first()).toBeVisible();
    expect(await pageWidth(visitorPage)).toBeLessThanOrEqual(390);
    await visitor.close();
  });
});
