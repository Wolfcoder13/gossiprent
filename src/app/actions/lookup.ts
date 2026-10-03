"use server";

import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { clientIp, consumeAttempt, kennitalaCheckLimits } from "@/lib/auth/rate-limit";
import { profilePath } from "@/lib/paths";
import { findPersonByKennitala } from "@/lib/people";
import type { FormState } from "@/lib/form-state";
import { formValues, lookupSchema, parseForm, safeRedirectPath } from "@/lib/validation";

/**
 * "Look up a kennitala" (home page and /search; docs/iceland-spec.md §8).
 * A POST, so the number never lands in a URL. Logged-in visitors only, and
 * rate limited like every other kennitala check, because a lookup tells
 * whether someone with that number has been reviewed.
 *
 * Found → redirect to their profile. Not found → a message and a link to
 * write the first review. Nothing here logs the number or puts it in a
 * message; the only place it comes back is the visitor's own form field.
 */
export async function lookupKennitala(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  const t = await getT();
  if (!user) {
    // Back to the page the form was on (the home page or /search) after logging in.
    const next = safeRedirectPath(formData.get("next"), "/search");
    return {
      status: "error",
      message: t("lookup.logInRequired"),
      link: { href: `/login?next=${encodeURIComponent(next)}`, label: t("lookup.logIn") },
      values: formValues(formData),
    };
  }

  const parsed = parseForm(lookupSchema, formData, t);
  // A malformed number isn't a lookup, so it doesn't count against the limits.
  if (!parsed.success) return parsed.state;

  const attempt = await consumeAttempt(kennitalaCheckLimits(user.id, await clientIp()));
  if (attempt.limited) {
    return { status: "error", message: t("errors.tryLater"), values: formValues(formData) };
  }

  // Throws a sanitized error (without the number) if the query fails.
  const person = await findPersonByKennitala(parsed.data.kennitala);
  if (!person) {
    return {
      status: "success",
      message: t("lookup.notFound"),
      link: { href: "/reviews/new", label: t("lookup.writeFirst") },
      values: formValues(formData),
    };
  }
  redirect(profilePath(person));
}
