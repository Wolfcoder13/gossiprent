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
