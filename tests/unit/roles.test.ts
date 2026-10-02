import { describe, expect, it } from "vitest";
import { hasRole, primaryRole, reviewerRole, rolesOf } from "@/lib/roles";

const LANDLORD = { isLandlord: true, isRenter: false };
const RENTER = { isLandlord: false, isRenter: true };
const BOTH = { isLandlord: true, isRenter: true };
const NEITHER = { isLandlord: false, isRenter: false };

describe("hasRole", () => {
  it.each([
    ["landlord only", LANDLORD, { landlord: true, renter: false }],
    ["renter only", RENTER, { landlord: false, renter: true }],
    ["both", BOTH, { landlord: true, renter: true }],
    ["neither", NEITHER, { landlord: false, renter: false }],
  ])("%s", (_label, user, expected) => {
    expect(hasRole(user, "landlord")).toBe(expected.landlord);
    expect(hasRole(user, "renter")).toBe(expected.renter);
  });
});

describe("rolesOf", () => {
  it("lists the person's roles, landlord first", () => {
    expect(rolesOf(LANDLORD)).toEqual(["landlord"]);
    expect(rolesOf(RENTER)).toEqual(["renter"]);
    expect(rolesOf(BOTH)).toEqual(["landlord", "renter"]);
    expect(rolesOf(NEITHER)).toEqual([]);
  });

  it("only reads the role flags", () => {
    expect(rolesOf({ ...RENTER, role: "landlord" } as typeof RENTER)).toEqual(["renter"]);
  });
});

describe("primaryRole", () => {
  it("is landlord for anyone who is a landlord, otherwise renter", () => {
    expect(primaryRole(LANDLORD)).toBe("landlord");
    expect(primaryRole(BOTH)).toBe("landlord");
    expect(primaryRole(RENTER)).toBe("renter");
  });
});

describe("reviewerRole", () => {
  it("renters review landlords and properties; landlords review renters", () => {
    expect(reviewerRole("landlord")).toBe("renter");
    expect(reviewerRole("property")).toBe("renter");
    expect(reviewerRole("renter")).toBe("landlord");
  });
});
