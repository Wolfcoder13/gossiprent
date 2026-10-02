import { expect, test, type Page } from "@playwright/test";
import { DEMO, findPersonPath, findPropertyPath, makeUser, signUp } from "./helpers";

/** The number shown in one of the home page's stat tiles. */
async function homeStat(page: Page, label: string): Promise<number> {
  const tile = page.locator("dl > div").filter({ has: page.locator("dt", { hasText: label }) });
  return Number((await tile.locator("dd").innerText()).replace(/,/g, ""));
}

/** The "N things" total shown above a directory listing. */
async function directoryTotal(page: Page, path: string, noun: RegExp): Promise<number> {
  await page.goto(path);
  const summary = page.locator("main p").filter({ hasText: noun }).first();
  const match = (await summary.innerText()).match(/^([\d,]+)/);
  expect(match, `directory summary on ${path}`).not.toBeNull();
  return Number(match![1].replace(/,/g, ""));
}

/** Names on the person cards of the current directory page, in order. */
async function cardNames(page: Page): Promise<string[]> {
  return page.locator("main ul > li > a").evaluateAll((links) =>
    links.map((a) => a.querySelector("p")?.textContent?.trim() ?? ""),
  );
}

/** The "N reviews" line under the big average on a profile/property page. */
function summaryCount(page: Page) {
  return page.locator("p").filter({ hasText: /^(\d+ reviews?|No reviews yet)$/ }).first();
}

function notFoundHeading(page: Page) {
  return page.getByRole("heading", { level: 1, name: "We couldn't find that page" });
}

test.describe("home page", () => {
  test("shows the pitch, search box, live stats, and latest reviews", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("GossipRent — Landlord & renter reviews");
    await expect(page.getByRole("heading", { level: 1, name: "Rent with your eyes open." })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search landlords, renters, and properties" })).toBeVisible();

    // The three things you can review.
    for (const title of ["Review your landlord", "Review the place you rent", "Review your renters"]) {
      await expect(page.getByRole("heading", { level: 3, name: title })).toBeVisible();
    }

    // Stats are at least the seeded demo data...
    const stats = {
      reviews: await homeStat(page, "Reviews"),
      landlords: await homeStat(page, "Landlords"),
      renters: await homeStat(page, "Renters"),
      properties: await homeStat(page, "Properties"),
    };
    expect(stats.reviews).toBeGreaterThanOrEqual(15);
    expect(stats.landlords).toBeGreaterThanOrEqual(4);
    expect(stats.renters).toBeGreaterThanOrEqual(5);
    expect(stats.properties).toBeGreaterThanOrEqual(6);

    // ...and the latest-reviews feed shows the six newest, each saying what it's about.
    const recent = page.getByRole("region", { name: "Latest reviews" }).locator("article");
    await expect(recent).toHaveCount(6);
    for (const card of await recent.all()) {
      await expect(card.getByText(/^(Reviewed|Lived at) /)).toBeVisible();
      await expect(card.getByRole("img", { name: /^Rated [1-5] out of 5 stars$/ })).toBeVisible();
    }

    // Signed-out visitors get sign-up calls to action.
    await expect(page.getByRole("link", { name: "I'm a renter" })).toHaveAttribute("href", "/signup?role=renter");
    await expect(page.getByRole("link", { name: "I'm a landlord" })).toHaveAttribute("href", "/signup?role=landlord");

    // The stat tiles agree with the directories.
    expect(await directoryTotal(page, "/landlords", /^\d[\d,]* landlords?\b/)).toBe(stats.landlords);
    expect(await directoryTotal(page, "/renters", /^\d[\d,]* renters?\b/)).toBe(stats.renters);
    expect(await directoryTotal(page, "/properties", /^\d[\d,]* propert(y|ies)\b/)).toBe(stats.properties);
  });

  test("stats update live when someone signs up", async ({ page }) => {
    await page.goto("/");
    const renters = await homeStat(page, "Renters");
    const landlords = await homeStat(page, "Landlords");

    await signUp(page, makeUser("renter"));
    await page.goto("/");
    expect(await homeStat(page, "Renters")).toBe(renters + 1);
    expect(await homeStat(page, "Landlords")).toBe(landlords);
  });

  test("main navigation reaches every directory", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const [label, heading] of [
      ["Landlords", "Landlords"],
      ["Renters", "Renters"],
      ["Properties", "Properties"],
    ]) {
      await nav.getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`/${label.toLowerCase()}$`));
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(nav.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    }
  });
});

