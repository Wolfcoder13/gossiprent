"use client";

import { useActionState, useRef } from "react";
import { login } from "@/app/actions/auth";
import { FormMessage, SubmitButton, TextInput, useFocusAfterSubmit } from "@/components/form";
import { idleFormState } from "@/lib/validation";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState(login, idleFormState);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusAfterSubmit(formRef, state);
  const errors = state.fieldErrors ?? {};
  return (
    <form ref={formRef} action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <FormMessage state={state} />
      <TextInput
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        error={errors.email}
      />
      <TextInput
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={errors.password}
      />
      <SubmitButton pendingLabel="Logging in…" className="w-full">
        Log in
      </SubmitButton>
    </form>
  );
}
