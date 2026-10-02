import { expect, test, type Locator, type Page } from "@playwright/test";
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
  roleCheckbox,
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
    await expect(page.getByText("No landlords have reviewed you yet")).toBeVisible();
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

  test("?role= preselects one role; the other can still be ticked too", async ({ page }) => {
    await page.goto("/signup?role=landlord");
    await expect(roleCheckbox(page, "landlord")).toBeChecked();
    await expect(roleCheckbox(page, "renter")).not.toBeChecked();
    // They're checkboxes, not radios: ticking one keeps the other.
    await expect(page.getByRole("radio")).toHaveCount(0);
    await roleCheckbox(page, "renter").check();
    await expect(roleCheckbox(page, "landlord")).toBeChecked();
    await expect(roleCheckbox(page, "renter")).toBeChecked();

    await page.goto("/signup?role=renter");
    await expect(roleCheckbox(page, "renter")).toBeChecked();
    await expect(roleCheckbox(page, "landlord")).not.toBeChecked();

    for (const role of ["admin", "both", ""]) {
      await page.goto(`/signup?role=${role}`);
      await expect(roleCheckbox(page, "renter"), role).not.toBeChecked();
      await expect(roleCheckbox(page, "landlord"), role).not.toBeChecked();
    }
  });

  test("shows every validation error and keeps what was typed (except the password)", async ({ page }) => {
    await page.goto("/signup");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(formAlert(page)).toHaveText("Please fix the highlighted fields.");
    await expect(page.getByText("Choose at least one: renter, landlord, or both.")).toBeVisible();
    // Each checkbox is marked invalid and described by the error (aria-invalid
    // isn't allowed on a fieldset/group).
    const roles = page.getByRole("group", { name: "I'm joining as a…" });
    await expect(roles).not.toHaveAttribute("aria-invalid");
    for (const role of ["renter", "landlord"] as const) {
      await expect(roleCheckbox(page, role), role).toHaveAttribute("aria-invalid", "true");
      await expect(roleCheckbox(page, role), role).toHaveAccessibleDescription(
        "Choose at least one: renter, landlord, or both.",
      );
    }
    // ...and the cards get the error colour.
    const renterCard = page.locator("label").filter({ has: roleCheckbox(page, "renter") });
    const errorBorder = await renterCard.evaluate((el) => getComputedStyle(el).borderTopColor);
    await expect(page.getByText("Name must be at least 2 characters.")).toBeVisible();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByText("Password must be at least 8 characters.")).toBeVisible();
    await expect(page).toHaveURL(/\/signup$/);

    // Fix some fields but not others.
    await roleCheckbox(page, "landlord").check();
    await page.getByLabel("Name", { exact: true }).fill("Al Bundy");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password").fill("short");
    await page.getByLabel("City").fill("Chicago, IL");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByText("Password must be at least 8 characters.")).toBeVisible();
    await expect(page.getByText("Name must be at least 2 characters.")).toHaveCount(0);
    await expect(page.getByText("Choose at least one: renter, landlord, or both.")).toHaveCount(0);
    for (const role of ["renter", "landlord"] as const) {
      await expect(roleCheckbox(page, role), role).not.toHaveAttribute("aria-invalid");
      await expect(roleCheckbox(page, role), role).not.toHaveAttribute("aria-describedby");
    }
    // The (still unticked) renter card is back to its normal border.
    expect(await renterCard.evaluate((el) => getComputedStyle(el).borderTopColor)).not.toBe(errorBorder);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Al Bundy");
    await expect(page.getByLabel("Email")).toHaveValue("not-an-email");
    await expect(page.getByLabel("City")).toHaveValue("Chicago, IL");
    await expect(page.getByLabel("Password")).toHaveValue("");
    await expect(roleCheckbox(page, "landlord")).toBeChecked();
    await expect(roleCheckbox(page, "renter")).not.toBeChecked();
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
    await expect(roleCheckbox(page, "renter")).toBeChecked();
    await expect(roleCheckbox(page, "landlord")).not.toBeChecked();
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
    await expect(roleCheckbox(page, "renter")).toBeChecked();
    await expect(roleCheckbox(page, "landlord")).not.toBeChecked();

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

  for (const evil of [
    "//evil.example",
    "https://evil.example/",
    "/\\evil.example",
    "javascript:alert(1)",
    // Dot-segments that a browser resolves to "//evil.example".
    "/.//evil.example",
    "/a/..//evil.example",
    "/%2e//evil.example",
  ]) {
    test(`ignores an off-site ?next=${evil}`, async ({ page, baseURL }) => {
      await page.goto(`/login?next=${encodeURIComponent(evil)}`);
      await expect(page.locator('input[name="next"]')).toHaveValue("/dashboard");
      await fillLogin(page, DEMO.renters.lena.email, DEMO_PASSWORD);
      await expect(page).toHaveURL(`${baseURL}/dashboard`);
    });
  }
});

