"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { createReport } from "@/app/actions/reports";
import { FormMessage, Select, SubmitButton, TextArea, TextInput, useFocusAfterSubmit } from "@/components/form";
import type { ReportReason, ReportTarget } from "@/db/schema";
import { useT } from "@/i18n/client";
import { idleFormState, LIMITS } from "@/lib/form-state";

// Message keys.
const REASON_LABELS = {
  wrong_person: "report.reasons.wrong_person",
  wrong_name: "report.reasons.wrong_name",
  false_or_abusive: "report.reasons.false_or_abusive",
  personal_data: "report.reasons.personal_data",
  identity_claimed: "report.reasons.identity_claimed",
  other: "report.reasons.other",
} as const satisfies Record<ReportReason, string>;

/**
 * The report form: reason, details and (required when logged out) an email
 * address for the reply. After sending, it gives way to a thank-you and a
 * link back to the page the report is about.
 */
export function ReportForm({
  target,
  id,
  reasons,
  loggedIn,
  backHref,
}: {
  target: ReportTarget;
  id: string | null;
  /** The reasons to offer, in order. */
  reasons: readonly ReportReason[];
  loggedIn: boolean;
  /** Where "Go back" leads after sending. */
  backHref: string;
}) {
  const t = useT();
  const [state, formAction] = useActionState(createReport, idleFormState);
  const ref = useRef<HTMLDivElement>(null);
  useFocusAfterSubmit(ref, state);
  const values: Record<string, string | undefined> = state.values ?? {};
  const errors = state.fieldErrors ?? {};

  if (state.status === "success") {
    return (
      <div ref={ref} className="space-y-4">
        <FormMessage state={state} />
        <Link href={backHref} className="inline-block font-semibold text-brand hover:underline">
          ← {t("report.back")}
        </Link>
      </div>
    );
  }

  return (
    <div ref={ref}>
      {/* Re-mounted with each answer: a <select> keeps its first default otherwise (React only
          applies defaultValue on mount), and the form reset after an action would clear the reason. */}
      <form key={JSON.stringify(values)} action={formAction} noValidate className="space-y-5">
        <input type="hidden" name="target" value={target} />
        {id && <input type="hidden" name="id" value={id} />}
        <FormMessage state={state} />
        <Select
          label={t("report.fields.reason")}
          name="reason"
          required
          defaultValue={values.reason ?? (target === "account" ? "identity_claimed" : "")}
          error={errors.reason}
        >
          <option value="">{t("report.fields.chooseReason")}</option>
          {reasons.map((reason) => (
            <option key={reason} value={reason}>
              {t(REASON_LABELS[reason])}
            </option>
          ))}
        </Select>
        <TextArea
          label={t("report.fields.details")}
          name="details"
          required
          rows={6}
          maxLength={LIMITS.reportDetails.max}
          hint={t(target === "account" ? "report.fields.detailsHintAccount" : "report.fields.detailsHint")}
          defaultValue={values.details}
          error={errors.details}
        />
        <TextInput
          label={t(loggedIn ? "report.fields.replyEmail" : "report.fields.email")}
          name="contactEmail"
          type="email"
          autoComplete="email"
          required={!loggedIn}
          maxLength={LIMITS.email.max}
          hint={t(loggedIn ? "report.fields.replyEmailHint" : "report.fields.emailHint")}
          defaultValue={values.contactEmail}
          error={errors.contactEmail}
        />
        <SubmitButton pendingLabel={t("report.pending")}>{t("report.submit")}</SubmitButton>
      </form>
    </div>
  );
}
