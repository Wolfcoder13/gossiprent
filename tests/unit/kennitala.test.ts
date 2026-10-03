import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allowTestKennitalas,
  containsKennitala,
  formatKennitala,
  isAdultKennitala,
  KENNITALA_SHAPED,
  parseKennitalaInput,
} from "@/lib/kennitala";

// A "Gervimaður" test number, a made-up (but well-formed) person, and a test company.
const ROBOT = "0101302989";
const PERSON = "1503853579";
const COMPANY = "4505352068";
const NOW = new Date("2026-10-03T12:00:00Z");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseKennitalaInput", () => {
  it("reads a person's kennitala, however it's typed", () => {
    for (const raw of ["150385-3579", "1503853579", " 150385 3579 ", "kt. 150385-3579", "150385–3579"]) {
      expect(parseKennitalaInput(raw, NOW), raw).toEqual({
        value: PERSON,
        type: "person",
        temporary: false,
        birthDate: new Date("1985-03-15T00:00:00Z"),
      });
    }
  });

  it("reads a company's, with its registration date", () => {
    expect(parseKennitalaInput("450535-2068", NOW)).toEqual({
      value: COMPANY,
      type: "company",
      temporary: false,
      birthDate: new Date("1835-05-05T00:00:00Z"),
    });
  });

  it("reads a temporary number (kerfiskennitala), which has no birth date", () => {
    expect(parseKennitalaInput("800101-2030", NOW)).toEqual({
      value: "8001012030",
      type: "person",
      temporary: true,
      birthDate: null,
    });
  });

  it.each([
    ["empty", ""],
    ["the documentation example", "123456-7890"],
    ["too short", "150385-357"],
    ["too long", "150385-35790"],
    ["letters", "15O385-3579"],
    ["the 31st of February", "310285-3579"],
    ["a 13th month", "011385-3579"],
    ["very long input", `${PERSON}${" ".repeat(40)}`],
  ])("rejects %s", (_label, raw) => {
    expect(parseKennitalaInput(raw, NOW)).toBeNull();
  });

  it("rejects a person born in the future or more than 110 years ago", () => {
    // 1 Jan 2027, and 1 Jan 1910.
    expect(parseKennitalaInput("0101272030", NOW)).toBeNull();
    expect(parseKennitalaInput("0101102939", NOW)).toBeNull();
    // 109 years old is still accepted (and companies can be older still, as above).
    expect(parseKennitalaInput("0101172039", NOW)?.birthDate).toEqual(new Date("1917-01-01T00:00:00Z"));
  });

  it("rejects a company registered in the future", () => {
    expect(parseKennitalaInput("4101272030", NOW)).toBeNull();
  });

  it("only accepts Gervimaður test numbers when test numbers are allowed", () => {
    expect(parseKennitalaInput(ROBOT, NOW)?.value).toBe(ROBOT);
    vi.stubEnv("ALLOW_TEST_KENNITALA", "false");
    expect(parseKennitalaInput(ROBOT, NOW)).toBeNull();
    // Real-looking numbers are unaffected.
    expect(parseKennitalaInput(PERSON, NOW)?.value).toBe(PERSON);
  });

  it("is null (doesn't throw) for something that isn't a string", () => {
    expect(parseKennitalaInput(undefined as unknown as string)).toBeNull();
    expect(parseKennitalaInput(1503853579 as unknown as string)).toBeNull();
  });
});

describe("allowTestKennitalas", () => {
  it.each([
    ["development", undefined, true],
    ["test", undefined, true],
    ["production", undefined, false],
    ["production", "true", true],
    ["production", "false", false],
    ["development", "false", false],
    ["production", "yes", false],
  ] as const)("NODE_ENV=%s, ALLOW_TEST_KENNITALA=%s → %s", (nodeEnv, flag, expected) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    if (flag === undefined) vi.stubEnv("ALLOW_TEST_KENNITALA", undefined);
    else vi.stubEnv("ALLOW_TEST_KENNITALA", flag);
    expect(allowTestKennitalas()).toBe(expected);
  });
});

describe("isAdultKennitala", () => {
  const parse = (raw: string) => parseKennitalaInput(raw, NOW)!;

  it("is true from the 18th birthday on", () => {
    // Born 3 Oct 2008 (18 today) and 4 Oct 2008 (18 tomorrow).
    expect(isAdultKennitala(parse("0310082030"), NOW)).toBe(true);
    expect(isAdultKennitala(parse("0410082030"), NOW)).toBe(false);
    expect(isAdultKennitala(parse("0410082030"), new Date("2026-10-04T00:00:00Z"))).toBe(true);
    expect(isAdultKennitala(parse(PERSON), NOW)).toBe(true);
  });

  it("is true for companies and temporary numbers (no age to check)", () => {
    expect(isAdultKennitala(parse("4101202030"), NOW)).toBe(true);
    expect(isAdultKennitala(parse("8001012030"), NOW)).toBe(true);
  });
});

describe("formatKennitala", () => {
  it("puts the dash before the last four digits", () => {
    expect(formatKennitala(PERSON)).toBe("150385-3579");
    expect(formatKennitala(COMPANY)).toBe("450535-2068");
  });
});

describe("KENNITALA_SHAPED", () => {
  it.each(["150385-3579", "1503853579", " 150385 3579 ", "150385 - 3579", "123456-7890"])("matches %j", (value) => {
    expect(KENNITALA_SHAPED.test(value)).toBe(true);
  });

  it.each(["", "15038-53579", "150385-35790", "Njálsgata 23", "kt 150385-3579", "555 1234"])(
    "doesn't match %j",
    (value) => {
      expect(KENNITALA_SHAPED.test(value)).toBe(false);
    },
  );
});

describe("containsKennitala", () => {
  it("finds a valid kennitala anywhere in free text", () => {
    expect(containsKennitala("Kennitalan hans er 150385-3579, ef það hjálpar.")).toBe(true);
    expect(containsKennitala("kt.1503853579")).toBe(true);
    expect(containsKennitala("150385 3579")).toBe(true);
    expect(containsKennitala(`Leigusali: Dæmi ehf. (${COMPANY})`)).toBe(true);
  });

  it("ignores numbers that aren't a kennitala", () => {
    expect(containsKennitala("Leigan var 250.000 kr. á mánuði og síminn 555-1234.")).toBe(false);
    expect(containsKennitala("Dæmi: 123456-7890")).toBe(false);
    // Part of a longer run of digits, e.g. an account number.
    expect(containsKennitala("0111-26-15038535790")).toBe(false);
    expect(containsKennitala("")).toBe(false);
  });
});
