"use client";

import { useActionState } from "react";
import { changePassword } from "@/app/actions/account";
import { FormMessage, SubmitButton, TextInput } from "@/components/form";
import { idleFormState } from "@/lib/validation";

export function PasswordForm() {
  const [state, formAction] = useActionState(changePassword, idleFormState);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <TextInput
        label="Current password"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
        error={errors.currentPassword}
      />
      <TextInput
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        hint="At least 8 characters."
        error={errors.newPassword}
      />
      <SubmitButton pendingLabel="Changing…">Change password</SubmitButton>
    </form>
  );
}
