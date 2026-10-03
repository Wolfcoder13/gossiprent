import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allowTestKennitalas,
  containsKennitala,
  formatKennitala,
  isAdultKennitala,
  parseKennitalaInput,
} from "@/lib/kennitala";
import { KennitalaLookup } from "@/components/kennitala-lookup";
import { I18nProvider } from "@/i18n/client";
import type { Locale } from "@/i18n/config";
import { MESSAGES } from "@/i18n/messages";
import { hasKennitalaShape, isKennitalaShaped } from "@/lib/kennitala-pattern";

// The lookup form (a client component) renders without Next or a database.
vi.mock("next/navigation", () => ({ usePathname: () => "/search", redirect: vi.fn() }));
vi.mock("@/app/actions/lookup", () => ({ lookupKennitala: vi.fn() }));

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
    for (const raw of [
      "150385-3579",
      "1503853579",
      " 150385 3579 ",
      "kt. 150385-3579",
      "150385–3579",
      "150385 – 3579",
      "150385—3579",
      "150385\u20113579",
      "150385 \u2212 3579",
      "１５０３８５－３５７９",
    ]) {
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

// Every way of spacing and dashing a kennitala: what the parser accepts
// ("aggressive" cleaning drops any spaces, hyphens and en dashes) and more.
const SPELLINGS = [
  "150385-3579",
  "1503853579",
  "150385 3579",
  "150385 - 3579",
  "150385 -3579",
  "150385- 3579",
  "150385  3579",
  "150385–3579",
  "150385 – 3579",
  "150385—3579",
  "150385\u20113579", // non-breaking hyphen
  "150385\u22123579", // minus sign
  "150385\u00a03579", // no-break space
  "150385--3579",
  "150385 - - 3579",
];

describe("isKennitalaShaped (the whole text)", () => {
  it.each([...SPELLINGS, " 150385 3579 ", "123456-7890"])("matches %j", (value) => {
    expect(isKennitalaShaped(value)).toBe(true);
  });

  it.each(["", "15038-53579", "150385-35790", "150385.3579", "Njálsgata 23", "kt 150385-3579", "555 1234"])(
    "doesn't match %j",
    (value) => {
      expect(isKennitalaShaped(value)).toBe(false);
    },
  );
});

describe("hasKennitalaShape (anywhere in the text)", () => {
  it.each([...SPELLINGS, "kt. 150385-3579", "Jón 150385 – 3579 Reykjavík", "123456-7890", "12345678901"])(
    "matches %j",
    (value) => {
      expect(hasKennitalaShape(value)).toBe(true);
    },
  );

  it.each(["", "Njálsgata 23", "555 1234", "15038-53579", "150385 35 79", "2026-10-03"])("doesn't match %j", (value) => {
    expect(hasKennitalaShape(value)).toBe(false);
  });

  it("sees through characters that don't show on screen and fullwidth digits", () => {
    expect(hasKennitalaShape("150385\u00ad3579")).toBe(true); // soft hyphen
    expect(hasKennitalaShape("15\u200b0385-3579")).toBe(true); // zero-width space
    expect(hasKennitalaShape("150385-35\ufe0f79")).toBe(true); // variation selector
    expect(hasKennitalaShape("１５０３８５－３５７９")).toBe(true);
    expect(hasKennitalaShape("150385\u001b3579")).toBe(true); // a control character
    // Line breaks and other whitespace separate, they don't vanish.
    expect(hasKennitalaShape("12345\n67890")).toBe(false);
  });

  it("stays fast on long runs of spaces", () => {
    const start = performance.now();
    expect(hasKennitalaShape(`150385${" ".repeat(50_000)}x`)).toBe(false);
    expect(containsKennitala(`150385${" ".repeat(50_000)}-${" ".repeat(50_000)}x`)).toBe(false);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe("containsKennitala", () => {
  it("finds a valid kennitala anywhere in free text", () => {
    expect(containsKennitala("Kennitalan hans er 150385-3579, ef það hjálpar.")).toBe(true);
    expect(containsKennitala("kt.1503853579")).toBe(true);
    expect(containsKennitala("150385 3579")).toBe(true);
    expect(containsKennitala(`Leigusali: Dæmi ehf. (${COMPANY})`)).toBe(true);
  });

  it.each(SPELLINGS)("finds %j however it's spaced or dashed", (spelling) => {
    expect(containsKennitala(spelling)).toBe(true);
    expect(containsKennitala(`Leigusalinn (kt. ${spelling}) skilaði tryggingunni seint.`)).toBe(true);
  });

  it("finds one hidden with characters that don't show on screen, or in fullwidth digits", () => {
    expect(containsKennitala("kt. 150385\u00ad3579")).toBe(true);
    expect(containsKennitala("kt. 1503\u200d85-3579")).toBe(true);
    expect(containsKennitala("kt. 150385\u2060 3579")).toBe(true);
    expect(containsKennitala("kt. １５０３８５－３５７９")).toBe(true);
  });

  it("finds one written across a line break", () => {
    expect(containsKennitala("kt. 150385-\n3579")).toBe(true);
  });

  it("ignores numbers that aren't a kennitala", () => {
    expect(containsKennitala("Leigan var 250.000 kr. á mánuði og síminn 555-1234.")).toBe(false);
    expect(containsKennitala("Dæmi: 123456-7890")).toBe(false);
    expect(containsKennitala("Dæmi: 123456 – 7890")).toBe(false);
    // Part of a longer run of digits, e.g. an account number.
    expect(containsKennitala("0111-26-15038535790")).toBe(false);
    expect(containsKennitala("2. hæð, 150385")).toBe(false);
    expect(containsKennitala("")).toBe(false);
  });
});

describe("KennitalaLookup", () => {
  function render(locale: Locale, node: ReactNode): string {
    const props = { locale, messages: MESSAGES[locale] } as ComponentProps<typeof I18nProvider>;
    return renderToStaticMarkup(createElement(I18nProvider, props, node));
  }

  /** The kennitala input's opening tag. */
  const field = (html: string) => /<input[^>]*name="kennitala"[^>]*>/.exec(html)![0];

  it("can put the cursor in the field from the server's HTML (/search?kt=1, also without JavaScript)", () => {
    const html = field(render("en", createElement(KennitalaLookup, { loggedIn: true, autoFocus: true })));
    expect(html).toContain('autofocus=""');
  });

  it("doesn't take the focus otherwise", () => {
    expect(field(render("is", createElement(KennitalaLookup, { loggedIn: false })))).not.toContain("autofocus");
  });

  it("is described by the text that says why the visitor is there, then the format hint", () => {
    const html = field(
      render("en", createElement(KennitalaLookup, { loggedIn: true, autoFocus: true, describedBy: "pointer" })),
    );
    expect(html).toMatch(/aria-describedby="pointer kennitala-[^" ]+-hint"/);
    expect(field(render("en", createElement(KennitalaLookup, { loggedIn: true })))).toMatch(
      /aria-describedby="kennitala-[^" ]+-hint"/,
    );
  });
});
