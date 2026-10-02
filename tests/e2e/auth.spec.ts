import { expect, test } from "@playwright/test";
import {
  DEMO,
  DEMO_PASSWORD,
  fillLogin,
  fillSignup,
  findPersonPath,
  formAlert,
  logIn,
  logOut,
  makeUser,
  myProfilePath,
  signUp,
  uid,
} from "./helpers";

const SESSION_COOKIE = "gossiprent_session";

test.describe("sign up", () => {
  test("as a renter", async ({ page }) => {
    const user = makeUser("renter");
    await signUp(page, user);

    await expect(page).toHaveTitle("My account · GossipRent");
    await expect(page.getByText(`Signed in as ${user.email}`)).toBeVisible();
    await expect(page.locator("main").getByText("Renter", { exact: true }).first()).toBeVisible();
    // Renter quick actions.
    await expect(page.getByRole("link", { name: "Review a landlord" })).toHaveAttribute("href", "/landlords");
    await expect(page.getByRole("link", { name: "Review a property" })).toHaveAttribute("href", "/properties");
    await expect(page.getByRole("link", { name: "Add the place you rent" })).toHaveAttribute("href", "/properties/new");
    await expect(page.getByRole("heading", { name: "Reviews about you (0)" })).toBeVisible();
    await expect(page.getByText("No one has reviewed you yet")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reviews you've written (0)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Properties you added (0)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Reviews of your properties/ })).toHaveCount(0);

    // Signed-in header.
    await expect(page.getByRole("link", { name: "My account" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Log in" })).toHaveCount(0);

    // Public renter profile, which never shows the email address.
    const path = await myProfilePath(page);
    expect(path).toMatch(/^\/renters\//);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: user.name })).toBeVisible();
    await expect(page.getByText(`${user.city} · Member since`)).toBeVisible();
    await expect(page.getByText(user.email)).toHaveCount(0);
    await expect(page.getByText("No reviews for", { exact: false })).toBeVisible();

    // Listed in the renters directory.
    await page.goto(`/renters?q=${encodeURIComponent(user.name)}`);
    await expect(page.getByRole("link", { name: new RegExp(user.name) })).toHaveAttribute("href", path);
  });

  test("as a landlord", async ({ page }) => {
    const user = makeUser("landlord", { city: undefined });
    await signUp(page, user);

    await expect(page.getByText(`Signed in as ${user.email}`)).toBeVisible();
    await expect(page.locator("main").getByText("Landlord", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Review a renter" })).toHaveAttribute("href", "/renters");
    await expect(page.getByRole("heading", { name: "Reviews of your properties (0)", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your properties (0)", exact: true })).toBeVisible();
    await expect(page.getByText("You haven't listed any properties")).toBeVisible();

    const path = await myProfilePath(page);
    expect(path).toMatch(/^\/landlords\//);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: user.name })).toBeVisible();
    // No city given.
    await expect(page.getByText(/^Member since [A-Z][a-z]+ \d{4}$/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Properties (0)" })).toBeVisible();

    await page.goto(`/landlords?q=${encodeURIComponent(user.name)}`);
    await expect(page.getByRole("link", { name: new RegExp(user.name) })).toContainText("Location not listed");
  });

  test("?role= preselects the account type", async ({ page }) => {
    await page.goto("/signup?role=landlord");
    await expect(page.getByRole("radio", { name: "I'm a landlord" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "I'm a renter" })).not.toBeChecked();

    await page.goto("/signup?role=renter");
    await expect(page.getByRole("radio", { name: "I'm a renter" })).toBeChecked();

    await page.goto("/signup?role=admin");
    await expect(page.getByRole("radio", { name: "I'm a renter" })).not.toBeChecked();
    await expect(page.getByRole("radio", { name: "I'm a landlord" })).not.toBeChecked();
  });

  test("shows every validation error and keeps what was typed (except the password)", async ({ page }) => {
    await page.goto("/signup");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(formAlert(page)).toHaveText("Please fix the highlighted fields.");
    await expect(page.getByText("Choose whether you're a landlord or a renter.")).toBeVisible();
    await expect(page.getByText("Name must be at least 2 characters.")).toBeVisible();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByText("Password must be at least 8 characters.")).toBeVisible();
    await expect(page).toHaveURL(/\/signup$/);

    // Fix some fields but not others.
    await page.locator("label", { hasText: "I'm a landlord" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Al Bundy");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password").fill("short");
    await page.getByLabel("City").fill("Chicago, IL");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByText("Password must be at least 8 characters.")).toBeVisible();
    await expect(page.getByText("Name must be at least 2 characters.")).toHaveCount(0);
    await expect(page.getByText("Choose whether you're a landlord or a renter.")).toHaveCount(0);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Al Bundy");
    await expect(page.getByLabel("Email")).toHaveValue("not-an-email");
    await expect(page.getByLabel("City")).toHaveValue("Chicago, IL");
    await expect(page.getByLabel("Password")).toHaveValue("");
    await expect(page.getByRole("radio", { name: "I'm a landlord" })).toBeChecked();
    // Errors are wired up for screen readers.
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Email")).toHaveAccessibleDescription("Enter a valid email address.");
  });

  test("rejects an email that's already registered, ignoring case and spaces", async ({ page }) => {
    await page.goto("/signup");
    await fillSignup(page, {
      role: "renter",
      name: "Copycat Maria",
      email: `  ${DEMO.landlords.maria.email.toUpperCase()}  `,
      password: "another-password",
    });
    await expect(
      page.getByText("An account with this email already exists. Try logging in instead."),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Copycat Maria");
    await expect(page.getByRole("radio", { name: "I'm a renter" })).toBeChecked();
  });

  test("stores the email in lower case so you can log in with any casing", async ({ page }) => {
    const id = uid();
    const user = makeUser("renter", { email: `E2E-Mixed-${id}@Example.COM` });
    await signUp(page, user);
    await expect(page.getByText(`Signed in as e2e-mixed-${id.toLowerCase()}@example.com`)).toBeVisible();
    await logOut(page);
    await logIn(page, `e2e-mixed-${id}@example.com`, user.password);
    await expect(page.getByRole("heading", { level: 1, name: `Hi, ${user.name.split(" ")[0]}` })).toBeVisible();
  });
});

test.describe("log in and out", () => {
  test("a demo user can log in and out", async ({ page }) => {
    await logIn(page, DEMO.renters.jordan.email, DEMO_PASSWORD);
    await expect(page.getByRole("heading", { level: 1, name: "Hi, Jordan" })).toBeVisible();
    await expect(page.getByText(`Signed in as ${DEMO.renters.jordan.email}`)).toBeVisible();
    // Jordan's demo reviews show up on the dashboard.
    await expect(page.getByRole("heading", { name: /^Reviews you've written \(\d+\)$/ })).toBeVisible();
    await expect(page.locator("article").filter({ hasText: "Responsive, fair, and honest" })).toBeVisible();

    // The session survives a reload and new tabs.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Hi, Jordan" })).toBeVisible();
    const tab = await page.context().newPage();
    await tab.goto("/dashboard");
    await expect(tab.getByRole("heading", { level: 1, name: "Hi, Jordan" })).toBeVisible();
    await tab.close();

    await logOut(page);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Sign up" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  });

  test("the session cookie is httpOnly and stops working after logout", async ({ page, browser }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    const cookie = (await page.context().cookies()).find((c) => c.name === SESSION_COOKIE);
    expect(cookie, "session cookie").toBeDefined();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.sameSite).toBe("Lax");
    expect(cookie!.value.length).toBeGreaterThanOrEqual(40);

    await logOut(page);
    expect((await page.context().cookies()).find((c) => c.name === SESSION_COOKIE)).toBeUndefined();

    // Replaying the old cookie must not log anyone in: the session was deleted server-side.
    const replay = await browser.newContext();
    await replay.addCookies([cookie!]);
    const replayPage = await replay.newPage();
    await replayPage.goto("/dashboard");
    await expect(replayPage).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await replay.close();
  });

  test("a wrong password or unknown email shows a generic error and keeps the email", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
    await fillLogin(page, DEMO.renters.jordan.email, "wrong-password");
    await expect(formAlert(page)).toHaveText("That email and password don't match an account.");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel("Email")).toHaveValue(DEMO.renters.jordan.email);
    await expect(page.getByLabel("Password")).toHaveValue("");

    await fillLogin(page, `nobody-${uid()}@example.com`, DEMO_PASSWORD);
    await expect(formAlert(page)).toHaveText("That email and password don't match an account.");
    await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);
  });

  test("validates the login form", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByText("Enter your password.")).toBeVisible();
  });

  test("email is case-insensitive and trimmed at login", async ({ page }) => {
    await page.goto("/login");
    await fillLogin(page, "  JORDAN@Example.com ", DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { level: 1, name: "Hi, Jordan" })).toBeVisible();
  });

  test("signed-in users visiting /login or /signup go to their dashboard", async ({ page }) => {
    await signUp(page, makeUser("landlord"));
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/signup");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/login?next=%2Frenters");
    await expect(page).toHaveURL(/\/renters$/);
  });
});

test.describe("redirects through login", () => {
  test("/dashboard sends you to log in and then back", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await fillLogin(page, DEMO.landlords.sam.email, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { level: 1, name: "Hi, Sam" })).toBeVisible();
  });

  test("/properties/new sends you to log in and then back", async ({ page }) => {
    await page.goto("/properties/new");
    await expect(page).toHaveURL(/\/login\?next=%2Fproperties%2Fnew$/);
    await fillLogin(page, DEMO.renters.tom.email, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/properties\/new$/);
    await expect(page.getByRole("heading", { level: 1, name: "Add a property" })).toBeVisible();
  });

  test("logging in from a profile page returns to it", async ({ page }) => {
    const path = await findPersonPath(page, "landlord", DEMO.landlords.priya.name);
    await page.goto(path);
    await page.locator("main").getByRole("link", { name: "Log in" }).click();
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent(path)}`);
    await fillLogin(page, DEMO.renters.marcus.email, DEMO_PASSWORD);
    await expect(page).toHaveURL(path);
    // Marcus already reviewed Priya, so he sees his own review in the form.
    await expect(page.getByRole("heading", { name: "Your review" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Update review" })).toBeVisible();
  });

  test("signing up from a profile page returns to it, ready to review", async ({ page }) => {
    const path = await findPersonPath(page, "landlord", DEMO.landlords.sam.name);
    await page.goto(path);
    await page.getByRole("link", { name: "Sign up as a renter" }).click();
    await expect(page).toHaveURL(`/signup?role=renter&next=${encodeURIComponent(path)}`);
    await expect(page.getByRole("radio", { name: "I'm a renter" })).toBeChecked();

    // The "Log in" link on the sign-up page keeps the return path too.
    await expect(page.locator("main").getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      `/login?next=${encodeURIComponent(path)}`,
    );

    const user = makeUser("renter");
    await page.getByLabel("Name", { exact: true }).fill(user.name);
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(path);
    await expect(page.getByRole("heading", { name: `Review ${DEMO.landlords.sam.name}` })).toBeVisible();
    await expect(page.getByRole("button", { name: "Post review" })).toBeVisible();
  });

  for (const evil of ["//evil.example", "https://evil.example/", "/\\evil.example", "javascript:alert(1)"]) {
    test(`ignores an off-site ?next=${evil}`, async ({ page, baseURL }) => {
      await page.goto(`/login?next=${encodeURIComponent(evil)}`);
      await expect(page.locator('input[name="next"]')).toHaveValue("/dashboard");
      await fillLogin(page, DEMO.renters.lena.email, DEMO_PASSWORD);
      await expect(page).toHaveURL(`${baseURL}/dashboard`);
    });
  }
});
