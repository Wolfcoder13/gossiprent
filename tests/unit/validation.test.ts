import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  formValues,
  idleFormState,
  loginSchema,
  parseForm,
  profileSchema,
  propertySchema,
  reviewSchema,
  roleSchema,
  safeRedirectPath,
  signupSchema,
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
    role: "renter",
    city: "Austin, TX",
  };

  it("accepts a valid signup", () => {
    expect(signupSchema.parse(valid)).toEqual(valid);
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

  it("accepts both roles", () => {
    expect(signupSchema.parse({ ...valid, role: "landlord" }).role).toBe("landlord");
    expect(roleSchema.parse("renter")).toBe("renter");
  });

  it.each([["admin"], [""], [undefined], ["Landlord"]])(
    "rejects role %j with a friendly message",
    (role) => {
      expect(fieldErrors(signupSchema, { ...valid, role }).role).toEqual([
        "Choose whether you're a landlord or a renter.",
      ]);
    },
  );

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

  it("reports every invalid field at once", () => {
    const errors = fieldErrors(signupSchema, { name: "J", email: "nope", password: "1", role: "x" });
    expect(Object.keys(errors).sort()).toEqual(["email", "name", "password", "role"]);
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
      landlordId: null,
    });
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
    form.set("role", "renter");
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
    expect(result.state.values).toEqual({ name: "J", email: "bad", role: "renter", city: "Austin" });
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
