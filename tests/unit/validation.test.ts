import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  formValues,
  idleFormState,
  loginSchema,
  parseForm,
  passwordChangeSchema,
  profileSchema,
  propertySchema,
  reviewSchema,
  roleChangeSchema,
  safeRedirectPath,
  signupSchema,
  stripNul,
} from "@/lib/validation";

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/** Field errors for a failed parse, e.g. { email: ["Enter a valid email address."] }. */
function fieldErrors(schema: z.ZodType, input: unknown) {
  const result = schema.safeParse(input);
  expect(result.success).toBe(false);
  return z.flattenError(result.error!).fieldErrors as Record<string, string[] | undefined>;
}

describe("signupSchema", () => {
  const valid = {
    name: "Jordan Ellis",
    email: "jordan@example.com",
    password: "password123",
    isRenter: "on",
    city: "Austin, TX",
  };

  it("accepts a valid signup, turning the ticked checkboxes into booleans", () => {
    expect(signupSchema.parse(valid)).toEqual({ ...valid, isRenter: true, isLandlord: false });
  });

  it("trims the name and city, and trims + lowercases the email", () => {
    const data = signupSchema.parse({
      ...valid,
      name: "  Jordan Ellis  ",
      email: "  Jordan.Ellis@Example.COM ",
      city: "  Austin, TX ",
    });
    expect(data.name).toBe("Jordan Ellis");
    expect(data.email).toBe("jordan.ellis@example.com");
    expect(data.city).toBe("Austin, TX");
  });

  it("does not trim or alter the password", () => {
    const data = signupSchema.parse({ ...valid, password: "  Pass Word 1  " });
    expect(data.password).toBe("  Pass Word 1  ");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace only", "   \t "],
  ])("turns a %s city into null", (_label, city) => {
    expect(signupSchema.parse({ ...valid, city }).city).toBeNull();
  });

  it.each([
    ["renter only", { isRenter: "on" }, { isRenter: true, isLandlord: false }],
    ["landlord only", { isLandlord: "on" }, { isRenter: false, isLandlord: true }],
    ["both", { isRenter: "on", isLandlord: "on" }, { isRenter: true, isLandlord: true }],
    // `value="true"` (e.g. a hidden input or a script) counts as ticked too.
    ["both, sent as true", { isRenter: "true", isLandlord: "true" }, { isRenter: true, isLandlord: true }],
  ])("accepts %s", (_label, roles, expected) => {
    const rest: Partial<typeof valid> = { ...valid };
    delete rest.isRenter;
    expect(signupSchema.parse({ ...rest, ...roles })).toMatchObject(expected);
  });

  it.each([
    ["no role at all", {}],
    ["empty values", { isRenter: "", isLandlord: "" }],
    ["unticked-looking values", { isRenter: "off", isLandlord: "false" }],
    ["other strings", { isRenter: "yes", isLandlord: "1" }],
    ["a different casing", { isRenter: "ON", isLandlord: "True" }],
    ["the old single-role field", { role: "renter" }],
  ])("asks for at least one role when given %s", (_label, roles) => {
    const rest: Partial<typeof valid> = { ...valid };
    delete rest.isRenter;
    const errors = fieldErrors(signupSchema, { ...rest, ...roles });
    expect(errors).toEqual({ roles: ["Choose at least one: renter, landlord, or both."] });
  });

  it("rejects a non-string checkbox value (a tampered request)", () => {
    expect(signupSchema.safeParse({ ...valid, isLandlord: ["on"] }).success).toBe(false);
  });

  it("requires a name of 2–80 characters after trimming", () => {
    expect(fieldErrors(signupSchema, { ...valid, name: "  J  " }).name).toEqual([
      "Name must be at least 2 characters.",
    ]);
    expect(fieldErrors(signupSchema, { ...valid, name: "x".repeat(81) }).name).toEqual([
      "Name must be 80 characters or fewer.",
    ]);
    expect(signupSchema.parse({ ...valid, name: "x".repeat(80) }).name).toHaveLength(80);
    // Padding doesn't count towards the limit.
    expect(signupSchema.parse({ ...valid, name: `  ${"x".repeat(80)}  ` }).name).toHaveLength(80);
  });

  it.each([["not-an-email"], ["jordan@"], ["@example.com"], ["jordan example.com"], [""]])(
    "rejects invalid email %j",
    (email) => {
      expect(fieldErrors(signupSchema, { ...valid, email }).email).toEqual([
        "Enter a valid email address.",
      ]);
    },
  );

  it("rejects overly long emails", () => {
    const email = `${"a".repeat(250)}@example.com`;
    expect(fieldErrors(signupSchema, { ...valid, email }).email).toEqual(["Email is too long."]);
  });

  it("requires a password of 8–128 characters", () => {
    expect(fieldErrors(signupSchema, { ...valid, password: "1234567" }).password).toEqual([
      "Password must be at least 8 characters.",
    ]);
    expect(fieldErrors(signupSchema, { ...valid, password: "x".repeat(129) }).password).toEqual([
      "Password must be 128 characters or fewer.",
    ]);
    expect(signupSchema.parse({ ...valid, password: "12345678" }).password).toBe("12345678");
    expect(signupSchema.parse({ ...valid, password: "x".repeat(128) }).password).toHaveLength(128);
  });

  it("rejects a city over 80 characters", () => {
    expect(fieldErrors(signupSchema, { ...valid, city: "x".repeat(81) }).city).toEqual([
      "City must be 80 characters or fewer.",
    ]);
  });

  it("reports every invalid field at once, including a missing role", () => {
    const errors = fieldErrors(signupSchema, { name: "J", email: "nope", password: "1" });
    expect(Object.keys(errors).sort()).toEqual(["email", "name", "password", "roles"]);
  });
});

