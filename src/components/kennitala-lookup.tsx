"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState, useId, useRef } from "react";
import { lookupKennitala } from "@/app/actions/lookup";
import { useT } from "@/i18n/client";
import { idleFormState } from "@/lib/form-state";
import { FormMessage, KennitalaField, SubmitButton, useFocusAfterSubmit } from "./form";
import { KENNITALA_LOOKUP_FORM_ID } from "./kennitala-query";

/**
 * "Look up a kennitala": a POST form (the number never goes in a URL) under
 * the search box on the home page and /search. A match goes straight to the
 * person's profile; otherwise it says nobody with that number has been
 * reviewed and offers to write the first review. Shown to everyone; the
 * action asks visitors who aren't logged in to log in. Only one per page
 * (the search box finds it by id).
 */
export function KennitalaLookup({ loggedIn }: { loggedIn: boolean }) {
  const t = useT();
  const pathname = usePathname();
  const [state, formAction] = useActionState(lookupKennitala, idleFormState);
  const formRef = useRef<HTMLFormElement>(null);
  const headingId = useId();
  useFocusAfterSubmit(formRef, state);
  const loginHref = `/login?next=${encodeURIComponent(pathname)}`;

  return (
    <section aria-labelledby={headingId} className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 id={headingId} className="text-lg font-semibold text-ink">
        {t("lookup.heading")}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("lookup.intro")}</p>
      <form
        ref={formRef}
        id={KENNITALA_LOOKUP_FORM_ID}
        action={formAction}
        noValidate
        className="mt-4 space-y-3"
      >
        <input type="hidden" name="next" value={pathname} />
        {state.status === "error" && <FormMessage state={state} />}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="sm:w-64">
            <KennitalaField
              label={t("lookup.field")}
              name="kennitala"
              required
              defaultValue={state.values?.kennitala}
              error={state.fieldErrors?.kennitala}
            />
          </div>
          <SubmitButton pendingLabel={t("lookup.pending")} className="sm:mt-7">
            {t("lookup.submit")}
          </SubmitButton>
        </div>
        {state.status === "success" && state.message && (
          // Not found: neither good nor bad news, so a neutral box rather than a green one.
          <div
            role="status"
            tabIndex={-1}
            className="rounded-xl border border-line bg-surface-muted px-4 py-3 text-sm text-ink focus:outline-none"
          >
            {state.message}
            {state.link && (
              <>
                {" "}
                <Link href={state.link.href} className="font-semibold text-brand underline underline-offset-2">
                  {state.link.label}
                </Link>
              </>
            )}
          </div>
        )}
        {/* After a submission the action's own "Log in to look up a kennitala." takes its place. */}
        {!loggedIn && state.status === "idle" && (
          <p className="text-sm text-muted">
            {t.rich("lookup.loggedOutHint", {
              logIn: (
                <Link href={loginHref} className="font-semibold text-brand hover:underline">
                  {t("lookup.logInLink")}
                </Link>
              ),
            })}
          </p>
        )}
      </form>
    </section>
  );
}
