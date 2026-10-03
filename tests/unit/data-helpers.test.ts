import { describe, expect, it } from "vitest";
// data.ts imports "server-only" (stubbed in vitest.config.mts) and the database
// module. Importing it must not open a database connection.
import {
  isUuid,
  likePattern,
  PAGE_SIZE,
  parsePage,
  parseQuery,
  parseSort,
  propertyLabel,
  REVIEWS_PAGE_SIZE,
  searchPatterns,
} from "@/lib/data";

describe("isUuid", () => {
  it.each([
    ["3f2504e0-4f89-41d3-9a0c-0305e82c3301"],
    ["3F2504E0-4F89-41D3-9A0C-0305E82C3301"],
    ["00000000-0000-0000-0000-000000000000"],
  ])("accepts %s", (value) => {
    expect(isUuid(value)).toBe(true);
  });

  it.each([
    [""],
    ["not-a-uuid"],
    ["123"],
    ["3f2504e0-4f89-41d3-9a0c-0305e82c330"], // too short
    ["3f2504e0-4f89-41d3-9a0c-0305e82c33011"], // too long
    ["3f2504e04f8941d39a0c0305e82c3301"], // no dashes
    ["{3f2504e0-4f89-41d3-9a0c-0305e82c3301}"],
    [" 3f2504e0-4f89-41d3-9a0c-0305e82c3301"],
    ["3f2504e0-4f89-41d3-9a0c-0305e82c3301\n"],
    ["zf2504e0-4f89-41d3-9a0c-0305e82c3301"],
    ["3f2504e0-4f89-41d3-9a0c-0305e82c3301' OR '1'='1"],
  ])("rejects %j", (value) => {
    expect(isUuid(value)).toBe(false);
  });
});

describe("likePattern", () => {
  it("wraps the query in % wildcards", () => {
    expect(likePattern("austin")).toBe("%austin%");
    expect(likePattern("")).toBe("%%");
  });

  it("escapes LIKE wildcards and backslashes so they match literally", () => {
    expect(likePattern("100%")).toBe("%100\\%%");
    expect(likePattern("a_b")).toBe("%a\\_b%");
    expect(likePattern("c:\\dir")).toBe("%c:\\\\dir%");
    expect(likePattern("%_\\")).toBe("%\\%\\_\\\\%");
  });

  it("leaves other characters alone", () => {
    expect(likePattern("O'Brien & Sons (TX)")).toBe("%O'Brien & Sons (TX)%");
    expect(likePattern("Ünïcødé 東京")).toBe("%Ünïcødé 東京%");
  });
});

describe("parsePage", () => {
  it.each([
    [undefined, 1],
    ["", 1],
    ["1", 1],
    ["2", 2],
    ["37", 37],
    ["0", 1],
    ["-3", 1],
    ["1.5", 1],
    ["abc", 1],
    ["2abc", 1],
    ["Infinity", 1],
    ["NaN", 1],
    ["10000", 10_000],
    ["10001", 10_000],
    ["99999999999999999999", 10_000],
  ] as const)("parsePage(%j) = %d", (input, expected) => {
    expect(parsePage(input)).toBe(expected);
  });

  it("uses the first value of a repeated param", () => {
    expect(parsePage(["3", "5"])).toBe(3);
    expect(parsePage(["x", "5"])).toBe(1);
    expect(parsePage([])).toBe(1);
  });
});

describe("parseSort", () => {
  it.each([
    ["top", "top"],
    ["most", "most"],
    ["newest", "newest"],
    ["name", "name"],
    [undefined, "top"],
    ["", "top"],
    ["MOST", "top"],
    ["drop table", "top"],
  ] as const)("parseSort(%j) = %s", (input, expected) => {
    expect(parseSort(input)).toBe(expected);
  });

  it("uses the first value of a repeated param", () => {
    expect(parseSort(["name", "most"])).toBe("name");
    expect(parseSort(["bogus", "most"])).toBe("top");
  });
});

describe("parseQuery", () => {
  it("trims the query", () => {
    expect(parseQuery("  austin  ")).toBe("austin");
    expect(parseQuery("   ")).toBe("");
  });

  it("returns an empty string when missing", () => {
    expect(parseQuery(undefined)).toBe("");
    expect(parseQuery([])).toBe("");
  });

  it("uses the first value of a repeated param", () => {
    expect(parseQuery([" maria ", "sam"])).toBe("maria");
  });

  it("limits the query to 100 characters", () => {
    expect(parseQuery("x".repeat(250))).toHaveLength(100);
    expect(parseQuery(`  ${"y".repeat(100)}z`)).toBe("y".repeat(100));
  });

  it("never returns half an emoji when the limit cuts through one", () => {
    // "😀" is two UTF-16 code units; the 100-character cut lands between them.
    const query = parseQuery(`${"x".repeat(99)}😀 more`);
    expect(query.isWellFormed()).toBe(true);
    expect(query.startsWith("x".repeat(99))).toBe(true);
    expect(query).not.toMatch(/[\uD800-\uDFFF]/u);
    // A whole emoji within the limit is kept as is.
    expect(parseQuery(`${"x".repeat(98)}😀 more`)).toBe(`${"x".repeat(98)}😀`);
    expect(parseQuery("café 😀 Ünïcode")).toBe("café 😀 Ünïcode");
  });

  it("repairs lone surrogates sent in the URL", () => {
    expect(parseQuery("austin\uD83D").isWellFormed()).toBe(true);
    expect(parseQuery("\uDE00 austin").isWellFormed()).toBe(true);
  });

  it("is empty when the query has no words (e.g. just punctuation)", () => {
    expect(parseQuery(",")).toBe("");
    expect(parseQuery(" , ,, ")).toBe("");
    expect(parseQuery("\t,\n")).toBe("");
    expect(parseQuery([",", "austin"])).toBe("");
    expect(parseQuery("\u0000,\u0000")).toBe("");
  });

  it("keeps a query that has words between the punctuation", () => {
    expect(parseQuery(", austin ,")).toBe(", austin ,");
    expect(parseQuery("%")).toBe("%");
    expect(parseQuery("_")).toBe("_");
  });
});