describe("roleChangeSchema", () => {
  it.each([
    ["landlord", "add"],
    ["landlord", "remove"],
    ["renter", "add"],
    ["renter", "remove"],
  ])("accepts %s / %s", (role, change) => {
    expect(roleChangeSchema.parse({ role, change })).toEqual({ role, change });
  });

  it.each([
    [{ role: "admin", change: "add" }],
    [{ role: "renter", change: "toggle" }],
    [{ role: "", change: "add" }],
    [{ role: "Landlord", change: "add" }],
    [{ change: "add" }],
    [{ role: "renter" }],
  ])("rejects %j", (input) => {
    expect(roleChangeSchema.safeParse(input).success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("trims and lowercases the email", () => {
    expect(loginSchema.parse({ email: " Maria@Example.com ", password: "pw" })).toEqual({
      email: "maria@example.com",
      password: "pw",
    });
  });

  it("requires a password but doesn't apply signup's length rules", () => {
    expect(fieldErrors(loginSchema, { email: "a@b.co", password: "" }).password).toEqual([
      "Enter your password.",
    ]);
    expect(loginSchema.parse({ email: "a@b.co", password: "x" }).password).toBe("x");
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x".repeat(129) }).success).toBe(false);
  });

  it("rejects an invalid email", () => {
    expect(fieldErrors(loginSchema, { email: "maria", password: "pw" }).email).toEqual([
      "Enter a valid email address.",
    ]);
  });
});

describe("profileSchema", () => {
  it("trims values and turns blank optional fields into null", () => {
    expect(profileSchema.parse({ name: "  Maria  ", city: "  ", bio: "" })).toEqual({
      name: "Maria",
      city: null,
      bio: null,
    });
    expect(profileSchema.parse({ name: "Maria" })).toEqual({ name: "Maria", city: null, bio: null });
  });

  it("keeps a trimmed bio and enforces its 500 character limit", () => {
    expect(profileSchema.parse({ name: "Maria", bio: "  Hi there.  " }).bio).toBe("Hi there.");
    expect(profileSchema.parse({ name: "Maria", bio: "x".repeat(500) }).bio).toHaveLength(500);
    expect(fieldErrors(profileSchema, { name: "Maria", bio: "x".repeat(501) }).bio).toEqual([
      "Bio must be 500 characters or fewer.",
    ]);
  });

  it("validates the name like signup does", () => {
    expect(fieldErrors(profileSchema, { name: " " }).name).toEqual([
      "Name must be at least 2 characters.",
    ]);
  });
});

describe("reviewSchema", () => {
  const valid = {
    kind: "landlord",
    subjectId: UUID,
    rating: "4",
    title: "Great landlord",
    body: "Fixed everything quickly and returned the deposit.",
  };

  it("coerces the rating from a form string to a number", () => {
    const data = reviewSchema.parse(valid);
    expect(data.rating).toBe(4);
    expect(typeof data.rating).toBe("number");
    expect(reviewSchema.parse({ ...valid, rating: 1 }).rating).toBe(1);
    expect(reviewSchema.parse({ ...valid, rating: "5" }).rating).toBe(5);
  });

  it.each([["0"], ["6"], ["-1"], ["100"], [""]])("rejects out-of-range rating %j", (rating) => {
    expect(fieldErrors(reviewSchema, { ...valid, rating }).rating).toEqual([
      "Pick a star rating from 1 to 5.",
    ]);
  });

  it("rejects fractional ratings", () => {
    expect(fieldErrors(reviewSchema, { ...valid, rating: "3.5" }).rating).toEqual([
      "Pick a star rating.",
    ]);
  });

  it("rejects a non-numeric rating", () => {
    expect(fieldErrors(reviewSchema, { ...valid, rating: "abc" }).rating).toHaveLength(1);
  });

  // When no star is picked the browser doesn't send `rating` at all.
  it("asks the user to pick a star when no rating was sent", () => {
    const withoutRating: Partial<typeof valid> = { ...valid };
    delete withoutRating.rating;
    expect(fieldErrors(reviewSchema, withoutRating).rating?.[0]).toMatch(/pick a star rating/i);
  });

  it("trims the title and body and enforces their minimum lengths after trimming", () => {
    const data = reviewSchema.parse({ ...valid, title: "  Nice  ", body: `  ${valid.body}  ` });
    expect(data.title).toBe("Nice");
    expect(data.body).toBe(valid.body);

    expect(fieldErrors(reviewSchema, { ...valid, title: "  ab  " }).title).toEqual([
      "Title must be at least 3 characters.",
    ]);
    expect(fieldErrors(reviewSchema, { ...valid, body: `   ${"x".repeat(19)}   ` }).body).toEqual([
      "Your review must be at least 20 characters.",
    ]);
    expect(reviewSchema.parse({ ...valid, body: "x".repeat(20) }).body).toHaveLength(20);
  });

  it("enforces the maximum title and body lengths", () => {
    expect(fieldErrors(reviewSchema, { ...valid, title: "x".repeat(121) }).title).toEqual([
      "Title must be 120 characters or fewer.",
    ]);
    expect(fieldErrors(reviewSchema, { ...valid, body: "x".repeat(5001) }).body).toEqual([
      "Your review must be 5,000 characters or fewer.",
    ]);
    expect(reviewSchema.parse({ ...valid, body: "x".repeat(5000) }).body).toHaveLength(5000);
  });

  it("only accepts the three review kinds", () => {
    for (const kind of ["landlord", "renter", "property"]) {
      expect(reviewSchema.parse({ ...valid, kind }).kind).toBe(kind);
    }
    expect(fieldErrors(reviewSchema, { ...valid, kind: "admin" }).kind).toHaveLength(1);
  });

  it("requires the subject id to be a UUID", () => {
    expect(fieldErrors(reviewSchema, { ...valid, subjectId: "123" }).subjectId).toEqual([
      "That review target doesn't exist.",
    ]);
    expect(fieldErrors(reviewSchema, { ...valid, subjectId: "" }).subjectId).toEqual([
      "That review target doesn't exist.",
    ]);
  });
});

describe("propertySchema", () => {
  const valid = {
    address: "1408 E 6th St",
    unit: "2B",
    city: "Austin",
    region: "TX",
    postalCode: "78702",
    description: "One-bedroom apartment above a bakery.",
    landlordId: UUID,
  };

  it("accepts a full property", () => {
    expect(propertySchema.parse(valid)).toEqual(valid);
  });

  it("trims every field", () => {
    const data = propertySchema.parse({
      address: "  1408 E 6th St ",
      unit: " 2B ",
      city: " Austin ",
      region: " TX ",
      postalCode: " 78702 ",
      description: "  Bakery below.  ",
    });
    expect(data).toEqual({
      address: "1408 E 6th St",
      unit: "2B",
      city: "Austin",
      region: "TX",
      postalCode: "78702",
      description: "Bakery below.",
    });
    // No landlord field at all stays undefined (the form had no picker)...
    expect(data.landlordId).toBeUndefined();
    // ...while a blank picker means "not on GossipRent / not sure".
    expect(propertySchema.parse({ ...valid, landlordId: "" }).landlordId).toBeNull();
  });

  it("turns blank or missing optional fields into null", () => {
    expect(
      propertySchema.parse({
        address: "1 Main St",
        unit: "",
        city: "Austin",
        region: "TX",
        postalCode: "   ",
        landlordId: "",
      }),
    ).toEqual({
      address: "1 Main St",
      unit: null,
      city: "Austin",
      region: "TX",
      postalCode: null,
      description: null,
      landlordId: null,
    });
  });

  it("requires address, city, and region", () => {
    const errors = fieldErrors(propertySchema, { address: " ", city: "", region: "T" });
    expect(errors.address).toEqual(["Enter the street address."]);
    expect(errors.city).toEqual(["Enter the city."]);
    expect(errors.region).toEqual(["Enter the state, province, or region."]);
  });

  it("enforces maximum lengths", () => {
    const errors = fieldErrors(propertySchema, {
      ...valid,
      address: "x".repeat(201),
      unit: "x".repeat(31),
      postalCode: "x".repeat(21),
      description: "x".repeat(301),
    });
    expect(errors.address).toEqual(["Address must be 200 characters or fewer."]);
    expect(errors.unit).toEqual(["Unit must be 30 characters or fewer."]);
    expect(errors.postalCode).toEqual(["Postal code must be 20 characters or fewer."]);
    expect(errors.description).toEqual(["Description must be 300 characters or fewer."]);
  });

  it("rejects a landlord id that isn't a UUID", () => {
    expect(fieldErrors(propertySchema, { ...valid, landlordId: "maria" }).landlordId).toEqual([
      "Choose a landlord from the list.",
    ]);
  });

  it('accepts "me" (the person adding it manages it) as the landlord', () => {
    expect(propertySchema.parse({ ...valid, landlordId: "me" }).landlordId).toBe("me");
  });

  it.each([["Me"], ["ME"], [" me"], ["myself"], ["self"]])("rejects landlord %j", (landlordId) => {
    expect(fieldErrors(propertySchema, { ...valid, landlordId }).landlordId).toEqual([
      "Choose a landlord from the list.",
    ]);
  });

  it.each([["own"], ["rent"]])('accepts relation "%s" (own or rent the place)', (relation) => {
    expect(propertySchema.parse({ ...valid, relation }).relation).toBe(relation);
  });

  it("relation is optional (only people with both roles are asked)", () => {
    expect(propertySchema.parse(valid).relation).toBeUndefined();
  });

  it.each([["Own"], ["manage"], [""], ["landlord"]])("rejects relation %j with a readable message", (relation) => {
    expect(fieldErrors(propertySchema, { ...valid, relation }).relation).toEqual([
      "Choose whether you own or rent this place.",
    ]);
  });
});

describe("formValues", () => {
  it("returns plain string fields, skipping passwords, files, and React's $ACTION fields", () => {
    const form = new FormData();
    form.set("email", "a@b.co");
    form.set("password", "secret123");
    form.set("name", "  Spaced  ");
    form.set("$ACTION_ID_abc", "");
    form.set("$ACTION_REF_1", "x");
    form.set("upload", new Blob(["data"]), "file.txt");
    expect(formValues(form)).toEqual({ email: "a@b.co", name: "  Spaced  " });
  });

  it("skips every password-like field and strips NUL characters", () => {
    const form = new FormData();
    form.set("currentPassword", "old-secret");
    form.set("newPassword", "new-secret");
    form.set("title", "Nice\u0000 place");
    expect(formValues(form)).toEqual({ title: "Nice place" });
  });
});

describe("parseForm", () => {
  it("returns parsed data on success", () => {
    const form = new FormData();
    form.set("email", " USER@Example.com ");
    form.set("password", "pw");
    expect(parseForm(loginSchema, form)).toEqual({
      success: true,
      data: { email: "user@example.com", password: "pw" },
    });
  });

  it("returns an error state with field errors and the submitted values (minus the password)", () => {
    const form = new FormData();
    form.set("name", "J");
    form.set("email", "bad");
    form.set("password", "short");
    form.set("isRenter", "on");
    form.set("city", "Austin");
    const result = parseForm(signupSchema, form);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.state.status).toBe("error");
    expect(result.state.message).toBe("Please fix the highlighted fields.");
    expect(result.state.fieldErrors).toEqual({
      name: ["Name must be at least 2 characters."],
      email: ["Enter a valid email address."],
      password: ["Password must be at least 8 characters."],
    });
    expect(result.state.values).toEqual({ name: "J", email: "bad", isRenter: "on", city: "Austin" });
  });

  it("echoes the chosen star rating so the form can re-select it", () => {
    const form = new FormData();
    form.set("kind", "landlord");
    form.set("subjectId", UUID);
    form.set("rating", "3");
    form.set("title", "ok");
    form.set("body", "too short");
    const result = parseForm(reviewSchema, form);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.state.values?.rating).toBe("3");
    expect(Object.keys(result.state.fieldErrors ?? {}).sort()).toEqual(["body", "title"]);
  });

  it("exposes an idle initial state", () => {
    expect(idleFormState).toEqual({ status: "idle" });
  });
});

describe("safeRedirectPath", () => {
  it.each([
    ["/", "/"],
    ["/dashboard", "/dashboard"],
    ["/landlords/3f2504e0-4f89-41d3-9a0c-0305e82c3301", "/landlords/3f2504e0-4f89-41d3-9a0c-0305e82c3301"],
    ["/ok?x=1", "/ok?x=1"],
    ["/search?q=a%20b&sort=top#reviews", "/search?q=a%20b&sort=top#reviews"],
    ["/%2F%2Fevil.com", "/%2F%2Fevil.com"], // encoded slashes stay a same-origin path
  ])("allows same-site path %j", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    ["protocol-relative", "//evil.com"],
    ["protocol-relative with path", "//evil.com/landlords"],
    ["triple slash", "///evil.com"],
    ["backslash", "/\\evil.com"],
    ["double backslash", "\\\\evil.com"],
    ["tab", "/\t/evil.com"],
    ["newline", "/\n/evil.com"],
    ["carriage return", "/\r/evil.com"],
    ["null byte", "/\u0000/evil.com"],
    ["DEL", "/\u007f/evil.com"],
    ["absolute https URL", "https://x"],
    ["absolute http URL", "http://evil.com/"],
    ["javascript URL", "javascript:alert(1)"],
    ["data URL", "data:text/html,hi"],
    ["relative path", "dashboard"],
    ["leading space", " /dashboard"],
    ["empty string", ""],
  ])("rejects %s", (_label, input) => {
    expect(safeRedirectPath(input)).toBe("/");
  });

  it.each([[undefined], [null], [42], [["/dashboard"]], [{ path: "/" }]])(
    "rejects non-string value %j",
    (input) => {
      expect(safeRedirectPath(input)).toBe("/");
    },
  );

  it("uses the given fallback", () => {
    expect(safeRedirectPath("//evil.com", "/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath(undefined, "/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("/renters", "/dashboard")).toBe("/renters");
  });

  it("never returns something a browser would resolve to another origin", () => {
    const tricky = [
      "//evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "/\n\n//evil.com",
      "\t//evil.com",
      "https://x",
      "/ok?x=1",
      "/.//evil.com",
      "/%5Cevil.com",
    ];
    for (const input of tricky) {
      const result = safeRedirectPath(input);
      expect(new URL(result, "https://gossiprent.example").origin).toBe("https://gossiprent.example");
    }
  });
});

describe("safeRedirectPath normalization", () => {
  it.each([
    ["dot segment before a double slash", "/.//evil.example"],
    ["dot segment, path after the host", "/.//evil.example/landlords"],
    ["parent segment before a double slash", "/a/..//evil.example"],
    ["several parent segments", "/a/b/../..//evil.example"],
    ["percent-encoded dot segment", "/%2e//evil.example"],
    ["percent-encoded parent segment", "/x/%2E%2E//evil.example"],
    ["dot segment before a triple slash", "/.///evil.example"],
  ])("rejects a %s (%j) that a browser would resolve to another host", (_label, input) => {
    expect(safeRedirectPath(input)).toBe("/");
    expect(safeRedirectPath(input, "/dashboard")).toBe("/dashboard");
  });

  it.each([
    ["/./dashboard", "/dashboard"],
    ["/a/../dashboard", "/dashboard"],
    ["/../../dashboard", "/dashboard"],
    ["/landlords/./x/../", "/landlords/"],
    ["/%2e%2e/renters", "/renters"],
    ["/.", "/"],
    ["/..", "/"],
  ])("resolves dot segments in %j to %j", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    ["/landlords/café", "/landlords/caf%C3%A9"],
    ["/søk?q=æble", "/s%C3%B8k?q=%C3%A6ble"],
    ["/renters#über", "/renters#%C3%BCber"],
    ["/😀", "/%F0%9F%98%80"],
    ["/東京", "/%E6%9D%B1%E4%BA%AC"],
    ["/a b", "/a%20b"],
  ])("percent-encodes non-ASCII and spaces: %j becomes %j", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it("keeps already-encoded characters as they are (no double encoding or decoding)", () => {
    expect(safeRedirectPath("/landlords/caf%C3%A9")).toBe("/landlords/caf%C3%A9");
    expect(safeRedirectPath("/%5Cevil.com")).toBe("/%5Cevil.com");
    expect(safeRedirectPath("/search?q=a%2Fb%2F%2Fc")).toBe("/search?q=a%2Fb%2F%2Fc");
  });

  it("keeps a double slash inside the query or hash (it can't change the host)", () => {
    expect(safeRedirectPath("/login?next=//evil.example")).toBe("/login?next=//evil.example");
    expect(safeRedirectPath("/renters#//evil.example")).toBe("/renters#//evil.example");
  });

  it("encodes look-alike slashes instead of treating them as separators", () => {
    // Fullwidth solidus and division slash are just characters in a path.
    expect(safeRedirectPath("/\uFF0Fevil.example")).toBe("/%EF%BC%8Fevil.example");
    expect(safeRedirectPath("/\u2215evil.example")).toBe("/%E2%88%95evil.example");
  });

  it("always returns a same-origin, ASCII-only value that can go in a Location header", () => {
    const inputs = [
      "/.//evil.example",
      "/a/..//evil.example",
      "/%2e//evil.example",
      "/landlords/café",
      "/😀?q=☃#ü",
      "/\u2028/evil.example",
      "/\u00a0//evil.example",
      "/./\uFF0F/evil.example",
      "/ok",
    ];
    for (const input of inputs) {
      const result = safeRedirectPath(input);
      expect(result, input).toMatch(/^\/(?!\/)[\x21-\x7e]*$/);
      expect(new URL(result, "https://gossiprent.example").origin, input).toBe("https://gossiprent.example");
      // Resolving the result again doesn't change it (it's already normalized).
      expect(safeRedirectPath(result), input).toBe(result);
    }
  });
});

describe("stripNul", () => {
  it("removes every NUL character", () => {
    expect(stripNul("a\u0000b")).toBe("ab");
    expect(stripNul("\u0000a\u0000\u0000b\u0000")).toBe("ab");
    expect(stripNul("\u0000")).toBe("");
  });

  it("returns other strings unchanged, including other control characters", () => {
    const text = "Line one\nLine two\tTabbed \u0001 Ünïcødé";
    expect(stripNul(text)).toBe(text);
    expect(stripNul("")).toBe("");
  });

  it("is applied to parsed form input, so NULs can't reach the database", () => {
    const form = new FormData();
    form.set("kind", "landlord");
    form.set("subjectId", UUID);
    form.set("rating", "4");
    form.set("title", "Great\u0000 place");
    form.set("body", "Pasted from a PDF:\u0000 the heating was broken all winter.");
    const result = parseForm(reviewSchema, form);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.title).toBe("Great place");
    expect(result.data.body).toBe("Pasted from a PDF: the heating was broken all winter.");
  });

  it("strips NULs before length checks (a NUL-padded title is still too short)", () => {
    const form = new FormData();
    form.set("kind", "landlord");
    form.set("subjectId", UUID);
    form.set("rating", "4");
    form.set("title", "a\u0000\u0000\u0000\u0000b");
    form.set("body", "x".repeat(25));
    const result = parseForm(reviewSchema, form);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.state.fieldErrors?.title).toEqual(["Title must be at least 3 characters."]);
    expect(result.state.values?.title).toBe("ab");
  });
});

