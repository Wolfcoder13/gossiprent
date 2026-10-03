import { afterEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { MESSAGES } from "@/i18n/messages";
import { createT } from "@/i18n/translate";
import { idleFormState, LIMITS } from "@/lib/form-state";
import {
  formValues,
  freeText,
  isPersonName,
  kennitalaField,
  loginSchema,
  lookupSchema,
  optionalKennitalaField,
  parseForm,
  passwordChangeSchema,
  personName,
  personOrCompanyName,
  postalCodeField,
  profileSchema,
  propertySchema,
  reportSchema,
  reviewSchema,
  reviewWizardSchema,
  roleChangeSchema,
  safeRedirectPath,
  signupSchema,
  stripNul,
} from "@/lib/validation";

const en = createT(MESSAGES.en, "en");
const is = createT(MESSAGES.is, "is");

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

// Made-up kennitalas with a wrong check digit, so none can be a real person's.
const PERSON_KT = "1203851209"; // born 12 March 1985
const COMPANY_KT = "4510891209"; // registered 5 October 1989
const TEMPORARY_KT = "8123456793"; // a "kerfiskennitala" (no birth date)
const ROBOT_KT = "0101302989"; // a "Gervimaður" test number
const FUTURE_KT = "1512301230"; // 15 December 2030
const TOO_OLD_KT = "0101101239"; // 1 January 1910

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** parseForm in English; fails the test if the form unexpectedly fails. */
function parsed<T extends z.ZodType>(schema: T, fields: Record<string, string>): z.output<T> {
  const result = parseForm(schema, form(fields), en);
  if (!result.success) throw new Error(`Unexpected errors: ${JSON.stringify(result.state.fieldErrors)}`);
  return result.data;
}

/** The English field errors for a form that must fail. */
function errors(schema: z.ZodType, fields: Record<string, string>, t = en) {
  const result = parseForm(schema, form(fields), t);
  expect(result.success).toBe(false);
  if (result.success) throw new Error("unreachable");
  return result.state.fieldErrors ?? {};
}

describe("kennitalaField", () => {
  const schema = lookupSchema;
  const original = process.env.ALLOW_TEST_KENNITALA;
  afterEach(() => {
    if (original === undefined) delete process.env.ALLOW_TEST_KENNITALA;
    else process.env.ALLOW_TEST_KENNITALA = original;
  });

  it.each([
    ["with a hyphen", "120385-1209"],
    ["without one", "1203851209"],
    ["with a space", "120385 1209"],
    ["padded", "  120385-1209  "],
    ["with spaces and a dash", "120385 - 1209"],
    ["with an en dash", "120385–1209"],
    ["with an em dash (iOS turns -- into one)", "120385—1209"],
    ["with a prefix (aggressive cleanup)", "kt. 120385-1209"],
  ])("reads a kennitala typed %s as its 10 digits", (_label, input) => {
    expect(parsed(schema, { kennitala: input }).kennitala).toBe(PERSON_KT);
  });

  it("accepts companies and temporary numbers", () => {
    expect(parsed(schema, { kennitala: "451089-1209" }).kennitala).toBe(COMPANY_KT);
    expect(parsed(schema, { kennitala: "812345-6793" }).kennitala).toBe(TEMPORARY_KT);
  });

  it.each([
    ["an impossible date", "123456-7890"],
    ["too few digits", "120385-120"],
    ["too many digits", "120385-12099"],
    ["letters", "abcdef-ghij"],
    ["a birth date in the future", FUTURE_KT],
    ["a birth date more than 110 years ago", TOO_OLD_KT],
  ])("rejects %s", (_label, input) => {
    expect(errors(schema, { kennitala: input })).toEqual({
      kennitala: ["That isn't a valid kennitala. Enter 10 digits, e.g. 123456-7890."],
    });
  });

  it("asks for a kennitala when it's blank or missing", () => {
    const required = { kennitala: ["Enter a kennitala."] };
    expect(errors(schema, { kennitala: "   " })).toEqual(required);
    expect(errors(schema, {})).toEqual(required);
  });

  it("accepts the Gervimaður test numbers only while they're allowed", () => {
    process.env.ALLOW_TEST_KENNITALA = "true";
    expect(parsed(schema, { kennitala: "010130-2989" }).kennitala).toBe(ROBOT_KT);
    process.env.ALLOW_TEST_KENNITALA = "false";
    expect(errors(schema, { kennitala: "010130-2989" }).kennitala).toHaveLength(1);
  });

  it("never puts the kennitala in an error message", () => {
    const result = kennitalaField.safeParse(FUTURE_KT);
    expect(result.success).toBe(false);
    expect(result.error!.message).not.toContain(FUTURE_KT);
  });

  it("has an optional variant: blank or missing is null", () => {
    expect(optionalKennitalaField.parse("")).toBeNull();
    expect(optionalKennitalaField.parse("   ")).toBeNull();
    expect(optionalKennitalaField.parse(undefined)).toBeNull();
    expect(optionalKennitalaField.parse("120385-1209")).toBe(PERSON_KT);
    expect(optionalKennitalaField.safeParse("12345").success).toBe(false);
  });
});

describe("freeText", () => {
  const schema = freeText(50, "validation.bio.tooLong");

  it("trims and NFC-normalizes, keeping line breaks", () => {
    expect(schema.parse("  Jón\n\nsays hi  ")).toBe("Jón\n\nsays hi");
  });

  it("stores a browser's CRLF line breaks as \\n, and counts each as one character", () => {
    expect(schema.parse("Fyrsta lína\r\nÖnnur lína\r\n")).toBe("Fyrsta lína\nÖnnur lína");
    // 49 characters in the textarea (its maxLength counts a line break once), 50 as sent with CRLF.
    expect(schema.parse(`${"x".repeat(24)}\r\n${"y".repeat(24)}`)).toHaveLength(49);
    expect(schema.parse(`${"x".repeat(25)}\r\n${"y".repeat(24)}`)).toHaveLength(50);
  });

  it("never stores control characters (terminal escape sequences), but keeps tabs", () => {
    expect(schema.parse("Halló\u001b[2J\u001b[3J\u001b[H\theimur\u0007")).toBe("Halló[2J[3J[H\theimur");
    expect(schema.parse("a\u0000b\u0008c\u007fd\u009be")).toBe("abcde");
  });

  it.each([
    ["with a hyphen", "My kt is 120385-1209, call me"],
    ["with a space", "kt 120385 1209"],
    ["without a separator", "(1203851209)"],
    ["of a company", "Félagið 451089-1209 á húsið"],
    ["with a spaced hyphen", "Leigusalinn (kt. 120385 - 1209) var seinn"],
    ["with a hyphen after a space", "kt. 120385 -1209"],
    ["with two spaces", "kt. 120385  1209"],
    ["with an en dash", "kt. 120385–1209"],
    ["with a spaced en dash", "kt. 120385 – 1209"],
    ["across a CRLF line break", "kt. 120385-\r\n1209"],
    ["split by a control character", "kt. 120385\u001b1209"],
    ["split by a soft hyphen", "kt. 120385­1209"],
  ])("rejects text containing a kennitala %s", (_label, text) => {
    const result = schema.safeParse(text);
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.message)).toEqual(["validation.noKennitalaInText"]);
  });

  it.each([["Call 555 1234"], ["Njálsgata 23, 101 Reykjavík"], ["Reference 1234567890"], ["Rent was 250000 kr."]])(
    "allows numbers that aren't a kennitala: %j",
    (text) => {
      expect(schema.parse(text)).toBe(text);
    },
  );

  it("uses the given message for its limit, with the limit filled in", () => {
    expect(errors(profileSchema, { name: "Sigrún", bio: "x".repeat(LIMITS.bio.max + 1) }).bio).toEqual([
      "Bio must be 500 characters or fewer.",
    ]);
    expect(freeText(10).safeParse("x".repeat(11)).error!.issues[0].message).toBe("validation.tooLong");
  });
});

