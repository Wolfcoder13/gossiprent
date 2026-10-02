import { describe, expect, it } from "vitest";
import { formatRating } from "@/components/stars";

describe("formatRating", () => {
  it.each([
    [null, "—"],
    [5, "5"],
    [1, "1"],
    [4.5, "4.5"],
    [3.33, "3.3"],
    [2.67, "2.7"],
    [4.75, "4.8"],
  ] as const)("formatRating(%s) = %s", (input, expected) => {
    expect(formatRating(input)).toBe(expected);
  });
});