test("pages are sent with basic security headers", async ({ page }) => {
  const response = await page.goto("/");
  const headers = response!.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test.describe("directories", () => {
  test("landlords directory lists the demo landlords and links to their profiles", async ({ page }) => {
    await page.goto("/landlords");
    await expect(page).toHaveTitle("Landlords · GossipRent");
    const names = await cardNames(page);
    for (const landlord of Object.values(DEMO.landlords)) {
      expect(names).toContain(landlord.name);
    }
    // Renters are not listed here.
    expect(names).not.toContain(DEMO.renters.jordan.name);

    const maria = page.getByRole("link", { name: /Maria Gonzalez/ });
    await expect(maria).toContainText("Austin, TX");
    await expect(maria).toContainText("2 properties");
    await maria.click();
    await expect(page).toHaveURL(/\/landlords\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Maria Gonzalez" })).toBeVisible();
  });

  test("landlords directory sorts by rating and by review count", async ({ page }) => {
    const demoOrder = (names: string[]) =>
      names.filter((n) => Object.values(DEMO.landlords).some((l) => l.name === n));

    // Top rated: Maria 5 and Priya 5 (tie broken by name), Sam 4, Northgate 2.5.
    await page.goto("/landlords");
    expect(demoOrder(await cardNames(page))).toEqual([
      "Maria Gonzalez",
      "Priya Raman",
      "Sam Whitfield",
      "Northgate Property Group",
    ]);

    // Most reviewed: Northgate has 2 reviews, everyone else 1.
    await page.getByLabel("Sort by").selectOption("most");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/landlords\?q=&sort=most$/);
    expect(demoOrder(await cardNames(page))[0]).toBe("Northgate Property Group");
  });

  test("renters directory searches by city and sorts", async ({ page }) => {
    await page.goto("/renters");
    const names = await cardNames(page);
    for (const renter of Object.values(DEMO.renters)) expect(names).toContain(renter.name);

    const search = page.getByRole("search");
    await search.getByRole("searchbox").fill("Chicago");
    await search.getByLabel("Sort by").selectOption("newest");
    await search.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/renters\?q=Chicago&sort=newest$/);
    await expect(page.getByText("2 renters matching “Chicago”")).toBeVisible();
    // Lena joined more recently than Aisha.
    expect(await cardNames(page)).toEqual(["Lena Kowalski", "Aisha Bello"]);

    await page.getByLabel("Sort by").selectOption("name");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/sort=name/);
    expect(await cardNames(page)).toEqual(["Aisha Bello", "Lena Kowalski"]);
    // The form remembers the query and sort.
    await expect(page.getByRole("searchbox")).toHaveValue("Chicago");
    await expect(page.getByLabel("Sort by")).toHaveValue("name");

    await page.getByRole("link", { name: "Clear search" }).click();
    await expect(page).toHaveURL(/\/renters$/);
  });

  test("directory search with no matches shows an empty state", async ({ page }) => {
    await page.goto("/landlords?q=zzz-no-such-landlord");
    await expect(page.getByText("0 landlords matching “zzz-no-such-landlord”")).toBeVisible();
    await expect(page.getByText("No landlords match “zzz-no-such-landlord”")).toBeVisible();
  });

  test("properties directory searches by ZIP code and by landlord name", async ({ page }) => {
    await page.goto("/properties");
    await expect(page.getByRole("link", { name: "Add a property" }).first()).toBeVisible();
    for (const label of ["1408 E 6th St, Unit 2B", "2210 Riverside Dr", "4521 N Clark St, Unit 3", "77 Larimer St, Unit 504"]) {
      await expect(page.getByRole("link", { name: new RegExp(label) })).toBeVisible();
    }

    await page.goto("/properties?q=78702");
    await expect(page.getByText("1 property matching “78702”")).toBeVisible();
    const card = page.getByRole("link", { name: /1408 E 6th St, Unit 2B/ });
    await expect(card).toContainText("Austin, TX 78702");
    await expect(card).toContainText("Landlord: Maria Gonzalez");
    await expect(card).toContainText("4 · 1 review");

    await page.goto("/properties?q=northgate");
    await expect(page.getByText("2 properties matching “northgate”")).toBeVisible();
    await expect(page.getByRole("link", { name: /4521 N Clark St, Unit 3/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /980 W Belmont Ave, Unit 12/ })).toBeVisible();
  });
});

