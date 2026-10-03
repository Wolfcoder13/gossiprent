import { redirect } from "next/navigation";
import { hasKennitalaShape } from "@/lib/kennitala-pattern";

/*
 * Search boxes are GET forms, so whatever is typed into them ends up in the
 * URL, in server logs and in browser history. A kennitala must never go
 * there, nor be searched for or echoed back ("Results for …"). Pages send such
 * a query to /search?kt=1, which points to the kennitala lookup (a POST form),
 * and the search box (search-box.tsx) catches it before it's even sent.
 *
 * Pure apart from redirect(), so server pages and the client search box share it.
 */

/** Where a kennitala typed into a search box is sent: /search with a pointer to the lookup form. */
export const KENNITALA_LOOKUP_PATH = "/search?kt=1";

/** The id of the lookup form (kennitala-lookup.tsx), so the search box can hand a kennitala over to it. */
export const KENNITALA_LOOKUP_FORM_ID = "kennitala-lookup";

/**
 * True if a search query (a search param: string, array or missing) contains
 * something like a kennitala anywhere ("010130-2989", "kt. 0101302989",
 * "Jón 010130 – 2989"): the shared pattern in kennitala-pattern.ts, whether or
 * not the number would parse.
 */
export function queryHasKennitala(value: string | string[] | null | undefined): boolean {
  const values = Array.isArray(value) ? value : [value];
  return values.some((v) => typeof v === "string" && hasKennitalaShape(v));
}

/**
 * Call first thing in a page with a search box: a `q` containing a kennitala
 * is never searched or shown; the visitor goes to the lookup form instead.
 */
export function redirectKennitalaQuery(q: string | string[] | undefined): void {
  if (queryHasKennitala(q)) redirect(KENNITALA_LOOKUP_PATH);
}
