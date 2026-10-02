"use client";

import { useActionState } from "react";
import { updateProfile } from "@/app/actions/account";
import { FormMessage, SubmitButton, TextArea, TextInput } from "@/components/form";
import { idleFormState } from "@/lib/validation";

export function ProfileForm({
  user,
}: {
  user: { name: string; city: string | null; bio: string | null };
}) {
  const [state, formAction] = useActionState(updateProfile, idleFormState);
  const errors = state.fieldErrors ?? {};
  const values = state.values ?? { name: user.name, city: user.city ?? "", bio: user.bio ?? "" };

  return (
    <form action={formAction} className="space-y-4" noValidate key={JSON.stringify(values)}>
      <FormMessage state={state} />
      <TextInput
        label="Name"
        name="name"
        autoComplete="name"
        required
        maxLength={80}
        defaultValue={values.name}
        error={errors.name}
      />
      <TextInput
        label="City"
        name="city"
        autoComplete="address-level2"
        maxLength={80}
        defaultValue={values.city}
        error={errors.city}
      />
      <TextArea
        label="Bio"
        name="bio"
        rows={3}
        maxLength={500}
        defaultValue={values.bio}
        hint="A sentence or two about you. Max 500 characters."
        error={errors.bio}
      />
      <SubmitButton pendingLabel="Saving…">Save profile</SubmitButton>
    </form>
  );
}