describe("passwordChangeSchema", () => {
  /** A valid change, with the new password confirmed. */
  const change = (currentPassword: string, newPassword: string, confirmPassword = newPassword) => ({
    currentPassword,
    newPassword,
    confirmPassword,
  });

  it("accepts a current password and a confirmed new one of 8+ characters, untouched", () => {
    expect(passwordChangeSchema.parse(change(" old pw ", "  new password  "))).toEqual({
      currentPassword: " old pw ",
      newPassword: "  new password  ",
      confirmPassword: "  new password  ",
    });
  });

  it("requires the current password but not any particular length for it", () => {
    expect(fieldErrors(passwordChangeSchema, change("", "long-enough")).currentPassword).toEqual([
      "Enter your current password.",
    ]);
    expect(passwordChangeSchema.safeParse(change("x", "long-enough")).success).toBe(true);
    expect(
      fieldErrors(passwordChangeSchema, { newPassword: "long-enough", confirmPassword: "long-enough" }).currentPassword,
    ).toBeDefined();
  });

  it("applies the sign-up password rules to the new password", () => {
    expect(fieldErrors(passwordChangeSchema, change("old", "short")).newPassword).toEqual([
      "Password must be at least 8 characters.",
    ]);
    expect(fieldErrors(passwordChangeSchema, change("old", "x".repeat(129))).newPassword).toEqual([
      "Password must be 128 characters or fewer.",
    ]);
    expect(passwordChangeSchema.safeParse(change("old", "x".repeat(128))).success).toBe(true);
    expect(passwordChangeSchema.safeParse(change("old", "x".repeat(8))).success).toBe(true);
  });

  it("caps the current password at 128 characters (no huge inputs to the hasher)", () => {
    expect(fieldErrors(passwordChangeSchema, change("x".repeat(129), "long-enough")).currentPassword).toHaveLength(1);
  });

  it("requires the confirmation to match the new password exactly", () => {
    expect(fieldErrors(passwordChangeSchema, change("old", "long-enough", "long-enougH"))).toEqual({
      confirmPassword: ["The new passwords don't match."],
    });
    // No trimming: a stray space is a different password.
    expect(fieldErrors(passwordChangeSchema, change("old", "long-enough", "long-enough ")).confirmPassword).toEqual([
      "The new passwords don't match.",
    ]);
    expect(fieldErrors(passwordChangeSchema, change("old", "long-enough", "")).confirmPassword).toEqual([
      "The new passwords don't match.",
    ]);
  });

  it("a too-long new password typed twice only gets friendly messages", () => {
    const errors = fieldErrors(passwordChangeSchema, change("old", "x".repeat(129)));
    expect(errors.newPassword).toEqual(["Password must be 128 characters or fewer."]);
    for (const message of errors.confirmPassword ?? []) expect(message).not.toMatch(/Too big|expected string/);
  });

  it("requires the confirmation field", () => {
    expect(
      fieldErrors(passwordChangeSchema, { currentPassword: "old", newPassword: "long-enough" }).confirmPassword,
    ).toBeDefined();
  });

  it("reports every field at once", () => {
    const errors = fieldErrors(passwordChangeSchema, change("", "", "different"));
    expect(Object.keys(errors).sort()).toEqual(["confirmPassword", "currentPassword", "newPassword"]);
    // An empty confirmation of an empty new password only needs the one message.
    expect(Object.keys(fieldErrors(passwordChangeSchema, change("", ""))).sort()).toEqual([
      "currentPassword",
      "newPassword",
    ]);
  });

  it("never echoes any password back to the form", () => {
    const form = new FormData();
    form.set("currentPassword", "my-old-secret");
    form.set("newPassword", "my-new-secret");
    form.set("confirmPassword", "my-new-secreT");
    const result = parseForm(passwordChangeSchema, form);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.state.fieldErrors).toEqual({ confirmPassword: ["The new passwords don't match."] });
    expect(result.state.values).toEqual({});
    expect(JSON.stringify(result.state)).not.toMatch(/my-(old|new)-secre/);
  });
});

