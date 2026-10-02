import { expect, test, type Page } from "@playwright/test";
import {
  addProperty,
  DEMO,
  DEMO_PASSWORD,
  findPersonPath,
  findPropertyPath,
  logIn,
  makeUser,
  myProfilePath,
  signUp,
  uid,
} from "./helpers";

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

  // Regression: Postgres can't store or compare "\u0000", so a query containing
  // it used to crash every search/directory page with a 500.
  test("a query containing a NUL character doesn't crash search or the directories", async ({ page }) => {
    for (const path of ["/search?q=%00", "/search?q=abc%00", "/landlords?q=%00", "/renters?q=a%00b", "/properties?q=%00"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      await expect(page.getByRole("heading", { name: "Something went wrong" }), path).toHaveCount(0);
    }
    // The NUL is simply dropped: "Whit\0field" searches for "Whitfield".
    await page.goto("/search?q=Whit%00field");
    await expect(page.getByRole("heading", { level: 1, name: "Results for “Whitfield”" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Landlords" }).getByRole("link", { name: /Sam Whitfield/ })).toBeVisible();
    // A query that's nothing but NULs is an empty search.
    await page.goto("/search?q=%00%00");
    await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
  });

  test("words are matched across fields: “Austin, TX” finds people and places in Austin", async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent("Austin, TX")}`);
    await expect(page.getByRole("heading", { level: 1, name: "Results for “Austin, TX”" })).toBeVisible();
    const landlords = page.getByRole("region", { name: "Landlords" });
    await expect(landlords.getByRole("link", { name: /Maria Gonzalez/ })).toBeVisible();
    const renters = page.getByRole("region", { name: "Renters" });
    await expect(renters.getByRole("link", { name: /Jordan Ellis/ })).toBeVisible();
    // Property city ("Austin") and region ("TX") are separate columns.
    const properties = page.getByRole("region", { name: "Properties" });
    await expect(properties.getByRole("heading", { name: "Properties (2)" })).toBeVisible();
    await expect(properties.getByRole("link", { name: /1408 E 6th St, Unit 2B/ })).toBeVisible();
    await expect(properties.getByRole("link", { name: /2210 Riverside Dr/ })).toBeVisible();

    await page.goto(`/properties?q=${encodeURIComponent("Austin, TX")}`);
    await expect(page.getByText("2 properties matching “Austin, TX”")).toBeVisible();
    await page.goto(`/properties?q=${encodeURIComponent("Austin TX 78741")}`);
    await expect(page.getByText("1 property matching “Austin TX 78741”")).toBeVisible();
    await expect(page.getByRole("link", { name: /2210 Riverside Dr/ })).toBeVisible();

    // Every word has to match somewhere.
    await page.goto(`/properties?q=${encodeURIComponent("Austin, IL")}`);
    await expect(page.getByText("0 properties matching “Austin, IL”")).toBeVisible();
    // Name and city together.
    await page.goto(`/landlords?q=${encodeURIComponent("Maria Austin")}`);
    await expect(page.getByText("1 landlord matching “Maria Austin”")).toBeVisible();
    await page.goto(`/renters?q=${encodeURIComponent("Chicago, IL")}`);
    await expect(page.getByText("2 renters matching “Chicago, IL”")).toBeVisible();
  });

  test("a full property label, unit included, finds that property", async ({ page }) => {
    for (const [query, label] of [
      ["1408 E 6th St, Unit 2B", "1408 E 6th St, Unit 2B"],
      ["4521 N Clark St, Unit 3, Chicago", "4521 N Clark St, Unit 3"],
      ["77 Larimer St Unit 504 Denver CO 80205", "77 Larimer St, Unit 504"],
      ["980 W Belmont Ave, Unit 12, Chicago, IL 60657", "980 W Belmont Ave, Unit 12"],
    ]) {
      await page.goto(`/properties?q=${encodeURIComponent(query)}`);
      await expect(page.getByText(`1 property matching “${query}”`), query).toBeVisible();
      await expect(page.getByRole("link", { name: new RegExp(label) }), query).toBeVisible();
    }
    // The landlord's name works alongside the address.
    await page.goto(`/properties?q=${encodeURIComponent("Clark Northgate")}`);
    await expect(page.getByText("1 property matching “Clark Northgate”")).toBeVisible();
    // The home page search does the same.
    await page.goto(`/search?q=${encodeURIComponent("1408 E 6th St, Unit 2B")}`);
    await expect(page.getByRole("region", { name: "Properties" }).getByRole("heading", { name: "Properties (1)" })).toBeVisible();
  });

  test("an empty search shows just the search form", async ({ page }) => {
    await page.goto("/search?q=%20%20");
    await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
    await expect(page.getByRole("searchbox")).toHaveValue("");
    await expect(page.getByText(/matches?$/)).toHaveCount(0);
  });

  test("a punctuation-only search (“,”) shows the empty search page, not every result", async ({ page }) => {
    for (const q of ["%2C", "%20%2C%20%2C%2C%20", "%2C%0A%09"]) {
      await page.goto(`/search?q=${q}`);
      await expect(page.getByRole("heading", { level: 1, name: "Search" }), q).toBeVisible();
      await expect(page.getByRole("searchbox"), q).toHaveValue("");
      await expect(page.getByText(/matches?$/), q).toHaveCount(0);
      await expect(page.getByRole("heading", { name: /^Results for/ }), q).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Landlords" }), q).toHaveCount(0);
    }
  });

  test("a punctuation-only filter on a directory is ignored", async ({ page }) => {
    const all = await directoryTotal(page, "/landlords", /^\d[\d,]* landlords?\b/);
    await page.goto("/landlords?q=%2C");
    await expect(page.getByText(/matching “/)).toHaveCount(0);
    expect(await directoryTotal(page, "/landlords?q=%2C", /^\d[\d,]* landlords?\b/)).toBe(all);
    await page.goto("/properties?q=%2C%2C");
    await expect(page.getByText(/matching “/)).toHaveCount(0);
  });

  test("a search of more than 100 characters is cut without leaving half an emoji", async ({ page }) => {
    const query = `${"x".repeat(99)}😀`;
    const response = await page.goto(`/search?q=${encodeURIComponent(query)}`);
    expect(response?.status()).toBe(200);
    const shown = await page.getByRole("searchbox").inputValue();
    expect(shown.startsWith("x".repeat(99))).toBe(true);
    expect(shown.isWellFormed()).toBe(true);
    await expect(page.getByText("Nothing matched your search")).toBeVisible();
  });

  test("repeating a word doesn't change the results", async ({ page }) => {
    await page.goto(`/landlords?q=${encodeURIComponent("whitfield WHITFIELD Whitfield")}`);
    await expect(page.getByText("1 landlord matching “whitfield WHITFIELD Whitfield”")).toBeVisible();
    // Repeats don't use up the 8-word limit either: a word after 10 repeats still counts.
    const query = `${"a ".repeat(10)}Whitfield`;
    await page.goto(`/landlords?q=${encodeURIComponent(query)}`);
    await expect(page.getByRole("link", { name: /Sam Whitfield/ })).toBeVisible();
    await expect(page.getByText(/^1 landlord matching/)).toBeVisible();
  });

  test("names and places with Greek or Turkish capitals can be found as typed", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    const token = `U${uid()}`;
    const greek = `${token} ΟΔΟΣ ΕΡΜΟΥ`;
    const turkish = `${token} İstiklal Caddesi`;
    for (const address of [greek, turkish]) {
      await addProperty(page, { address, city: "İstanbul", region: "TR" });
    }
    for (const [query, count] of [
      [`${token} ΟΔΟΣ`, 1],
      [`${token} İstiklal`, 1],
      [`${token} İstanbul`, 2],
      [`${token} ΕΡΜΟΥ`, 1],
    ] as const) {
      await page.goto(`/properties?q=${encodeURIComponent(query)}`);
      await expect(page.getByText(new RegExp(`^${count} propert(y|ies) matching`)), query).toBeVisible();
    }
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

  test("a landlord's id under /renters (and vice versa) goes to the page for the role they have", async ({
    page,
    request,
  }) => {
    const landlordPath = await findPersonPath(page, "landlord", DEMO.landlords.maria.name);
    const renterPath = await findPersonPath(page, "renter", DEMO.renters.tom.name);
    const landlordId = landlordPath.split("/").pop();
    const renterId = renterPath.split("/").pop();

    // A plain redirect, not a 404.
    let response = await request.get(`/renters/${landlordId}`, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toBe(landlordPath);
    response = await request.get(`/landlords/${renterId}`, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toBe(renterPath);

    const page1 = await page.goto(`/renters/${landlordId}`);
    expect(page1?.status()).toBe(200);
    await expect(page).toHaveURL(landlordPath);
    await expect(page.getByRole("heading", { level: 1, name: DEMO.landlords.maria.name })).toBeVisible();
    await expect(notFoundHeading(page)).toHaveCount(0);

    await page.goto(`/landlords/${renterId}`);
    await expect(page).toHaveURL(renterPath);
    await expect(page.getByRole("heading", { level: 1, name: DEMO.renters.tom.name })).toBeVisible();

    // Sam Whitfield is both, so both of his pages exist.
    const samLandlord = await findPersonPath(page, "landlord", DEMO.landlords.sam.name);
    const samId = samLandlord.split("/").pop();
    const samRenter = await page.goto(`/renters/${samId}`);
    expect(samRenter?.status()).toBe(200);
    await expect(page).toHaveURL(`/renters/${samId}`);
    await expect(page).toHaveTitle(`${DEMO.landlords.sam.name} — renter reviews · GossipRent`);
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
  // Regression: a page number past the last page (an old link, or after
  // deletions) used to show "N landlords" next to "No landlords yet". It now
  // redirects to the last page that exists.
  test("an out-of-range directory page redirects to the last page", async ({ page, request }) => {
    const response = await request.get("/landlords?page=999", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toMatch(/^\/landlords(\?page=\d+)?$/);

    await page.goto("/landlords?page=999");
    await expect(page).toHaveURL(/\/landlords(\?page=\d+)?$/);
    await expect(page.getByText(/^\d+ landlords$/)).toBeVisible();
    await expect(page.getByText("No landlords yet")).toHaveCount(0);
    await expect(page.locator("main ul > li > a").first()).toBeVisible();
  });

  test("the redirect keeps the search and sort", async ({ request }) => {
    const response = await request.get("/properties?q=Austin&sort=name&page=7", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toBe("/properties?q=Austin&sort=name");

    const renters = await request.get("/renters?q=Chicago&sort=newest&page=2", { maxRedirects: 0 });
    expect(renters.status()).toBe(307);
    expect(renters.headers()["location"]).toBe("/renters?q=Chicago&sort=newest");
  });

  test("a search with no results doesn't redirect, whatever the page", async ({ page }) => {
    const response = await page.goto("/landlords?q=zzz-no-such-landlord&page=5");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/page=5$/);
    await expect(page.getByText("No landlords match “zzz-no-such-landlord”")).toBeVisible();
  });

  test("an out-of-range review page redirects to the last page of reviews", async ({ page, request }) => {
    const path = await findPersonPath(page, "landlord", "Northgate Property Group");
    const response = await request.get(`${path}?page=99`, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toBe(`${path}#reviews`);

    await page.goto(`${path}?page=99`);
    await expect(page).toHaveURL(`${path}#reviews`);
    await expect(page.getByRole("heading", { name: "Reviews (2)" })).toBeVisible();
    await expect(page.getByText("No reviews for Northgate Property Group yet")).toHaveCount(0);
    await expect(page.locator("article")).toHaveCount(2);
  });

  test("an out-of-range property review page redirects too", async ({ page, request }) => {
    const path = await findPropertyPath(page, "78702", "1408 E 6th St, Unit 2B");
    const response = await request.get(`${path}?page=3`, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toBe(`${path}#reviews`);
    await page.goto(`${path}?page=3`);
    await expect(page.getByRole("heading", { name: "Reviews (1)" })).toBeVisible();
  });
});

test.describe("A–Z sorting", () => {
  test("people are sorted by name ignoring case", async ({ browser, page }) => {
    const token = `Sortcase${uid()}`;
    // Created out of order, with mixed-case names.
    for (const first of ["delta", "Bravo", "alpha", "Charlie"]) {
      const context = await browser.newContext();
      await signUp(await context.newPage(), makeUser("renter", { name: `${first} ${token}` }));
      await context.close();
    }
    await page.goto(`/renters?q=${token}&sort=name`);
    await expect(page.getByText(`4 renters matching “${token}”`)).toBeVisible();
    // Byte order would put "Bravo" and "Charlie" before "alpha".
    expect(await cardNames(page)).toEqual([`alpha ${token}`, `Bravo ${token}`, `Charlie ${token}`, `delta ${token}`]);
  });

  test("properties are sorted by address ignoring case", async ({ page }) => {
    const token = `Sortprop${uid()}`;
    await signUp(page, makeUser("renter"));
    for (const street of ["delta", "Bravo", "alpha", "Charlie"]) {
      await addProperty(page, { address: `${street} ${token} Rd`, city: "Sortville", region: "SV" });
    }
    await page.goto(`/properties?q=${token}&sort=name`);
    await expect(page.getByText(`4 properties matching “${token}”`)).toBeVisible();
    const labels = await page
      .locator("main ul > li > a")
      .evaluateAll((links) => links.map((a) => a.querySelector("p")?.textContent?.trim() ?? ""));
    expect(labels).toEqual([`alpha ${token} Rd`, `Bravo ${token} Rd`, `Charlie ${token} Rd`, `delta ${token} Rd`]);
  });
});

test.describe("on a phone (390px wide)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  /** Whether the page can scroll sideways. */
  async function horizontalOverflow(page: Page): Promise<number> {
    return page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
  }

  test("a profile has a “Review <name>” button that jumps to the review form", async ({ page }) => {
    const path = await findPersonPath(page, "landlord", "Sam Whitfield");
    await page.goto(path);
    const cta = page.getByRole("link", { name: "Review Sam Whitfield", exact: true });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", "#your-review");
    // The form box starts below the fold on a phone.
    await expect(page.locator("#your-review")).not.toBeInViewport();
    await cta.click();
    await expect(page).toHaveURL(`${path}#your-review`);
    await expect(page.locator("#your-review")).toBeInViewport();
    await expect(page.getByRole("heading", { name: "Rented from Sam Whitfield?" })).toBeInViewport();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("the button reads “Review this property” on a property and “Edit your review” once you've written one", async ({
    page,
  }) => {
    await page.goto(await findPropertyPath(page, "97202", "3315 SE Division St"));
    await expect(page.getByRole("link", { name: "Review this property" })).toBeVisible();

    // Tom reviewed Sam Whitfield in the demo data.
    const samPath = await findPersonPath(page, "landlord", "Sam Whitfield");
    await logIn(page, DEMO.renters.tom.email, DEMO_PASSWORD);
    await page.goto(samPath);
    const edit = page.getByRole("link", { name: "Edit your review" });
    await expect(edit).toBeVisible();
    await edit.click();
    await expect(page.getByRole("button", { name: "Update review" })).toBeInViewport();
  });

  test("no review button where you can't review", async ({ page }) => {
    const mariaPath = await findPersonPath(page, "landlord", "Maria Gonzalez");
    // Landlords can't review landlords (Priya is only a landlord; Sam is also a renter).
    await logIn(page, DEMO.landlords.priya.email, DEMO_PASSWORD);
    await page.goto(mariaPath);
    await expect(page.getByRole("heading", { level: 1, name: "Maria Gonzalez" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Review Maria Gonzalez$|^Edit your review$/ })).toHaveCount(0);
    // Nor on your own profile.
    await page.goto(await myProfilePath(page));
    await expect(page.getByRole("link", { name: /^Review |^Edit your review$/ })).toHaveCount(0);
  });

  test("the signed-in header's account link has an accessible name", async ({ page }) => {
    await logIn(page, DEMO.renters.aisha.email, DEMO_PASSWORD);
    // On a phone only the avatar shows, so the name comes from aria-label.
    const account = page.getByRole("banner").getByRole("link", { name: "My account" });
    await expect(account).toBeVisible();
    await expect(account).toHaveAttribute("href", "/dashboard");
  });

  test("the home page, directories, and search don't scroll sideways", async ({ page }) => {
    for (const path of ["/", "/landlords", "/renters", "/properties", "/search?q=Austin", "/login", "/signup"]) {
      await page.goto(path);
      expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(0);
    }
  });

  test("the mobile “Review” button moves keyboard focus into the review form", async ({ page }) => {
    const path = await findPersonPath(page, "landlord", "Sam Whitfield");
    await page.goto(path);
    const cta = page.getByRole("link", { name: "Review Sam Whitfield", exact: true });
    await cta.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${path}#your-review`);
    // The next Tab lands inside the form, not back at the top of the page.
    await page.keyboard.press("Tab");
    const insideForm = await page.evaluate(() => Boolean(document.activeElement?.closest("#your-review")));
    expect(insideForm).toBe(true);
  });
});
