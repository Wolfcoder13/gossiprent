import { describe, expect, it } from "vitest";
// data.ts imports "server-only" (stubbed in vitest.config.ts) and the database
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