test.describe("open redirect regressions", () => {
  test("/login?next=/.//evil.example ends on this site after logging in", async ({ page, baseURL }) => {
    await page.goto("/login?next=/.//evil.example");
    await fillLogin(page, DEMO.renters.lena.email, DEMO_PASSWORD);
    await expect(page).toHaveURL(`${baseURL}/dashboard`);
    expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
  });

  test("a signed-in visitor sent to /login?next=/.//evil.example stays on this site", async ({ page, baseURL, request }) => {
    await logIn(page, DEMO.renters.lena.email, DEMO_PASSWORD);
    await page.goto("/login?next=/.//evil.example");
    await expect(page).toHaveURL(`${baseURL}/dashboard`);

    // The raw redirect never points off-site, whatever the encoding.
    const cookies = await page.context().cookies();
    const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    for (const next of ["/.//evil.example", "/a/..//evil.example", "/%2e//evil.example", "/.%2F/evil.example"]) {
      const response = await request.get(`/login?next=${encodeURIComponent(next)}`, {
        headers: { cookie },
        maxRedirects: 0,
      });
      expect(response.status(), next).toBe(307);
      const location = response.headers()["location"];
      expect(new URL(location, baseURL).origin, `${next} -> ${location}`).toBe(new URL(baseURL!).origin);
      expect(location, next).not.toMatch(/^\/\//);
    }
  });

  test("a tampered hidden next field is also checked by the server", async ({ page, baseURL }) => {
    await page.goto("/login");
    await page.locator('input[name="next"]').evaluate((input) => {
      (input as HTMLInputElement).value = "/.//evil.example";
    });
    await fillLogin(page, DEMO.renters.lena.email, DEMO_PASSWORD);
    await expect(page).toHaveURL(`${baseURL}/dashboard`);
  });

  test("signing up with ?next=/.//evil.example ends on this site", async ({ page, baseURL }) => {
    await page.goto("/signup?next=/.//evil.example");
    await expect(page.locator('input[name="next"]')).toHaveValue("/dashboard");
    await expect(page.locator("main").getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    // Tamper with the hidden field as well, to reach the server-side check.
    await page.locator('input[name="next"]').evaluate((input) => {
      (input as HTMLInputElement).value = "/a/..//evil.example";
    });
    await fillSignup(page, makeUser("renter"));
    await expect(page).toHaveURL(`${baseURL}/dashboard`);
  });

  test("a non-ASCII return path works instead of crashing", async ({ page, baseURL }) => {
    const next = "/search?q=café";
    const response = await page.goto(`/login?next=${encodeURIComponent(next)}`);
    expect(response?.status()).toBe(200);
    await fillLogin(page, DEMO.renters.lena.email, DEMO_PASSWORD);
    await expect(page).toHaveURL(`${baseURL}/search?q=caf%C3%A9`);
    await expect(page.getByRole("heading", { level: 1, name: "Results for “café”" })).toBeVisible();

    // Signed in already: the server-side redirect is a valid, encoded Location.
    const again = await page.goto(`/login?next=${encodeURIComponent("/search?q=東京")}`);
    expect(again?.status()).toBe(200);
    await expect(page).toHaveURL(`${baseURL}/search?q=%E6%9D%B1%E4%BA%AC`);
  });

  test("dot segments inside this site still work as a return path", async ({ page, baseURL }) => {
    await page.goto(`/login?next=${encodeURIComponent("/landlords/../renters")}`);
    await expect(page.locator('input[name="next"]')).toHaveValue("/renters");
    await fillLogin(page, DEMO.renters.lena.email, DEMO_PASSWORD);
    await expect(page).toHaveURL(`${baseURL}/renters`);
  });
});

test.describe("changing your password", () => {
  async function passwordSection(page: Page) {
    return page.locator("section").filter({ has: page.getByRole("heading", { name: "Password & sessions" }) });
  }

  /** The three password fields ("New password" alone would also match "Confirm new password"). */
  function passwordFields(section: Locator) {
    return {
      current: section.getByLabel("Current password", { exact: true }),
      next: section.getByLabel("New password", { exact: true }),
      confirm: section.getByLabel("Confirm new password", { exact: true }),
    };
  }

  test("a wrong current password is rejected and the old password keeps working", async ({ page }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    const section = await passwordSection(page);
    const fields = passwordFields(section);
    await expect(section).toContainText("Changing your password signs you out everywhere else.");
    await fields.current.fill("not-my-password");
    await fields.next.fill("brand-new-password");
    await fields.confirm.fill("brand-new-password");
    await section.getByRole("button", { name: "Change password" }).click();
    await expect(section.getByRole("alert")).toHaveText("Please fix the highlighted fields.");
    await expect(section.getByText("That isn't your current password.")).toBeVisible();
    await expect(fields.current).toHaveAttribute("aria-invalid", "true");
    await expect(fields.current).toHaveAccessibleDescription("That isn't your current password.");
    await expect(fields.current).toBeFocused();

    await logOut(page);
    await logIn(page, user.email, user.password);
    await logOut(page);
    await page.goto("/login");
    await fillLogin(page, user.email, "brand-new-password");
    await expect(formAlert(page)).toHaveText("That email and password don't match an account.");
  });

  test("validates the new password", async ({ page }) => {
    const user = makeUser("landlord");
    await signUp(page, user);
    const section = await passwordSection(page);
    const fields = passwordFields(section);
    await expect(fields.confirm).toHaveAttribute("type", "password");
    await expect(fields.confirm).toHaveAttribute("autocomplete", "new-password");
    await section.getByRole("button", { name: "Change password" }).click();
    await expect(section.getByText("Enter your current password.")).toBeVisible();
    await expect(section.getByText("Password must be at least 8 characters.")).toBeVisible();
    await fields.current.fill(user.password);
    await fields.next.fill("short");
    await fields.confirm.fill("short");
    await section.getByRole("button", { name: "Change password" }).click();
    await expect(section.getByText("Password must be at least 8 characters.")).toBeVisible();
    await expect(section.getByText("Enter your current password.")).toHaveCount(0);
    await expect(section.getByText("The new passwords don't match.")).toHaveCount(0);
    await expect(fields.next).toBeFocused();
    // Passwords are never put back into the form.
    await expect(fields.current).toHaveValue("");
    await expect(fields.next).toHaveValue("");
    await expect(fields.confirm).toHaveValue("");
  });

  test("a confirmation that doesn't match is rejected and the old password keeps working", async ({ page }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    const section = await passwordSection(page);
    const fields = passwordFields(section);
    await fields.current.fill(user.password);
    await fields.next.fill("brand-new-password");
    await fields.confirm.fill("brand-new-passwrod");
    await section.getByRole("button", { name: "Change password" }).click();
    await expect(section.getByRole("alert")).toHaveText("Please fix the highlighted fields.");
    await expect(fields.confirm).toHaveAttribute("aria-invalid", "true");
    await expect(fields.confirm).toHaveAccessibleDescription("The new passwords don't match.");
    await expect(fields.confirm).toBeFocused();
    // Only the confirmation is flagged.
    await expect(fields.current).not.toHaveAttribute("aria-invalid", "true");
    await expect(fields.next).not.toHaveAttribute("aria-invalid", "true");
    await expect(section.getByText("That isn't your current password.")).toHaveCount(0);
    await expect(fields.confirm).toHaveValue("");

    // Nothing changed.
    await logOut(page);
    await logIn(page, user.email, user.password);
    await logOut(page);
    await page.goto("/login");
    await fillLogin(page, user.email, "brand-new-password");
    await expect(formAlert(page)).toHaveText("That email and password don't match an account.");
  });

  test("success: new password works, old one doesn't, and other sessions are signed out", async ({ page, browser }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    // The same account, signed in on another device.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await logIn(otherPage, user.email, user.password);
    // And someone else entirely, who must stay signed in.
    const bystander = await browser.newContext();
    const bystanderPage = await bystander.newPage();
    await logIn(bystanderPage, DEMO.renters.tom.email, DEMO_PASSWORD);

    const newPassword = `changed-${uid()}`;
    await page.goto("/dashboard");
    const section = await passwordSection(page);
    const fields = passwordFields(section);
    await fields.current.fill(user.password);
    await fields.next.fill(newPassword);
    await fields.confirm.fill(newPassword);
    await section.getByRole("button", { name: "Change password" }).click();
    const status = section.getByRole("status");
    await expect(status).toHaveText("Password changed. You've been signed out on your other devices.");
    await expect(status).toBeFocused();
    await expect(fields.current).toHaveValue("");
    await expect(fields.confirm).toHaveValue("");

    // This browser stays signed in.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: `Hi, ${user.name.split(" ")[0]}` })).toBeVisible();
    // The other device is signed out.
    await otherPage.goto("/dashboard");
    await expect(otherPage).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await bystanderPage.goto("/dashboard");
    await expect(bystanderPage.getByRole("heading", { level: 1, name: "Hi, Tom" })).toBeVisible();

    // Old password no longer works; the new one does (also with odd email casing).
    await fillLogin(otherPage, user.email, user.password);
    await expect(formAlert(otherPage)).toHaveText("That email and password don't match an account.");
    await fillLogin(otherPage, user.email.toUpperCase(), newPassword);
    await expect(otherPage).toHaveURL(/\/dashboard$/);
    await other.close();
    await bystander.close();
  });
});

test.describe("signing out other devices", () => {
  const SIGNED_OUT = "You've been signed out on all your other devices.";

  function signOutSection(page: Page): Locator {
    return page.locator("form").filter({ has: page.getByRole("button", { name: "Sign out other devices" }) });
  }

  test("ends every other session for the account and keeps this one", async ({ page, browser }) => {
    const user = makeUser("landlord");
    await signUp(page, user);
    const devices = await Promise.all([browser.newContext(), browser.newContext()]);
    const devicePages = [];
    for (const device of devices) {
      const devicePage = await device.newPage();
      await logIn(devicePage, user.email, user.password);
      devicePages.push(devicePage);
    }
    const bystander = await browser.newContext();
    const bystanderPage = await bystander.newPage();
    await logIn(bystanderPage, DEMO.landlords.priya.email, DEMO_PASSWORD);

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Sign out other devices" }).click();
    // The message shows right by the button, without leaving the page.
    const status = signOutSection(page).getByRole("status");
    await expect(status).toHaveText(SIGNED_OUT);
    await expect(status).toBeFocused();
    await expect(page).toHaveURL(/\/dashboard$/);
    // It's the only message on the page (the password form has none).
    await expect(page.getByRole("main").getByRole("status")).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: `Hi, ${user.name.split(" ")[0]}` })).toBeVisible();
    // A one-off message: it's gone after a reload.
    await expect(page.getByText(SIGNED_OUT)).toHaveCount(0);

    for (const devicePage of devicePages) {
      await devicePage.goto("/dashboard");
      await expect(devicePage).toHaveURL(/\/login\?next=%2Fdashboard$/);
    }
    await bystanderPage.goto("/dashboard");
    await expect(bystanderPage.getByRole("heading", { level: 1, name: "Hi, Priya" })).toBeVisible();

    // The password didn't change: the other devices can sign in again.
    await fillLogin(devicePages[0], user.email, user.password);
    await expect(devicePages[0]).toHaveURL(/\/dashboard$/);
    for (const context of [...devices, bystander]) await context.close();
  });

  test("the old ?signedOut=others link no longer shows a message", async ({ page }) => {
    await signUp(page, makeUser("renter"));
    await page.goto("/dashboard?signedOut=others");
    await expect(page.getByRole("heading", { level: 1, name: /^Hi, / })).toBeVisible();
    await expect(page.getByText(SIGNED_OUT)).toHaveCount(0);
  });

  test("works without JavaScript", async ({ browser }) => {
    const user = makeUser("renter");
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await page.goto("/signup");
    await roleCheckbox(page, "renter").check();
    await page.getByLabel("Name", { exact: true }).fill(user.name);
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await logIn(otherPage, user.email, user.password);

    await page.getByRole("button", { name: "Sign out other devices" }).click();
    await expect(signOutSection(page).getByRole("status")).toHaveText(SIGNED_OUT);
    await expect(page).toHaveURL(/\/dashboard$/);
    await otherPage.goto("/dashboard");
    await expect(otherPage).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await context.close();
    await other.close();
  });

  test("a stale tab of a signed-out device is asked to log in again", async ({ page, browser }) => {
    const user = makeUser("renter");
    await signUp(page, user);
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await logIn(otherPage, user.email, user.password);
    // Signed out remotely while this tab still shows the dashboard.
    await page.getByRole("button", { name: "Sign out other devices" }).click();
    await expect(signOutSection(page).getByRole("status")).toHaveText(SIGNED_OUT);
    // Its next action finds no session.
    await otherPage.getByRole("button", { name: "Sign out other devices" }).click();
    const alert = signOutSection(otherPage).getByRole("alert");
    await expect(alert).toHaveText("Please log in again.");
    await expect(alert).toBeFocused();
    await otherPage.reload();
    await expect(otherPage).toHaveURL(/\/login\?next=%2Fdashboard$/);
    // The signed-in tab is unaffected.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: `Hi, ${user.name.split(" ")[0]}` })).toBeVisible();
    await other.close();
  });
});
