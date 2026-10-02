"use client";

import { useActionState, useRef } from "react";
import { changePassword, signOutOtherDevices } from "@/app/actions/account";
import { FormMessage, SubmitButton, TextInput, useFocusAfterSubmit } from "@/components/form";
import { idleFormState } from "@/lib/validation";

export function PasswordForm() {
  const [state, formAction] = useActionState(changePassword, idleFormState);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusAfterSubmit(formRef, state);
  const errors = state.fieldErrors ?? {};
  return (
    <form ref={formRef} action={formAction} className="space-y-4" noValidate>
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
      <TextInput
        label="Confirm new password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        error={errors.confirmPassword}
      />
      <SubmitButton pendingLabel="Changing…">Change password</SubmitButton>
    </form>
  );
}

export function SignOutOthersForm() {
  const [state, formAction] = useActionState(signOutOtherDevices, idleFormState);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusAfterSubmit(formRef, state);
  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <FormMessage state={state} />
      <SubmitButton variant="secondary" pendingLabel="Signing out…">
        Sign out other devices
      </SubmitButton>
    </form>
  );
}
