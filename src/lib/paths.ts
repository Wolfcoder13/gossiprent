import type { ReportTarget, ReviewKind, UserRole } from "@/db/schema";
import { hasRole, primaryRole, type HasRoles } from "./roles";

/** URL of a landlord, renter, or property page. */
export function subjectPath(kind: ReviewKind, id: string): string {
  if (kind === "property") return `/properties/${id}`;
  return `/${kind}s/${id}`;
}

/**
 * URL of a person's public profile: their landlord page or their renter page.
 * Uses `prefer` when they have that role, otherwise the role they do have.
 */
export function profilePath(user: { id: string } & HasRoles, prefer?: UserRole): string {
  const role = prefer && hasRole(user, prefer) ? prefer : primaryRole(user);
  return subjectPath(role, user.id);
}

/** "/landlords?q=austin&page=2#reviews" — empty params and page 1 are left out. */
export function pageHref(
  basePath: string,
  page: number,
  params: Record<string, string | undefined> = {},
  hash?: string,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  if (page > 1) search.set("page", String(page));
  const qs = search.toString();
  return `${basePath}${qs ? `?${qs}` : ""}${hash ? `#${hash}` : ""}`;
}

/** The report form for a review, profile or property, or (without an id) "someone has my account". */
export function reportPath(target: ReportTarget, id?: string): string {
  const search = new URLSearchParams({ target, ...(id ? { id } : {}) });
  return `/report?${search}`;
}