describe("names", () => {
  it.each([
    ["Þórdís Ósk Jónsdóttir"],
    ["Ásgeir Æ. Örnólfsson"],
    ["Anna-María O'Brien"],
    ["Anna-María O’Brien"],
    ["Agnieszka Nowak"],
    ["Zoë Żaneta"],
    ["Агния Барто"],
    ["Ng"],
  ])("accepts the person's name %j", (name) => {
    expect(personName.parse(name)).toBe(name);
    expect(isPersonName(name)).toBe(true);
  });

  it("normalizes: NFC, trimmed, single spaces", () => {
    expect(personName.parse("  Jón   Jónsson ")).toBe("Jón Jónsson");
  });

  it("requires 2–80 characters after normalizing", () => {
    expect(errors(profileSchema, { name: "  J  " }).name).toEqual(["Name must be at least 2 characters."]);
    expect(errors(profileSchema, { name: "x".repeat(81) }).name).toEqual(["Name must be 80 characters or fewer."]);
    expect(errors(profileSchema, { name: " " }).name).toEqual(["Name must be at least 2 characters."]);
    expect(personName.parse(`  ${"x".repeat(80)}  `)).toHaveLength(80);
  });

  it.each([["Jón 2"], ["jón@heima"], ["Jón & Gunna"], ["--"], ["Jón_Jónsson"], ["Jón (Nonni)"]])(
    "rejects %j for a person",
    (name) => {
      expect(errors(profileSchema, { name }).name).toEqual([
        "Use only letters, spaces, hyphens, apostrophes and periods in a name.",
      ]);
    },
  );

  it.each([["www.example.is"], ["Jón Jónsson.is"], ["Leiga.com"]])("rejects the web address %j", (name) => {
    expect(errors(profileSchema, { name }).name).toEqual(["A name can't contain a web address."]);
  });

  it("lets companies use digits and &, but not a kennitala", () => {
    for (const name of ["Dæmi leigufélag ehf.", "Hús & hýbýli 2 ehf.", "101 Leiga hf."]) {
      expect(personOrCompanyName.parse(name)).toBe(name);
    }
    expect(isPersonName("Hús & hýbýli 2 ehf.")).toBe(false);
    expect(isPersonName("Dæmi leigufélag ehf.")).toBe(true);
    expect(personOrCompanyName.safeParse("Félag 4510891209 ehf.").error!.issues.map((i) => i.message)).toEqual([
      "validation.noKennitalaInText",
    ]);
    expect(personOrCompanyName.safeParse("Leiga@hus").error!.issues.map((i) => i.message)).toEqual([
      "validation.name.companyChars",
    ]);
  });
});

