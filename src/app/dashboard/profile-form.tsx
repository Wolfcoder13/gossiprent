"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { updateProfile } from "@/app/actions/account";
import { FormMessage, SubmitButton, TextArea, TextInput, useFocusAfterSubmit } from "@/components/form";
import { useT } from "@/i18n/client";
import { idleFormState, LIMITS } from "@/lib/form-state";

export function ProfileForm({
  user,
  nameLocked = false,
  reportHref,
}: {
  user: { name: string; city: string | null; bio: string | null };
  /** Others have reviewed them (or linked them to a property), so the name can't change. */
  nameLocked?: boolean;
  /** Where to report a wrong name. */
  reportHref?: string;
}) {
  const t = useT();
  const [state, formAction] = useActionState(updateProfile, idleFormState);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusAfterSubmit(formRef, state);
  const errors = state.fieldErrors ?? {};
  const values = state.values ?? { name: user.name, city: user.city ?? "", bio: user.bio ?? "" };

  return (
    <form ref={formRef} action={formAction} className="space-y-4" noValidate key={JSON.stringify(values)}>
      <FormMessage state={state} />
      <TextInput
        label={t("account.profile.name")}
        name="name"
        autoComplete="name"
        required
        maxLength={LIMITS.name.max}
        defaultValue={values.name}
        hint={
          nameLocked
            ? t.rich("account.profile.nameLockedHint", {
                report: reportHref ? (
                  <Link href={reportHref} className="font-semibold text-brand hover:underline">
                    {t("account.profile.report")}
                  </Link>
                ) : (
                  t("account.profile.report")
                ),
              })
            : undefined
        }
        error={errors.name}
      />
      <TextInput
        label={t("account.profile.city")}
        name="city"
        autoComplete="address-level2"
        maxLength={LIMITS.city.max}
        defaultValue={values.city}
        error={errors.city}
      />
      <TextArea
        label={t("account.profile.bio")}
        name="bio"
        rows={3}
        maxLength={LIMITS.bio.max}
        defaultValue={values.bio}
        hint={t("account.profile.bioHint", { count: LIMITS.bio.max })}
        error={errors.bio}
      />
      <SubmitButton pendingLabel={t("account.profile.saving")}>{t("account.profile.save")}</SubmitButton>
    </form>
  );
}
