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
  propertySearchTerms,
  REVIEWS_PAGE_SIZE,
  searchTerms,
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
    expect(likePattern("akureyri")).toBe("%akureyri%");
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
    expect(parseQuery("  akureyri  ")).toBe("akureyri");
    expect(parseQuery("   ")).toBe("");
  });

  it("returns an empty string when missing", () => {
    expect(parseQuery(undefined)).toBe("");
    expect(parseQuery([])).toBe("");
  });

  it("uses the first value of a repeated param", () => {
    expect(parseQuery([" sigrun ", "kari"])).toBe("sigrun");
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
    expect(parseQuery("akureyri\uD83D").isWellFormed()).toBe(true);
    expect(parseQuery("\uDE00 akureyri").isWellFormed()).toBe(true);
  });

  it("is empty when the query has no words (e.g. just punctuation)", () => {
    expect(parseQuery(",")).toBe("");
    expect(parseQuery(" , ,, ")).toBe("");
    expect(parseQuery("\t,\n")).toBe("");
    expect(parseQuery([",", "akureyri"])).toBe("");
    expect(parseQuery("\u0000,\u0000")).toBe("");
  });

  it("keeps a query that has words between the punctuation", () => {
    expect(parseQuery(", akureyri ,")).toBe(", akureyri ,");
    expect(parseQuery("%")).toBe("%");
    expect(parseQuery("_")).toBe("_");
  });

  it("is empty for anything shaped like a kennitala, which must never be searched or echoed", () => {
    for (const value of ["150385-3579", " 1503853579 ", "150385 3579", "123456-7890", ["0101302989", "x"]]) {
      expect(parseQuery(value), JSON.stringify(value)).toBe("");
    }
    // Other numbers are searched as usual.
    expect(parseQuery("Njálsgata 23")).toBe("Njálsgata 23");
    expect(parseQuery("101")).toBe("101");
    expect(parseQuery("Hamraborg 14 0503")).toBe("Hamraborg 14 0503");
  });

  it("is empty when any part of it is shaped like a kennitala, however it's spaced or dashed", () => {
    for (const value of [
      "Jón 150385-3579",
      "leigusali 1503853579 Akureyri",
      "150385 - 3579",
      "150385 -3579",
      "150385  3579",
      "150385–3579",
      "150385 – 3579",
      "Jón, 150385 – 3579",
    ]) {
      expect(parseQuery(value), JSON.stringify(value)).toBe("");
    }
  });

  it("checks for a kennitala before cutting the query to 100 characters", () => {
    expect(parseQuery(`${"x".repeat(95)} 150385-3579`)).toBe("");
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
    expect(parseQuery(" \u0000 akureyri \u0000 ")).toBe("akureyri");
    expect(parseQuery(["\u0000sigrun", "kari"])).toBe("sigrun");
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

describe("searchTerms", () => {
  it("is empty for a missing or blank query", () => {
    expect(searchTerms(undefined)).toEqual([]);
    expect(searchTerms("")).toEqual([]);
    expect(searchTerms("   ")).toEqual([]);
    expect(searchTerms(" , ,, ")).toEqual([]);
  });

  it("folds each word like the stored search columns (lower case, no accents)", () => {
    expect(searchTerms("Þórdís")).toEqual(["thordis"]);
    expect(searchTerms("Sigrún Helgadóttir")).toEqual(["sigrun", "helgadottir"]);
    expect(searchTerms("KÓPAVOGUR")).toEqual(["kopavogur"]);
    expect(searchTerms("Ægisíða")).toEqual(["aegisida"]);
  });

  it("splits on commas and any whitespace, so 'Njálsgata 23, Reykjavík' matches address and place", () => {
    expect(searchTerms("Njálsgata 23, Reykjavík")).toEqual(["njalsgata", "23", "reykjavik"]);
    expect(searchTerms("Njálsgata,101")).toEqual(["njalsgata", "101"]);
    expect(searchTerms("  Hamraborg\t14\n0503 ,, Kópavogur  ")).toEqual(["hamraborg", "14", "0503", "kopavogur"]);
  });

  it("keeps LIKE wildcards as typed (likePattern escapes them later)", () => {
    expect(searchTerms("100% a_b")).toEqual(["100%", "a_b"]);
    expect(searchTerms("100% a_b").map(likePattern)).toEqual(["%100\\%%", "%a\\_b%"]);
  });

  it("keeps at most 8 words", () => {
    const words = Array.from({ length: 12 }, (_, i) => `w${i}`);
    expect(searchTerms(words.join(" "))).toEqual(words.slice(0, 8));
  });

  it("drops repeated words, ignoring case and accents", () => {
    expect(searchTerms("gata Gata GÖTU götu")).toEqual(["gata", "gotu"]);
    expect(searchTerms("Þór thor ÞÓR")).toEqual(["thor"]);
  });

  it("drops repeats before applying the 8-word cap, so they can't push real words out", () => {
    const query = `${"a ".repeat(20)}b c d e f g h i j`;
    expect(searchTerms(query)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });
});

describe("propertySearchTerms", () => {
  it("matches an address copied from the site, with its apartment word", () => {
    for (const query of [
      "Njálsgata 23, íbúð 0201",
      "Njálsgata 23 apt. 0201",
      "njalsgata 23 ibud 0201",
      "Njálsgata 23 íb. 0201",
      "Njálsgata 23 #0201",
      "Njálsgata 23 # 0201",
      "NJÁLSGATA 23 ÍBÚÐ 0201",
    ]) {
      expect(propertySearchTerms(query), query).toEqual(["njalsgata", "23", "0201"]);
    }
  });

  it("strips the apartment word the way the property form stores the apartment", () => {
    expect(propertySearchTerms("Njálsgata 23 íbúð-0201")).toEqual(["njalsgata", "23", "0201"]);
    expect(propertySearchTerms("Njálsgata 23 íbúð:0201")).toEqual(["njalsgata", "23", "0201"]);
    expect(propertySearchTerms("Hringbraut 79 apt.B")).toEqual(["hringbraut", "79", "b"]);
    expect(propertySearchTerms("Hringbraut 79 unit: 5")).toEqual(["hringbraut", "79", "5"]);
    expect(propertySearchTerms("#B")).toEqual(["b"]);
  });

  it("keeps words that only start like an apartment word", () => {
    expect(propertySearchTerms("Unitas 3")).toEqual(["unitas", "3"]);
    expect(propertySearchTerms("Íbúðargata 4")).toEqual(["ibudargata", "4"]);
    expect(propertySearchTerms("Aptos 3")).toEqual(["aptos", "3"]);
  });

  it("is empty for a query that is only apartment words", () => {
    expect(propertySearchTerms("íbúð")).toEqual([]);
    expect(propertySearchTerms("apt. #")).toEqual([]);
    expect(propertySearchTerms(undefined)).toEqual([]);
  });
});

describe("parseQuery and searchTerms together", () => {
  it("a non-empty query always has at least one search word", () => {
    for (const input of [",", " , ", "x", ", x", "%", "😀", "\u0000,", "a".repeat(300), `${",".repeat(99)}a`]) {
      const query = parseQuery(input);
      if (query) expect(searchTerms(query).length, JSON.stringify(input)).toBeGreaterThan(0);
    }
  });
});
