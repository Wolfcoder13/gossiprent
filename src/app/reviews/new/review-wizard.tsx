"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, type Ref } from "react";
import { reviewWizard, type WizardState, type WizardSubject } from "@/app/actions/reviews";
import { FormMessage, KennitalaField, SubmitButton, TextInput, useFocusAfterSubmit } from "@/components/form";
import { KENNITALA_LABEL, ReviewFields, ReviewGuidelines } from "@/components/review-form";
import { NoAccountBadge } from "@/components/role-badge";
import { useT } from "@/i18n/client";
import { LIMITS } from "@/lib/form-state";

type Kind = "landlord" | "renter";

const INITIAL: WizardState = { status: "idle", step: "kennitala" };

// Message keys, per kind.
const HEADING = { landlord: "reviews.wizard.heading.landlord", renter: "reviews.wizard.heading.renter" } as const;
const KENNITALA_INTRO = {
  landlord: "reviews.wizard.kennitalaIntro.landlord",
  renter: "reviews.wizard.kennitalaIntro.renter",
} as const;

/** Who the kennitala belongs to, or what we know about a new one. */
function SubjectSummary({ subject, headingRef }: { subject: WizardSubject; headingRef: Ref<HTMLHeadingElement> }) {
  const t = useT();
  return (
    <div className="rounded-xl border border-line bg-surface-muted px-4 py-3">
      <h3 ref={headingRef} tabIndex={-1} className="font-semibold text-ink focus:outline-none">
        {subject.name ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="wrap-anywhere">
              {t.rich("reviews.wizard.found", { name: <strong>{subject.name}</strong> })}
            </span>
            {!subject.hasAccount && <NoAccountBadge />}
          </span>
        ) : (
          t("reviews.wizard.notFound")
        )}
      </h3>
      <ul className="mt-2 space-y-0.5 text-sm text-muted">
        <li>{t("reviews.wizard.kennitala", { kennitala: subject.formattedKennitala })}</li>
        {!subject.name &&
          (subject.isCompany ? (
            <li>{t("reviews.wizard.company")}</li>
          ) : (
            subject.birthDate && <li>{t("reviews.wizard.born", { date: subject.birthDate })}</li>
          ))}
      </ul>
    </div>
  );
}

/**
 * /reviews/new after choosing a landlord or renter: their kennitala
 * ("Continue"), then who it belongs to and the review ("Post review").
 * Works without JavaScript: the step and subject come back in the action's state.
 */
export function ReviewWizard({ kind, backHref }: { kind: Kind; backHref: string | null }) {
  const t = useT();
  const [state, formAction] = useActionState(reviewWizard, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const subjectHeading = useRef<HTMLHeadingElement>(null);
  const confirmId = useId();
  const values: Record<string, string | undefined> = state.values ?? {};
  const errors = state.fieldErrors ?? {};
  const subject = state.step === "review" ? state.subject : undefined;

  // Errors focus the first invalid field (or the banner).
  useFocusAfterSubmit(formRef, state);
  // Moving on to the review step: start reading at who the kennitala belongs to.
  useEffect(() => {
    if (subject && state.status === "idle") subjectHeading.current?.focus();
  }, [subject, state.status]);

  if (!subject) {
    return (
      <form ref={formRef} action={formAction} noValidate className="space-y-5" key={JSON.stringify(values)}>
        <input type="hidden" name="kind" value={kind} />
        <h2 className="text-xl font-semibold text-ink">{t(HEADING[kind])}</h2>
        <FormMessage state={state} />
        <p className="text-sm text-muted">{t(KENNITALA_INTRO[kind])}</p>
        <KennitalaField
          label={t(KENNITALA_LABEL[kind])}
          name="subjectKennitala"
          required
          defaultValue={values.subjectKennitala}
          error={errors.subjectKennitala}
          hint={t("reviews.form.kennitalaHint")}
        />
        <div className="flex flex-wrap items-center gap-4">
          <SubmitButton name="intent" value="check" pendingLabel={t("reviews.wizard.checking")}>
            {t("reviews.wizard.continue")}
          </SubmitButton>
          {backHref && (
            <Link href={backHref} className="text-sm font-semibold text-brand hover:underline">
              {t("reviews.wizard.back")}
            </Link>
          )}
        </div>
      </form>
    );
  }

  const isNew = subject.id === null;
  return (
    <form ref={formRef} action={formAction} noValidate className="space-y-5" key={JSON.stringify(values)}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="subjectKennitala" value={subject.formattedKennitala} />
      <h2 className="text-xl font-semibold text-ink">{t(HEADING[kind])}</h2>
      <FormMessage state={state} />
      <SubjectSummary subject={subject} headingRef={subjectHeading} />
      {isNew && (
        <>
          <TextInput
            label={subject.isCompany ? t("reviews.wizard.companyName") : t("reviews.wizard.fullName")}
            name="subjectName"
            required
            maxLength={LIMITS.name.max}
            autoComplete="off"
            defaultValue={values.subjectName}
            hint={t("reviews.wizard.nameHint")}
            error={errors.subjectName}
          />
          <div className="space-y-1.5">
            <label className="flex items-start gap-3 text-sm text-ink">
              <input
                type="checkbox"
                name="confirmNew"
                defaultChecked={values.confirmNew === "on"}
                aria-invalid={errors.confirmNew ? true : undefined}
                aria-describedby={errors.confirmNew ? confirmId : undefined}
                className="mt-0.5 size-4 shrink-0 accent-brand"
              />
              <span>{t("reviews.wizard.confirm")}</span>
            </label>
            {errors.confirmNew && (
              <p id={confirmId} className="text-sm text-danger">
                {errors.confirmNew[0]}
              </p>
            )}
          </div>
        </>
      )}
      <ReviewGuidelines />
      <ReviewFields kind={kind} values={values} errors={errors} />
      <SubmitButton name="intent" value="save" pendingLabel={t("reviews.form.posting")}>
        {t("reviews.form.post")}
      </SubmitButton>
      <p className="text-sm text-muted">
        {t.rich("reviews.wizard.wrongKennitala", {
          // A plain anchor: a full page load starts the form from scratch.
          startOver: (
            <a href={`/reviews/new?kind=${kind}`} className="font-semibold text-brand hover:underline">
              {t("reviews.wizard.startOver")}
            </a>
          ),
        })}
      </p>
    </form>
  );
}
