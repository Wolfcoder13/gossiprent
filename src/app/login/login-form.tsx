"use client";

import { useActionState, useRef } from "react";
import { login } from "@/app/actions/auth";
import { FormMessage, SubmitButton, TextInput, useFocusAfterSubmit } from "@/components/form";
import { useT } from "@/i18n/client";
import { idleFormState, LIMITS } from "@/lib/form-state";

export function LoginForm({ next }: { next: string }) {
  const t = useT();
  const [state, formAction] = useActionState(login, idleFormState);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusAfterSubmit(formRef, state);
  const errors = state.fieldErrors ?? {};
  return (
    <form ref={formRef} action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <FormMessage state={state} />
      <TextInput
        label={t("auth.fields.email")}
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={LIMITS.email.max}
        defaultValue={state.values?.email}
        error={errors.email}
      />
      <TextInput
        label={t("auth.fields.password")}
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={errors.password}
      />
      <SubmitButton pendingLabel={t("auth.login.pending")} className="w-full">
        {t("auth.login.submit")}
      </SubmitButton>
    </form>
  );
}
