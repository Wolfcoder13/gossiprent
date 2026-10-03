"use client";

import { useActionState, useRef } from "react";
import { saveReview } from "@/app/actions/reviews";
import type { ReviewKind } from "@/db/schema";
import { useT } from "@/i18n/client";
import { idleFormState, LIMITS, type FormState } from "@/lib/form-state";
import { FormMessage, KennitalaField, SubmitButton, TextArea, TextInput, useFocusAfterSubmit } from "./form";
import { StarInput } from "./star-input";

// Message keys, per kind (translated inside the components).
const TITLE_PLACEHOLDER = {
  landlord: "reviews.form.titlePlaceholder.landlord",
  renter: "reviews.form.titlePlaceholder.renter",
  property: "reviews.form.titlePlaceholder.property",
} as const;

const BODY_PLACEHOLDER = {
  landlord: "reviews.form.bodyPlaceholder.landlord",
  renter: "reviews.form.bodyPlaceholder.renter",
  property: "reviews.form.bodyPlaceholder.property",
} as const;

export const KENNITALA_LABEL = {
  landlord: "reviews.form.kennitala.landlord",
  renter: "reviews.form.kennitala.renter",
} as const;

/** What not to write: shown above every review form. */
export function ReviewGuidelines() {
  const t = useT();
  return (
    <p className="rounded-xl border border-line bg-surface-muted px-4 py-3 text-sm text-muted">
      {t("reviews.form.guidelines")}
    </p>
  );
}

/** Stars, headline and text: the part every review form shares. */
export function ReviewFields({
  kind,
  values,
  errors,
}: {
  kind: ReviewKind;
  values: Record<string, string | undefined>;
  errors: Partial<Record<string, string[]>>;
}) {
  const t = useT();
  return (
    <>
      <StarInput defaultValue={Number(values.rating) || undefined} error={errors.rating} />
      <TextInput
        label={t("reviews.form.title")}
        name="title"
        required
        maxLength={LIMITS.title.max}
        defaultValue={values.title}
        placeholder={t(TITLE_PLACEHOLDER[kind])}
        error={errors.title}
      />
      <TextArea
        label={t("reviews.form.body")}
        name="body"
        required
        rows={6}
        maxLength={LIMITS.body.max}
        defaultValue={values.body}
        placeholder={t(BODY_PLACEHOLDER[kind])}
        hint={t("reviews.form.bodyHint", { count: LIMITS.body.min })}
        error={errors.body}
      />
    </>
  );
}

/**
 * The review form on a landlord, renter or property page. A new review of a
 * person starts with that person's kennitala; an edit doesn't ask for it.
 */
export function ReviewForm({
  kind,
  subjectId,
  existing,
  savedMessage,
}: {
  kind: ReviewKind;
  subjectId: string;
  existing?: { rating: number; title: string; body: string } | null;
  /** Shown as the form's success message when it first renders (after /reviews/new sent the author here). */
  savedMessage?: string;
}) {
  const t = useT();
  const [state, formAction] = useActionState(
    saveReview,
    savedMessage ? ({ status: "success", message: savedMessage } satisfies FormState) : idleFormState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  // After a failed submit, re-fill what the user typed; otherwise show their saved review.
  const values: Record<string, string | undefined> =
    state.status === "error" && state.values
      ? state.values
      : existing
        ? { rating: String(existing.rating), title: existing.title, body: existing.body }
        : {};
  const errors = state.fieldErrors ?? {};
  // A success message only makes sense while the review still exists (not after deleting it).
  const message = state.status === "success" && !existing ? idleFormState : state;
  const askKennitala = kind !== "property" && !existing;

  // The form re-mounts after each submission (see `key`), which drops focus.
  useFocusAfterSubmit(formRef, state);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-5"
      noValidate
      key={JSON.stringify(values)}
    >
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="subjectId" value={subjectId} />
      <FormMessage state={message} />
      <ReviewGuidelines />
      {askKennitala && (
        <KennitalaField
          label={t(KENNITALA_LABEL[kind])}
          name="subjectKennitala"
          required
          defaultValue={values.subjectKennitala}
          error={errors.subjectKennitala}
          hint={t("reviews.form.kennitalaHint")}
        />
      )}
      <ReviewFields kind={kind} values={values} errors={errors} />
      <SubmitButton pendingLabel={existing ? t("reviews.form.saving") : t("reviews.form.posting")}>
        {existing ? t("reviews.form.update") : t("reviews.form.post")}
      </SubmitButton>
    </form>
  );
}
