"use client";

import { useActionState, useRef } from "react";
import { changePassword, signOutOtherDevices } from "@/app/actions/account";
import { FormMessage, SubmitButton, TextInput, useFocusAfterSubmit } from "@/components/form";
import { useT } from "@/i18n/client";
import { idleFormState, LIMITS } from "@/lib/form-state";

export function PasswordForm() {
  const t = useT();
  const [state, formAction] = useActionState(changePassword, idleFormState);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusAfterSubmit(formRef, state);
  const errors = state.fieldErrors ?? {};
  return (
    <form ref={formRef} action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <TextInput
        label={t("account.password.current")}
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
        error={errors.currentPassword}
      />
      <TextInput
        label={t("account.password.newPassword")}
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        minLength={LIMITS.password.min}
        hint={t("auth.passwordHint", { count: LIMITS.password.min })}
        error={errors.newPassword}
      />
      <TextInput
        label={t("account.password.confirm")}
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        error={errors.confirmPassword}
      />
      <SubmitButton pendingLabel={t("account.password.pending")}>{t("account.password.submit")}</SubmitButton>
    </form>
  );
}

export function SignOutOthersForm() {
  const t = useT();
  const [state, formAction] = useActionState(signOutOtherDevices, idleFormState);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusAfterSubmit(formRef, state);
  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <FormMessage state={state} />
      <SubmitButton variant="secondary" pendingLabel={t("account.password.signingOut")}>
        {t("account.password.signOutOthers")}
      </SubmitButton>
    </form>
  );
}