test.describe("search", () => {
  test("home search finds landlords, renters, and properties", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("searchbox", { name: "Search landlords, renters, and properties" }).fill("Austin");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/search\?q=Austin$/);
    await expect(page.getByRole("heading", { level: 1, name: "Results for “Austin”" })).toBeVisible();
    await expect(page.getByText("4 matches")).toBeVisible();

    const landlords = page.getByRole("region", { name: "Landlords" });
    await expect(landlords.getByRole("heading", { name: "Landlords (1)" })).toBeVisible();
    await expect(landlords.getByRole("link", { name: /Maria Gonzalez/ })).toBeVisible();

    const properties = page.getByRole("region", { name: "Properties" });
    await expect(properties.getByRole("heading", { name: "Properties (2)" })).toBeVisible();
    await expect(properties.getByRole("link", { name: /1408 E 6th St, Unit 2B/ })).toBeVisible();
    await expect(properties.getByRole("link", { name: /2210 Riverside Dr/ })).toBeVisible();

    const renters = page.getByRole("region", { name: "Renters" });
    await expect(renters.getByRole("heading", { name: "Renters (1)" })).toBeVisible();
    await renters.getByRole("link", { name: /Jordan Ellis/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Jordan Ellis" })).toBeVisible();
  });

  test("search is case-insensitive and matches part of a name", async ({ page }) => {
    await page.goto("/search?q=%20%20whitFIELD%20");
    await expect(page.getByRole("heading", { level: 1, name: "Results for “whitFIELD”" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Landlords" }).getByRole("link", { name: /Sam Whitfield/ })).toBeVisible();
  });

  test("search with no results suggests adding a property", async ({ page }) => {
    await page.goto("/search?q=qqq-nothing-here");
    await expect(page.getByText("0 matches")).toBeVisible();
    await expect(page.getByText("Nothing matched your search")).toBeVisible();
    await expect(page.getByRole("link", { name: "Add it" })).toHaveAttribute("href", "/properties/new");
  });

  test("LIKE wildcards in the query are matched literally", async ({ page }) => {
    for (const q of ["%", "_", "%%", "\\"]) {
      await page.goto(`/search?q=${encodeURIComponent(q)}`);
      await expect(page.getByText("Nothing matched your search"), `query ${JSON.stringify(q)}`).toBeVisible();
    }
  });

  // BUG: "NUL characters in input crash the request (HTTP 500)". Postgres can't
  // store or compare "\u0000", so a query containing it throws in the database
  // driver and every search/directory page answers 500 "Something went wrong".
  test.fixme("a query containing a NUL character doesn't crash search or the directories", async ({ page }) => {
    for (const path of ["/search?q=%00", "/search?q=abc%00", "/landlords?q=%00", "/renters?q=a%00b", "/properties?q=%00"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBeLessThan(500);
      await expect(page.getByRole("heading", { name: "Something went wrong" }), path).toHaveCount(0);
    }
  });

  test("an empty search shows just the search form", async ({ page }) => {
    await page.goto("/search?q=%20%20");
    await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
    await expect(page.getByRole("searchbox")).toHaveValue("");
    await expect(page.getByText(/matches?$/)).toHaveCount(0);
  });
});

test.describe("profile pages", () => {
  test("landlord profile shows details, rating, properties, reviews, and a sign-up prompt", async ({ page }) => {
    const path = await findPersonPath(page, "landlord", "Maria Gonzalez");
    await page.goto(path);
    await expect(page).toHaveTitle("Maria Gonzalez — landlord reviews · GossipRent");
    await expect(page.getByRole("heading", { level: 1, name: "Maria Gonzalez" })).toBeVisible();
    await expect(page.getByText(/^Austin, TX · Member since [A-Z][a-z]+ \d{4}$/)).toBeVisible();
    await expect(page.getByText("Family-run rentals since 2009.", { exact: false })).toBeVisible();

    // Rating summary: one 5-star review.
    await expect(summaryCount(page)).toHaveText("1 review");
    const breakdown = page.getByRole("list", { name: "Rating breakdown" }).getByRole("listitem");
    await expect(breakdown).toHaveCount(5);
    await expect(breakdown.nth(0)).toHaveText(/5 stars\s*1 review/);
    await expect(breakdown.nth(4)).toHaveText(/1 star\s*0 reviews/);

    // Properties she manages.
    await expect(page.getByRole("heading", { name: "Properties (2)" })).toBeVisible();
    await expect(page.getByRole("link", { name: /1408 E 6th St, Unit 2B/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /2210 Riverside Dr/ })).toBeVisible();

    // The review, by a renter.
    await expect(page.getByRole("heading", { name: "Reviews (1)" })).toBeVisible();
    const review = page.locator("article").filter({ hasText: "Responsive, fair, and honest" });
    await expect(review.getByRole("link", { name: "Jordan Ellis" })).toBeVisible();
    await expect(review.getByText("Renter", { exact: true })).toBeVisible();
    await expect(review.getByRole("img", { name: "Rated 5 out of 5 stars" })).toBeVisible();
    // Visitors can't edit or delete other people's reviews.
    await expect(review.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(review.getByRole("link", { name: "Edit" })).toHaveCount(0);

    // Signed-out visitors are invited to sign up as a renter and come back here.
    const next = encodeURIComponent(path);
    await expect(page.getByRole("heading", { name: "Rented from Maria Gonzalez?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign up as a renter" })).toHaveAttribute(
      "href",
      `/signup?role=renter&next=${next}`,
    );
    await expect(page.locator("main").getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      `/login?next=${next}`,
    );
    await expect(page.getByRole("button", { name: "Post review" })).toHaveCount(0);
  });

  test("landlord profile averages several reviews", async ({ page }) => {
    await page.goto(await findPersonPath(page, "landlord", "Northgate Property Group"));
    // Ratings 2 and 3.
    await expect(summaryCount(page)).toHaveText("2 reviews");
    await expect(page.getByRole("img", { name: "Rated 2.5 out of 5 stars" }).first()).toBeVisible();
    const breakdown = page.getByRole("list", { name: "Rating breakdown" }).getByRole("listitem");
    await expect(breakdown.nth(2)).toHaveText(/3 stars\s*1 review/);
    await expect(breakdown.nth(3)).toHaveText(/2 stars\s*1 review/);
    await expect(page.locator("article")).toHaveCount(2);
  });

  test("renter profile shows reviews from landlords and invites landlords", async ({ page }) => {
    const path = await findPersonPath(page, "renter", "Jordan Ellis");
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "Jordan Ellis" })).toBeVisible();
    await expect(page.getByText("Renter", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("What landlords say about Jordan Ellis.")).toBeVisible();
    const review = page.locator("article").filter({ hasText: "Ideal tenant" });
    await expect(review.getByRole("link", { name: "Maria Gonzalez" })).toBeVisible();
    await expect(review.getByText("Landlord", { exact: true })).toBeVisible();
    // Renters have no properties section.
    await expect(page.getByRole("heading", { name: /^Properties/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Rented to Jordan Ellis?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign up as a landlord" })).toHaveAttribute(
      "href",
      `/signup?role=landlord&next=${encodeURIComponent(path)}`,
    );

    // Reviewer names link to their profiles.
    await review.getByRole("link", { name: "Maria Gonzalez" }).click();
    await expect(page).toHaveURL(/\/landlords\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Maria Gonzalez" })).toBeVisible();
  });

  test("property page shows the address, landlord, rating, and reviews", async ({ page }) => {
    const path = await findPropertyPath(page, "78702", "1408 E 6th St, Unit 2B");
    await page.goto(path);
    await expect(page).toHaveTitle("1408 E 6th St, Unit 2B, Austin — reviews · GossipRent");
    await expect(page.getByRole("heading", { level: 1, name: "1408 E 6th St, Unit 2B" })).toBeVisible();
    await expect(page.getByText("Austin, TX 78702")).toBeVisible();
    await expect(page.getByText("One-bedroom apartment above a bakery.")).toBeVisible();
    await expect(summaryCount(page)).toHaveText("1 review");
    const review = page.locator("article").filter({ hasText: "Charming, but noisy on weekends" });
    await expect(review.getByRole("link", { name: "Jordan Ellis" })).toBeVisible();
    await expect(review.getByRole("img", { name: "Rated 4 out of 5 stars" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lived at 1408 E 6th St, Unit 2B?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign up as a renter" })).toBeVisible();

    await page.getByRole("link", { name: "Maria Gonzalez" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Maria Gonzalez" })).toBeVisible();
  });
});

test.describe("not found", () => {
  const randomUuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  for (const path of [
    "/landlords/not-a-uuid",
    `/landlords/${randomUuid}`,
    "/renters/123",
    `/renters/${randomUuid}`,
    "/properties/abc",
    `/properties/${randomUuid}`,
    "/no-such-page",
  ]) {
    test(`${path} is a 404`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(notFoundHeading(page)).toBeVisible();
      await expect(page.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
    });
  }

  test("a landlord's id under /renters (and vice versa) is a 404", async ({ page }) => {
    const landlordPath = await findPersonPath(page, "landlord", "Sam Whitfield");
    const renterPath = await findPersonPath(page, "renter", "Tom Becker");
    const landlordId = landlordPath.split("/").pop();
    const renterId = renterPath.split("/").pop();

    let response = await page.goto(`/renters/${landlordId}`);
    expect(response?.status()).toBe(404);
    await expect(notFoundHeading(page)).toBeVisible();
    await expect(page).toHaveTitle("Renter not found · GossipRent");

    response = await page.goto(`/landlords/${renterId}`);
    expect(response?.status()).toBe(404);
    await expect(notFoundHeading(page)).toBeVisible();
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("browsing, searching, and sorting work as plain links and forms", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("searchbox", { name: "Search landlords, renters, and properties" }).fill("Portland");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/search\?q=Portland$/);
    await expect(page.getByRole("region", { name: "Landlords" }).getByRole("link", { name: /Sam Whitfield/ })).toBeVisible();

    await page.goto("/renters");
    const search = page.getByRole("search");
    await search.getByRole("searchbox").fill("Chicago");
    await search.getByLabel("Sort by").selectOption("name");
    await search.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/renters\?q=Chicago&sort=name$/);
    expect(await cardNames(page)).toEqual(["Aisha Bello", "Lena Kowalski"]);

    await page.getByRole("link", { name: /Aisha Bello/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Aisha Bello" })).toBeVisible();
    await expect(page.locator("article").filter({ hasText: "Reliable and communicative" })).toBeVisible();
  });
});

test.describe("pagination", () => {
  // BUG: "Out-of-range ?page= claims the list is empty". A page number past the
  // last page (an old link, or after deletions) shows "N landlords" next to
  // "No landlords yet", with no pagination link back to page 1.
  test.fixme("an out-of-range directory page doesn't claim there are no landlords", async ({ page }) => {
    await page.goto("/landlords?page=999");
    await expect(page.getByText(/^\d+ landlords$/)).toBeVisible();
    await expect(page.getByText("No landlords yet")).toHaveCount(0);
    await expect(
      page.locator("main ul > li > a").first().or(page.getByRole("link", { name: "← Previous" })),
    ).toBeVisible();
  });

  // BUG: "Out-of-range ?page= claims the list is empty" (profile reviews variant).
  test.fixme("an out-of-range review page doesn't claim there are no reviews", async ({ page }) => {
    await page.goto(await findPersonPath(page, "landlord", "Northgate Property Group"));
    await page.goto(`${new URL(page.url()).pathname}?page=99`);
    await expect(page.getByRole("heading", { name: "Reviews (2)" })).toBeVisible();
    await expect(page.getByText("No reviews for Northgate Property Group yet")).toHaveCount(0);
  });
});
