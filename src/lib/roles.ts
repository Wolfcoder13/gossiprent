import type { ReviewKind, UserRole } from "@/db/schema";

/** Anything that records which roles a person has. */
export type HasRoles = { isLandlord: boolean; isRenter: boolean };

export function hasRole(user: HasRoles, role: UserRole): boolean {
  return role === "landlord" ? user.isLandlord : user.isRenter;
}

/** The person's roles, landlord first. */
export function rolesOf(user: HasRoles): UserRole[] {
  return [...(user.isLandlord ? ["landlord" as const] : []), ...(user.isRenter ? ["renter" as const] : [])];
}

/** The role to link to by default (e.g. "View public profile"). */
export function primaryRole(user: HasRoles): UserRole {
  return user.isLandlord ? "landlord" : "renter";
}

/**
 * The role someone writes a review in: renters review landlords and
 * properties, landlords review renters.
 */
export function reviewerRole(kind: ReviewKind): UserRole {
  return kind === "renter" ? "landlord" : "renter";
}