describe("postalCodeField", () => {
  it("turns a postcode from the list into its number", () => {
    expect(postalCodeField.parse("101")).toBe(101);
    expect(postalCodeField.parse(" 600 ")).toBe(600);
  });

  it.each([["121", "a PO-box-only code"], ["999", "an unknown code"], ["10", "two digits"], ["1o1", "a typo"]])(
    "rejects %j (%s)",
    (code) => {
      expect(postalCodeField.safeParse(code).error!.issues.map((i) => i.message)).toEqual([
        "validation.postalCode.invalid",
      ]);
    },
  );

  it("asks for a postcode when none was chosen", () => {
    expect(postalCodeField.safeParse("").error!.issues.map((i) => i.message)).toEqual(["validation.postalCode.required"]);
    expect(postalCodeField.safeParse(undefined).error!.issues.map((i) => i.message)).toEqual([
      "validation.postalCode.required",
    ]);
  });
});

describe("signupSchema", () => {
  const valid = {
    kennitala: "120385-1209",
    name: "Sigrún Helgadóttir",
    email: "sigrun@example.com",
    password: "password123",
    isRenter: "on",
    city: "Reykjavík",
  };

  it("accepts a valid signup, turning the kennitala into digits and the checkboxes into booleans", () => {
    expect(parsed(signupSchema, valid)).toEqual({
      ...valid,
      kennitala: PERSON_KT,
      isRenter: true,
      isLandlord: false,
    });
  });

  it("normalizes the name and city, and trims + lowercases the email", () => {
    const data = parsed(signupSchema, {
      ...valid,
      name: "  Sigrún   Helgadóttir  ",
      email: "  Sigrun.H@Example.COM ",
      city: "  Reykjavík ",
    });
    expect(data.name).toBe("Sigrún Helgadóttir");
    expect(data.email).toBe("sigrun.h@example.com");
    expect(data.city).toBe("Reykjavík");
  });

  it("does not trim or alter the password", () => {
    expect(parsed(signupSchema, { ...valid, password: "  Pass Word 1  " }).password).toBe("  Pass Word 1  ");
  });

  it.each([["empty", ""], ["whitespace only", "   \t "]])("turns a %s city into null", (_label, city) => {
    expect(parsed(signupSchema, { ...valid, city }).city).toBeNull();
  });

  it.each([
    ["renter only", { isRenter: "on" }, { isRenter: true, isLandlord: false }],
    ["landlord only", { isLandlord: "on" }, { isRenter: false, isLandlord: true }],
    ["both", { isRenter: "on", isLandlord: "on" }, { isRenter: true, isLandlord: true }],
  ])("accepts %s", (_label, roles, expected) => {
    const rest: Partial<typeof valid> = { ...valid };
    delete rest.isRenter;
    expect(parsed(signupSchema, { ...rest, ...roles })).toMatchObject(expected);
  });

  it.each([
    ["no role at all", {}],
    ["empty values", { isRenter: "", isLandlord: "" }],
    ["unticked-looking values", { isRenter: "off", isLandlord: "false" }],
    ["a different casing", { isRenter: "ON", isLandlord: "True" }],
  ])("asks for at least one role when given %s", (_label, roles) => {
    const rest: Partial<typeof valid> = { ...valid };
    delete rest.isRenter;
    expect(errors(signupSchema, { ...rest, ...roles })).toEqual({
      roles: ["Choose at least one: renter, landlord, or both."],
    });
  });

  it("rejects a non-string checkbox value (a tampered request)", () => {
    expect(signupSchema.safeParse({ ...valid, isLandlord: ["on"] }).success).toBe(false);
  });

  it.each([["not-an-email"], ["sigrun@"], ["@example.com"], ["sigrun example.com"], [""]])(
    "rejects invalid email %j",
    (email) => {
      expect(errors(signupSchema, { ...valid, email }).email).toEqual(["Enter a valid email address."]);
    },
  );

  it("rejects overly long emails", () => {
    const email = `${"a".repeat(250)}@example.com`;
    expect(errors(signupSchema, { ...valid, email }).email).toEqual(["Email is too long."]);
  });

  it("requires a password of 8–128 characters", () => {
    expect(errors(signupSchema, { ...valid, password: "1234567" }).password).toEqual([
      "Password must be at least 8 characters.",
    ]);
    expect(errors(signupSchema, { ...valid, password: "x".repeat(129) }).password).toEqual([
      "Password must be 128 characters or fewer.",
    ]);
    expect(parsed(signupSchema, { ...valid, password: "x".repeat(128) }).password).toHaveLength(128);
  });

  it("rejects a city over 80 characters", () => {
    expect(errors(signupSchema, { ...valid, city: "x".repeat(81) }).city).toEqual([
      "City must be 80 characters or fewer.",
    ]);
  });

  it("reports every invalid field at once, including the kennitala and a missing role", () => {
    const fieldErrors = errors(signupSchema, { kennitala: "123", name: "J", email: "nope", password: "1" });
    expect(Object.keys(fieldErrors).sort()).toEqual(["email", "kennitala", "name", "password", "roles"]);
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
  ])("rejects %j with a generic message", (input) => {
    const fieldErrors = errors(roleChangeSchema, input);
    for (const messages of Object.values(fieldErrors)) expect(messages).toEqual(["Check this field."]);
  });
});

