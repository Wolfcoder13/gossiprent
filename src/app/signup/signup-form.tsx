"use client";

import { useActionState, useId, useRef } from "react";
import { signup } from "@/app/actions/auth";
import { FormMessage, SubmitButton, TextInput, useFocusAfterSubmit } from "@/components/form";
import { cx } from "@/components/ui";
import { idleFormState } from "@/lib/validation";

const ROLES = [
  {
    value: "renter",
    title: "I'm a renter",
    body: "Review your landlords and the places you've lived.",
  },
  {
    value: "landlord",
    title: "I'm a landlord",
    body: "List your properties and review your renters.",
  },
] as const;

export function SignupForm({
  next,
  defaultRole,
}: {
  next: string;
  defaultRole?: "landlord" | "renter";
}) {
  const [state, formAction] = useActionState(signup, idleFormState);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusAfterSubmit(formRef, state);
  const errors = state.fieldErrors ?? {};
  const values = state.values ?? {};
  const role = values.role ?? defaultRole;
  const roleErrorId = useId();

  return (
    <form ref={formRef} action={formAction} className="space-y-5" noValidate key={JSON.stringify(values)}>
      <input type="hidden" name="next" value={next} />
      <FormMessage state={state} />

      <fieldset aria-describedby={errors.role ? roleErrorId : undefined}>
        <legend className="text-sm font-medium text-ink">I&apos;m joining as a…</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {ROLES.map((option) => (
            <label
              key={option.value}
              className={cx(
                "relative flex cursor-pointer flex-col rounded-xl border border-line-strong bg-surface p-4 transition-colors",
                "has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus",
              )}
            >
              <input
                type="radio"
                name="role"
                value={option.value}
                defaultChecked={role === option.value}
                className="sr-only"
              />
              <span className="font-semibold text-ink">{option.title}</span>
              <span className="mt-1 text-sm text-muted">{option.body}</span>
            </label>
          ))}
        </div>
        {errors.role && (
          <p id={roleErrorId} className="mt-1.5 text-sm text-danger">
            {errors.role[0]}
          </p>
        )}
      </fieldset>

      <TextInput
        label="Name"
        name="name"
        autoComplete="name"
        required
        maxLength={80}
        defaultValue={values.name}
        hint="Shown on your profile and reviews. A company name is fine for landlords."
        error={errors.name}
      />
      <TextInput
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={values.email}
        error={errors.email}
      />
      <TextInput
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        hint="At least 8 characters."
        error={errors.password}
      />
      <TextInput
        label="City"
        name="city"
        autoComplete="address-level2"
        maxLength={80}
        defaultValue={values.city}
        placeholder="e.g. Austin, TX"
        error={errors.city}
      />
      <SubmitButton pendingLabel="Creating account…" className="w-full">
        Create account
      </SubmitButton>
    </form>
  );
}
