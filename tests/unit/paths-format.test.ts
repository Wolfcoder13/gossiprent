import { describe, expect, it } from "vitest";
import { formatDate, formatMonthYear, plural } from "@/lib/format";
import { profilePath, subjectPath } from "@/lib/paths";

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("subjectPath", () => {
  it("links each kind of subject to its page", () => {
    expect(subjectPath("landlord", ID)).toBe(`/landlords/${ID}`);
    expect(subjectPath("renter", ID)).toBe(`/renters/${ID}`);
    expect(subjectPath("property", ID)).toBe(`/properties/${ID}`);
  });
});

describe("profilePath", () => {
  it("links a person to their public profile by role", () => {
    expect(profilePath({ id: ID, role: "landlord" })).toBe(`/landlords/${ID}`);
    expect(profilePath({ id: ID, role: "renter" })).toBe(`/renters/${ID}`);
  });
});

describe("format helpers", () => {
  it("formats dates in UTC", () => {
    expect(formatDate(new Date("2026-03-04T12:00:00Z"))).toBe("Mar 4, 2026");
    // Late on Dec 31 UTC is still Dec 31, whatever the machine's time zone.
    expect(formatDate(new Date("2025-12-31T23:30:00Z"))).toBe("Dec 31, 2025");
    expect(formatMonthYear(new Date("2026-03-04T12:00:00Z"))).toBe("March 2026");
  });

  it("pluralizes counts", () => {
    expect(plural(0, "review")).toBe("0 reviews");
    expect(plural(1, "review")).toBe("1 review");
    expect(plural(2, "review")).toBe("2 reviews");
    expect(plural(1, "property", "properties")).toBe("1 property");
    expect(plural(3, "property", "properties")).toBe("3 properties");
    expect(plural(12345, "match", "matches")).toBe("12,345 matches");
  });
});