describe("loginSchema", () => {
  it("trims and lowercases the email", () => {
    expect(parsed(loginSchema, { email: " Asdis@Example.com ", password: "pw" })).toEqual({
      email: "asdis@example.com",
      password: "pw",
    });
  });

  it("requires a password but doesn't apply signup's length rules", () => {
    expect(errors(loginSchema, { email: "a@b.co", password: "" }).password).toEqual(["Enter your password."]);
    expect(parsed(loginSchema, { email: "a@b.co", password: "x" }).password).toBe("x");
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x".repeat(129) }).success).toBe(false);
  });
});

describe("profileSchema", () => {
  it("normalizes values and turns blank optional fields into null", () => {
    expect(parsed(profileSchema, { name: "  Kári  ", city: "  ", bio: "" })).toEqual({
      name: "Kári",
      city: null,
      bio: null,
    });
    expect(parsed(profileSchema, { name: "Kári" })).toEqual({ name: "Kári", city: null, bio: null });
  });

  it("keeps a trimmed bio, up to 500 characters, without a kennitala", () => {
    expect(parsed(profileSchema, { name: "Kári", bio: "  Hæ.  " }).bio).toBe("Hæ.");
    expect(parsed(profileSchema, { name: "Kári", bio: "x".repeat(500) }).bio).toHaveLength(500);
    expect(errors(profileSchema, { name: "Kári", bio: "Kt. mín er 120385-1209" }).bio).toEqual([
      "Don't include a kennitala here. ID numbers are never shown on GossipRent.",
    ]);
  });
});