describe("propertyLabel", () => {
  it("includes the unit when there is one", () => {
    expect(propertyLabel({ address: "1408 E 6th St", unit: "2B" })).toBe("1408 E 6th St, Unit 2B");
  });

  it("is just the address without a unit", () => {
    expect(propertyLabel({ address: "2210 Riverside Dr", unit: null })).toBe("2210 Riverside Dr");
    expect(propertyLabel({ address: "2210 Riverside Dr", unit: "" })).toBe("2210 Riverside Dr");
  });
});

describe("page sizes", () => {
  it("are positive integers", () => {
    expect(Number.isInteger(PAGE_SIZE) && PAGE_SIZE > 0).toBe(true);
    expect(Number.isInteger(REVIEWS_PAGE_SIZE) && REVIEWS_PAGE_SIZE > 0).toBe(true);
  });
});

describe("parseQuery and NUL characters", () => {
  it("drops NUL characters (Postgres can't compare text containing them)", () => {
    expect(parseQuery("\u0000")).toBe("");
    expect(parseQuery("a\u0000b")).toBe("ab");
    expect(parseQuery(" \u0000 austin \u0000 ")).toBe("austin");
    expect(parseQuery(["\u0000maria", "sam"])).toBe("maria");
  });

  it("removes NULs before applying the length limit", () => {
    expect(parseQuery("\u0000".repeat(50) + "z".repeat(100))).toBe("z".repeat(100));
  });

  it("never returns a NUL, whatever the input", () => {
    for (const input of ["\u0000\u0000", "x\u0000".repeat(80), "  \u0000  ", "%00"]) {
      expect(parseQuery(input)).not.toContain("\u0000");
    }
  });
});

describe("searchPatterns", () => {
  it("is empty for a missing or blank query", () => {
    expect(searchPatterns(undefined)).toEqual([]);
    expect(searchPatterns("")).toEqual([]);
    expect(searchPatterns("   ")).toEqual([]);
    expect(searchPatterns(" , ,, ")).toEqual([]);
  });

  it("makes one pattern per word, keeping the casing as typed (ILIKE ignores case)", () => {
    expect(searchPatterns("austin")).toEqual(["%austin%"]);
    expect(searchPatterns("Maria Gonzalez")).toEqual(["%Maria%", "%Gonzalez%"]);
  });

  it("doesn't lower-case in JavaScript, which differs from Postgres for some letters", () => {
    // JS would turn the final Σ into ς and İ into i + a combining dot.
    expect(searchPatterns("ΟΔΟΣ İstiklal")).toEqual(["%ΟΔΟΣ%", "%İstiklal%"]);
  });

  it("splits on commas and any whitespace, so 'Austin, TX' matches city and region", () => {
    expect(searchPatterns("Austin, TX")).toEqual(["%Austin%", "%TX%"]);
    expect(searchPatterns("Austin,TX")).toEqual(["%Austin%", "%TX%"]);
    expect(searchPatterns("  4521\tN\nClark ,, Chicago  ")).toEqual(["%4521%", "%N%", "%Clark%", "%Chicago%"]);
  });

  it("handles a full property label, unit included", () => {
    expect(searchPatterns("1408 E 6th St, Unit 2B")).toEqual(["%1408%", "%E%", "%6th%", "%St%", "%Unit%", "%2B%"]);
  });

  it("escapes LIKE wildcards in each word", () => {
    expect(searchPatterns("100% a_b c\\d")).toEqual(["%100\\%%", "%a\\_b%", "%c\\\\d%"]);
    expect(searchPatterns("% _")).toEqual(["%\\%%", "%\\_%"]);
  });

  it("keeps at most 8 words", () => {
    const words = Array.from({ length: 12 }, (_, i) => `w${i}`);
    expect(searchPatterns(words.join(" "))).toEqual(words.slice(0, 8).map((w) => `%${w}%`));
  });

  it("drops repeated words, ignoring case (the first spelling wins)", () => {
    expect(searchPatterns("st St ST")).toEqual(["%st%"]);
    expect(searchPatterns("Main St, main st")).toEqual(["%Main%", "%St%"]);
  });

  it("drops repeats before applying the 8-word cap, so they can't push real words out", () => {
    const query = `${"a ".repeat(20)}b c d e f g h i j`;
    expect(searchPatterns(query)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"].map((w) => `%${w}%`));
  });
});

describe("parseQuery and searchPatterns together", () => {
  it("a non-empty query always has at least one search word", () => {
    for (const input of [",", " , ", "x", ", x", "%", "😀", "\u0000,", "a".repeat(300), `${",".repeat(99)}a`]) {
      const query = parseQuery(input);
      if (query) expect(searchPatterns(query).length, JSON.stringify(input)).toBeGreaterThan(0);
    }
  });
});
