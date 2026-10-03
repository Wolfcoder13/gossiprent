import { describe, expect, it } from "vitest";
import { pageHref, profilePath, reportPath, subjectPath } from "@/lib/paths";

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

describe("pageHref", () => {
  it("leaves out page 1 and empty params", () => {
    expect(pageHref("/landlords", 1)).toBe("/landlords");
    expect(pageHref("/landlords", 1, { q: undefined, sort: "" })).toBe("/landlords");
  });

  it("adds the page number after the other params", () => {
    expect(pageHref("/landlords", 2)).toBe("/landlords?page=2");
    expect(pageHref("/landlords", 3, { q: "akureyri", sort: "name" })).toBe("/landlords?q=akureyri&sort=name&page=3");
    expect(pageHref("/renters", 1, { q: "selfoss", sort: undefined })).toBe("/renters?q=selfoss");
  });

  it("encodes the query", () => {
    expect(pageHref("/properties", 2, { q: "Njálsgata 23, 101" })).toBe("/properties?q=Nj%C3%A1lsgata+23%2C+101&page=2");
    expect(pageHref("/properties", 1, { q: "a&b=c#d" })).toBe("/properties?q=a%26b%3Dc%23d");
    expect(pageHref("/properties", 1, { q: "Kópavogur" })).toBe("/properties?q=K%C3%B3pavogur");
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

describe("reportPath", () => {
  it("links to the report form for a review, profile or property", () => {
    expect(reportPath("review", ID)).toBe(`/report?target=review&id=${ID}`);
    expect(reportPath("profile", ID)).toBe(`/report?target=profile&id=${ID}`);
    expect(reportPath("property", ID)).toBe(`/report?target=property&id=${ID}`);
  });

  it("has no id when someone reports their account was taken", () => {
    expect(reportPath("account")).toBe("/report?target=account");
  });
});