describe("reviewSchema", () => {
  const valid = {
    kind: "landlord",
    subjectId: UUID,
    rating: "4",
    title: "Góður leigusali",
    body: "Lagaði allt fljótt og skilaði tryggingunni strax.",
  };

  it("coerces the rating and treats a blank kennitala as not given", () => {
    expect(parsed(reviewSchema, { ...valid, subjectKennitala: "" })).toEqual({
      ...valid,
      rating: 4,
      subjectKennitala: null,
    });
    expect(parsed(reviewSchema, { ...valid, subjectKennitala: "120385-1209" }).subjectKennitala).toBe(PERSON_KT);
  });

  it.each([["0"], ["6"], ["-1"], [""]])("rejects out-of-range rating %j", (rating) => {
    expect(errors(reviewSchema, { ...valid, rating }).rating).toEqual(["Pick a star rating from 1 to 5."]);
  });

  it("rejects fractional ratings and asks for one when none was picked", () => {
    expect(errors(reviewSchema, { ...valid, rating: "3.5" }).rating).toEqual(["Pick a star rating."]);
    const withoutRating: Partial<typeof valid> = { ...valid };
    delete withoutRating.rating;
    expect(errors(reviewSchema, withoutRating).rating).toEqual(["Pick a star rating from 1 to 5."]);
  });

  it("enforces the title and body lengths after trimming, quoting the limits", () => {
    expect(errors(reviewSchema, { ...valid, title: "  ab  " }).title).toEqual(["Title must be at least 3 characters."]);
    expect(errors(reviewSchema, { ...valid, body: `   ${"x".repeat(19)}   ` }).body).toEqual([
      "Your review must be at least 20 characters.",
    ]);
    expect(errors(reviewSchema, { ...valid, title: "x".repeat(121) }).title).toEqual([
      "Title must be 120 characters or fewer.",
    ]);
    expect(errors(reviewSchema, { ...valid, body: "x".repeat(5001) }).body).toEqual([
      "Your review must be 5,000 characters or fewer.",
    ]);
    expect(errors(reviewSchema, { ...valid, body: "x".repeat(5001) }, is).body).toEqual([
      "Umsögnin þín má mest vera 5.000 stafir.",
    ]);
  });

  it("rejects a kennitala in the title or body", () => {
    const fieldErrors = errors(reviewSchema, {
      ...valid,
      title: "Leigusali 120385-1209",
      body: "Kennitalan hans er 1203851209, ekki leigja af honum.",
    });
    expect(fieldErrors).toEqual({
      title: ["Don't include a kennitala here. ID numbers are never shown on GossipRent."],
      body: ["Don't include a kennitala here. ID numbers are never shown on GossipRent."],
    });
  });

  it.each(["120385 - 1209", "120385 -1209", "120385  1209", "120385–1209", "120385 – 1209"])(
    "rejects a body with a kennitala written %j",
    (kennitala) => {
      const body = `Leigusalinn (kt. ${kennitala}) skilaði tryggingunni seint og svaraði aldrei.`;
      expect(errors(reviewSchema, { ...valid, body }).body).toEqual([
        "Don't include a kennitala here. ID numbers are never shown on GossipRent.",
      ]);
    },
  );

  it("requires the subject id to be a UUID and the kind to be known", () => {
    expect(errors(reviewSchema, { ...valid, subjectId: "123" }).subjectId).toEqual(["That review target doesn't exist."]);
    expect(errors(reviewSchema, { ...valid, kind: "admin" }).kind).toEqual(["Check this field."]);
  });
});

describe("reviewWizardSchema", () => {
  const review = { rating: "5", title: "Frábær leigusali", body: "Svaraði alltaf strax og skilaði tryggingunni." };

  it("only needs the kind and kennitala to check", () => {
    expect(parsed(reviewWizardSchema, { intent: "check", kind: "renter", subjectKennitala: "120385 1209" })).toEqual({
      intent: "check",
      kind: "renter",
      subjectKennitala: PERSON_KT,
    });
  });

  it("needs the review to save; the name and confirmation are optional here", () => {
    expect(
      parsed(reviewWizardSchema, { intent: "save", kind: "landlord", subjectKennitala: PERSON_KT, ...review }),
    ).toEqual({
      intent: "save",
      kind: "landlord",
      subjectKennitala: PERSON_KT,
      subjectName: null,
      confirmNew: false,
      ...review,
      rating: 5,
    });
    expect(
      parsed(reviewWizardSchema, {
        intent: "save",
        kind: "landlord",
        subjectKennitala: COMPANY_KT,
        subjectName: " Dæmi  leigufélag ehf. ",
        confirmNew: "on",
        ...review,
      }),
    ).toMatchObject({ subjectName: "Dæmi leigufélag ehf.", confirmNew: true });
  });

  it("saves when no intent was sent", () => {
    expect(parsed(reviewWizardSchema, { kind: "landlord", subjectKennitala: PERSON_KT, ...review }).intent).toBe("save");
    expect(Object.keys(errors(reviewWizardSchema, { kind: "landlord", subjectKennitala: PERSON_KT })).sort()).toEqual([
      "body",
      "rating",
      "title",
    ]);
  });

  it("checks the kennitala, the kind and the subject's name", () => {
    expect(errors(reviewWizardSchema, { intent: "check", kind: "property", subjectKennitala: "123" })).toEqual({
      kind: ["Choose whether you're reviewing a landlord or a renter."],
      subjectKennitala: ["That isn't a valid kennitala. Enter 10 digits, e.g. 123456-7890."],
    });
    expect(
      errors(reviewWizardSchema, { intent: "save", kind: "renter", subjectKennitala: PERSON_KT, subjectName: "J", ...review })
        .subjectName,
    ).toEqual(["Name must be at least 2 characters."]);
    expect(Object.keys(errors(reviewWizardSchema, { intent: "nonsense" }))).toEqual(["intent"]);
  });
});

