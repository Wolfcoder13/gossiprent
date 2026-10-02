"use client";

import { useActionState, useEffect, useRef } from "react";
import { saveReview } from "@/app/actions/reviews";
import type { ReviewKind } from "@/db/schema";
import { idleFormState } from "@/lib/validation";
import { FormMessage, SubmitButton, TextArea, TextInput } from "./form";
import { StarInput } from "./star-input";

const PROMPTS: Record<ReviewKind, { title: string; body: string }> = {
  landlord: {
    title: "e.g. Fixes things fast, fair with the deposit",
    body: "How responsive were they? Were repairs handled well? Was the lease fair and the deposit returned?",
  },
  renter: {
    title: "e.g. Always paid on time, left the place spotless",
    body: "Did they pay on time? Take care of the place? Communicate well and respect the neighbors?",
  },
  property: {
    title: "e.g. Bright and quiet, but the heating is weak",
    body: "What's it like to live there? Noise, light, heating and cooling, appliances, pests, the neighborhood…",
  },
};

export function ReviewForm({
  kind,
  subjectId,
  existing,
}: {
  kind: ReviewKind;
  subjectId: string;
  existing?: { rating: number; title: string; body: string } | null;
}) {
  const [state, formAction] = useActionState(saveReview, idleFormState);
  const formRef = useRef<HTMLFormElement>(null);
  // After a failed submit, re-fill what the user typed; otherwise show their saved review.
  const values =
    state.status === "error" && state.values
      ? state.values
      : existing
        ? { rating: String(existing.rating), title: existing.title, body: existing.body }
        : {};
  const errors = state.fieldErrors ?? {};
  // A success message only makes sense while the review still exists (not after deleting it).
  const message = state.status === "success" && !existing ? idleFormState : state;

  // The form re-mounts after each submission (see `key`), which drops focus.
  // Put it on the first field that needs fixing, or on the success message.
  useEffect(() => {
    const form = formRef.current;
    if (!form || state.status === "idle") return;
    const target =
      state.status === "error"
        ? form.querySelector<HTMLElement>(
            'fieldset[aria-invalid="true"] input, [aria-invalid="true"]:is(input, textarea)',
          )
        : form.querySelector<HTMLElement>('[role="status"]');
    target?.focus();
  }, [state]);

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
      <StarInput defaultValue={Number(values.rating) || undefined} error={errors.rating} />
      <TextInput
        label="Headline"
        name="title"
        required
        maxLength={120}
        defaultValue={values.title}
        placeholder={PROMPTS[kind].title}
        error={errors.title}
      />
      <TextArea
        label="Your review"
        name="body"
        required
        rows={6}
        maxLength={5000}
        defaultValue={values.body}
        placeholder={PROMPTS[kind].body}
        hint="Stick to your own experience. At least 20 characters."
        error={errors.body}
      />
      <SubmitButton pendingLabel="Posting…">{existing ? "Update review" : "Post review"}</SubmitButton>
    </form>
  );
}
