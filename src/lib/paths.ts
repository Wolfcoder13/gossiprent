import type { ReviewKind, UserRole } from "@/db/schema";

/** URL of a landlord, renter, or property page. */
export function subjectPath(kind: ReviewKind, id: string): string {
  if (kind === "property") return `/properties/${id}`;
  return `/${kind}s/${id}`;
}

/** URL of a person's public profile. */
export function profilePath(user: { id: string; role: UserRole }): string {
  return subjectPath(user.role, user.id);
}