describe("propertySchema", () => {
  /** A property form that saves (not a "check"). */
  function saved(fields: Record<string, string>) {
    const data = parsed(propertySchema, fields);
    if (data.intent !== "save") throw new Error("expected intent save");
    return data;
  }

  const valid = {
    address: "Njálsgata 23",
    unit: "0201",
    postalCode: "101",
    description: "Tveggja herbergja íbúð á annarri hæð.",
  };

  it("accepts a property, without a landlord", () => {
    expect(parsed(propertySchema, valid)).toEqual({
      ...valid,
      intent: "save",
      postalCode: 101,
      relation: undefined,
      landlordKennitala: null,
      landlordName: null,
      confirmNewLandlord: false,
    });
  });

  it("normalizes the address and drops a leading “íbúð”, “apt” or “#” from the unit (normalizeUnit)", () => {
    for (const [unit, expected] of [
      ["íbúð 0201", "0201"],
      ["Íbúð 0201", "0201"],
      ["íbúð-0201", "0201"],
      ["íbúð:0201", "0201"],
      ["íb. 3", "3"],
      ["apt. 2B", "2B"],
      ["apt.B", "B"],
      ["Unit 5", "5"],
      ["unit: 5", "5"],
      ["#4", "4"],
      ["#B", "B"],
      ["  íbúð   0201 ", "0201"],
      ["2. hæð til vinstri", "2. hæð til vinstri"],
      ["Unitas", "Unitas"],
      ["íbúðin 2", "íbúðin 2"],
      ["íbúð", null],
      ["íbúð:", null],
      ["  ", null],
      ["\u001b", null],
    ] as const) {
      expect(saved({ ...valid, unit }).unit, unit).toBe(expected);
    }
    expect(saved({ ...valid, address: "  Njálsgata   23 " }).address).toBe("Njálsgata 23");
  });

  it("links a landlord by kennitala, with a name for a new one", () => {
    expect(
      parsed(propertySchema, {
        ...valid,
        relation: "rent",
        landlordKennitala: "451089-1209",
        landlordName: "Dæmi leigufélag ehf.",
        confirmNewLandlord: "on",
      }),
    ).toMatchObject({
      relation: "rent",
      landlordKennitala: COMPANY_KT,
      landlordName: "Dæmi leigufélag ehf.",
      confirmNewLandlord: true,
    });
  });

  it("requires an address and a postcode, and enforces the limits", () => {
    expect(errors(propertySchema, { address: " ", postalCode: "" })).toEqual({
      address: ["Enter the street address."],
      postalCode: ["Choose a postcode."],
    });
    const fieldErrors = errors(propertySchema, {
      address: "x".repeat(201),
      unit: "x".repeat(31),
      postalCode: "121",
      description: "x".repeat(301),
    });
    expect(fieldErrors).toEqual({
      address: ["Address must be 200 characters or fewer."],
      unit: ["Apartment must be 30 characters or fewer."],
      postalCode: ["Choose a postcode from the list."],
      description: ["Description must be 300 characters or fewer."],
    });
  });

  it.each([["Own"], ["manage"], [""], ["landlord"]])("rejects relation %j with a readable message", (relation) => {
    expect(errors(propertySchema, { ...valid, relation }).relation).toEqual([
      "Choose whether you own or rent this place.",
    ]);
  });

  it("only needs the landlord's kennitala to check it", () => {
    expect(parsed(propertySchema, { intent: "check", landlordKennitala: "120385-1209", address: "" })).toEqual({
      intent: "check",
      landlordKennitala: PERSON_KT,
    });
    expect(errors(propertySchema, { intent: "check", landlordKennitala: "" })).toEqual({
      landlordKennitala: ["Enter a kennitala."],
    });
  });
});

