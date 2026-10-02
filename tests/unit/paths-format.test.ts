import { describe, expect, it } from "vitest";
import { formatDate, formatMonthYear, plural } from "@/lib/format";
import { pageHref, profilePath, subjectPath } from "@/lib/paths";

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("subjectPath", () => {
  it("links each kind of subject to its page", () => {
    expect(subjectPath("landlord", ID)).toBe(`/landlords/${ID}`);
    expect(subjectPath("renter", ID)).toBe(`/renters/${ID}`);
    expect(subjectPath("property", ID)).toBe(`/properties/${ID}`);
  });
});

describe("profilePath", () => {
  const landlord = { id: ID, isLandlord: true, isRenter: false };
  const renter = { id: ID, isLandlord: false, isRenter: true };
  const both = { id: ID, isLandlord: true, isRenter: true };

  it("links a person with one role to that role's page", () => {
    expect(profilePath(landlord)).toBe(`/landlords/${ID}`);
    expect(profilePath(renter)).toBe(`/renters/${ID}`);
  });

  it("links someone with both roles to their landlord page by default", () => {
    expect(profilePath(both)).toBe(`/landlords/${ID}`);
  });

  it("uses the preferred role when the person has it", () => {
    expect(profilePath(both, "renter")).toBe(`/renters/${ID}`);
    expect(profilePath(both, "landlord")).toBe(`/landlords/${ID}`);
    expect(profilePath(landlord, "landlord")).toBe(`/landlords/${ID}`);
    expect(profilePath(renter, "renter")).toBe(`/renters/${ID}`);
  });

  it("falls back to the role they do have when they don't have the preferred one", () => {
    expect(profilePath(landlord, "renter")).toBe(`/landlords/${ID}`);
    expect(profilePath(renter, "landlord")).toBe(`/renters/${ID}`);
  });

  it("ignores extra fields (e.g. a review author's `role`)", () => {
    const author = { id: ID, name: "Sam", role: "renter" as const, isLandlord: true, isRenter: true };
    expect(profilePath(author, author.role)).toBe(`/renters/${ID}`);
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

describe("pageHref", () => {
  it("leaves out page 1 and empty params", () => {
    expect(pageHref("/landlords", 1)).toBe("/landlords");
    expect(pageHref("/landlords", 1, { q: undefined, sort: "" })).toBe("/landlords");
  });

  it("adds the page number after the other params", () => {
    expect(pageHref("/landlords", 2)).toBe("/landlords?page=2");
    expect(pageHref("/landlords", 3, { q: "austin", sort: "name" })).toBe("/landlords?q=austin&sort=name&page=3");
    expect(pageHref("/renters", 1, { q: "chicago", sort: undefined })).toBe("/renters?q=chicago");
  });

  it("encodes the query", () => {
    expect(pageHref("/properties", 2, { q: "Austin, TX" })).toBe("/properties?q=Austin%2C+TX&page=2");
    expect(pageHref("/properties", 1, { q: "a&b=c#d" })).toBe("/properties?q=a%26b%3Dc%23d");
    expect(pageHref("/properties", 1, { q: "café" })).toBe("/properties?q=caf%C3%A9");
  });

  it("appends the hash last", () => {
    expect(pageHref(`/landlords/${ID}`, 2, {}, "reviews")).toBe(`/landlords/${ID}?page=2#reviews`);
    expect(pageHref(`/landlords/${ID}`, 1, {}, "reviews")).toBe(`/landlords/${ID}#reviews`);
    expect(pageHref("/properties", 4, { sort: "most" }, "reviews")).toBe("/properties?sort=most&page=4#reviews");
  });

  it("ignores page numbers below 2", () => {
    expect(pageHref("/landlords", 0)).toBe("/landlords");
    expect(pageHref("/landlords", -5)).toBe("/landlords");
  });

  it("round-trips through URLSearchParams", () => {
    const href = pageHref("/renters", 7, { q: "  spaced  out ", sort: "newest" });
    const url = new URL(href, "https://gossiprent.example");
    expect(url.pathname).toBe("/renters");
    expect(url.searchParams.get("q")).toBe("  spaced  out ");
    expect(url.searchParams.get("sort")).toBe("newest");
    expect(url.searchParams.get("page")).toBe("7");
  });
});