describe("reportSchema", () => {
  const valid = { target: "review", id: UUID, reason: "personal_data", details: "Umsögnin nefnir símanúmer." };

  it("accepts a report, with an optional contact email", () => {
    expect(parsed(reportSchema, valid)).toEqual({ ...valid, contactEmail: null });
    expect(parsed(reportSchema, { ...valid, contactEmail: " Me@Example.com " }).contactEmail).toBe("me@example.com");
  });

  it("needs an id except for an account, where it's always null", () => {
    expect(errors(reportSchema, { ...valid, id: "" }).id).toEqual(["That page can't be reported."]);
    expect(parsed(reportSchema, { ...valid, target: "account", id: "" }).id).toBeNull();
    expect(parsed(reportSchema, { ...valid, target: "account", id: UUID }).id).toBeNull();
  });

  it("checks the reason, the details and the email", () => {
    expect(errors(reportSchema, { ...valid, reason: "spite", details: " ", contactEmail: "nope" })).toEqual({
      reason: ["Choose a reason."],
      details: ["Describe the problem."],
      contactEmail: ["Enter a valid email address."],
    });
    expect(errors(reportSchema, { ...valid, details: "x".repeat(2001) }).details).toEqual([
      "Must be 2,000 characters or fewer.",
    ]);
    expect(errors(reportSchema, { ...valid, target: "user" }).target).toEqual(["That page can't be reported."]);
  });

  it("keeps the details' line breaks (as \\n) but no other control characters", () => {
    const details = "Fyrsta lína\r\n\u001b[2J\u001b]52;c;ZWNobw==\u0007Önnur\rlína\u001b[8m  ";
    expect(parsed(reportSchema, { ...valid, details }).details).toBe("Fyrsta lína\n[2J]52;c;ZWNobw==Önnur\nlína[8m");
    expect(errors(reportSchema, { ...valid, details: "\u001b\u0007 \r\n" }).details).toEqual(["Describe the problem."]);
  });

  it("lets the details name a kennitala (to say whose identity was claimed)", () => {
    expect(parsed(reportSchema, { ...valid, target: "account", id: "", details: `Mín kt. er ${PERSON_KT}` }).details).toBe(
      `Mín kt. er ${PERSON_KT}`,
    );
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
    expect(parsed(passwordChangeSchema, change(" old pw ", "  new password  "))).toEqual(
      change(" old pw ", "  new password  "),
    );
  });

  it("requires the current password and applies the sign-up rules to the new one", () => {
    expect(errors(passwordChangeSchema, change("", "long-enough")).currentPassword).toEqual([
      "Enter your current password.",
    ]);
    expect(errors(passwordChangeSchema, change("old", "short")).newPassword).toEqual([
      "Password must be at least 8 characters.",
    ]);
    expect(errors(passwordChangeSchema, change("old", "x".repeat(129))).newPassword).toEqual([
      "Password must be 128 characters or fewer.",
    ]);
  });

  it("requires the confirmation to match exactly", () => {
    expect(errors(passwordChangeSchema, change("old", "long-enough", "long-enough "))).toEqual({
      confirmPassword: ["The new passwords don't match."],
    });
  });

  it("reports every field at once", () => {
    expect(Object.keys(errors(passwordChangeSchema, change("", "", "different"))).sort()).toEqual([
      "confirmPassword",
      "currentPassword",
      "newPassword",
    ]);
  });

  it("never echoes any password back to the form", () => {
    const result = parseForm(passwordChangeSchema, form(change("my-old-secret", "my-new-secret", "my-new-secreT")), en);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.state.values).toEqual({});
    expect(JSON.stringify(result.state)).not.toMatch(/my-(old|new)-secre/);
  });
});

describe("parseForm", () => {
  it("returns the parsed data on success", () => {
    expect(parseForm(loginSchema, form({ email: " USER@Example.com ", password: "pw" }), en)).toEqual({
      success: true,
      data: { email: "user@example.com", password: "pw" },
    });
  });

  it("returns translated field errors, the banner and the submitted values (minus the password)", () => {
    const fields = { kennitala: "120385-1209", name: "J", email: "bad", password: "short", isRenter: "on" };
    const result = parseForm(signupSchema, form(fields), en);
    expect(result).toEqual({
      success: false,
      state: {
        status: "error",
        message: "Please fix the highlighted fields.",
        fieldErrors: {
          name: ["Name must be at least 2 characters."],
          email: ["Enter a valid email address."],
          password: ["Password must be at least 8 characters."],
        },
        values: { kennitala: "120385-1209", name: "J", email: "bad", isRenter: "on" },
      },
    });
  });

  it("speaks Icelandic with an Icelandic t", () => {
    const result = parseForm(signupSchema, form({ kennitala: "", name: "J", email: "", password: "x" }), is);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.state.message).toBe("Lagaðu merktu reitina.");
    expect(result.state.fieldErrors).toEqual({
      kennitala: ["Sláðu inn kennitölu."],
      name: ["Nafn þarf að vera minnst 2 stafir."],
      email: ["Sláðu inn gilt netfang."],
      password: ["Lykilorð þarf að vera minnst 8 stafir."],
      roles: ["Veldu að minnsta kosti eitt: leigjandi, leigusali eða hvort tveggja."],
    });
  });

  it("strips NUL characters before validating and echoing", () => {
    const fields = { kind: "landlord", subjectId: UUID, rating: "4", title: "a\u0000\u0000\u0000\u0000b", body: "x".repeat(25) };
    const failed = parseForm(reviewSchema, form(fields), en);
    expect(failed.success).toBe(false);
    if (failed.success) return;
    expect(failed.state.fieldErrors?.title).toEqual(["Title must be at least 3 characters."]);
    expect(failed.state.values?.title).toBe("ab");
    expect(parsed(reviewSchema, { ...fields, title: "Great\u0000 place" }).title).toBe("Great place");
  });

  it("exposes an idle initial state", () => {
    expect(idleFormState).toEqual({ status: "idle" });
  });
});

describe("formValues", () => {
  it("returns plain string fields, skipping passwords, files, and React's $ACTION fields", () => {
    const data = form({ email: "a@b.co", password: "secret123", newPassword: "x", name: "  Spaced  " });
    data.set("$ACTION_ID_abc", "");
    data.set("upload", new Blob(["data"]), "file.txt");
    data.set("title", "Nice\u0000 place");
    expect(formValues(data)).toEqual({ email: "a@b.co", name: "  Spaced  ", title: "Nice place" });
  });
});

describe("stripNul", () => {
  it("removes every NUL character and leaves other text alone", () => {
    expect(stripNul("\u0000a\u0000\u0000b\u0000")).toBe("ab");
    const text = "Line one\nLine two\tTabbed \u0001 Ünïcødé";
    expect(stripNul(text)).toBe(text);
  });
});

describe("safeRedirectPath", () => {
  it.each([
    ["/", "/"],
    ["/dashboard", "/dashboard"],
    ["/ok?x=1", "/ok?x=1"],
    ["/search?q=a%20b&sort=top#reviews", "/search?q=a%20b&sort=top#reviews"],
    ["/%2F%2Fevil.com", "/%2F%2Fevil.com"], // encoded slashes stay a same-origin path
    ["/./dashboard", "/dashboard"],
    ["/a/../dashboard", "/dashboard"],
    ["/landlords/café", "/landlords/caf%C3%A9"],
    ["/login?next=//evil.example", "/login?next=//evil.example"],
  ])("allows same-site path %j", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    ["protocol-relative", "//evil.com"],
    ["triple slash", "///evil.com"],
    ["backslash", "/\\evil.com"],
    ["tab", "/\t/evil.com"],
    ["newline", "/\n/evil.com"],
    ["null byte", "/\u0000/evil.com"],
    ["absolute URL", "https://x"],
    ["javascript URL", "javascript:alert(1)"],
    ["relative path", "dashboard"],
    ["empty string", ""],
    ["dot segment before a double slash", "/.//evil.example"],
    ["parent segment before a double slash", "/a/..//evil.example"],
    ["percent-encoded dot segment", "/%2e//evil.example"],
  ])("rejects %s", (_label, input) => {
    expect(safeRedirectPath(input)).toBe("/");
    expect(safeRedirectPath(input, "/dashboard")).toBe("/dashboard");
  });

  it.each([[undefined], [null], [42], [["/dashboard"]]])("rejects non-string value %j", (input) => {
    expect(safeRedirectPath(input)).toBe("/");
  });

  it("always returns a same-origin, ASCII-only value that can go in a Location header", () => {
    for (const input of ["/.//evil.example", "/landlords/café", "/😀?q=☃#ü", "/ /evil.example", "/ok"]) {
      const result = safeRedirectPath(input);
      expect(result, input).toMatch(/^\/(?!\/)[\x21-\x7e]*$/);
      expect(new URL(result, "https://gossiprent.example").origin, input).toBe("https://gossiprent.example");
      expect(safeRedirectPath(result), input).toBe(result);
    }
  });
});
