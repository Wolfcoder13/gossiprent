"use client";

import { useActionState, useRef } from "react";
import { createProperty } from "@/app/actions/properties";
import {
  FormMessage,
  Select,
  SubmitButton,
  TextArea,
  TextInput,
  useFocusAfterSubmit,
} from "@/components/form";
import { idleFormState } from "@/lib/validation";

export function PropertyForm({
  role,
  landlords,
}: {
  role: "landlord" | "renter";
  landlords: { id: string; name: string; city: string | null }[];
}) {
  const [state, formAction] = useActionState(createProperty, idleFormState);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusAfterSubmit(formRef, state);
  const errors = state.fieldErrors ?? {};
  const values = state.values ?? {};

  return (
    <form ref={formRef} action={formAction} className="space-y-5" noValidate key={JSON.stringify(values)}>
      <FormMessage state={state} />
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <TextInput
          label="Street address"
          name="address"
          autoComplete="address-line1"
          required
          maxLength={200}
          placeholder="e.g. 1408 E 6th St"
          defaultValue={values.address}
          error={errors.address}
        />
        <TextInput
          label="Unit"
          name="unit"
          autoComplete="address-line2"
          maxLength={30}
          placeholder="e.g. 2B"
          defaultValue={values.unit}
          error={errors.unit}
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <TextInput
          label="City"
          name="city"
          autoComplete="address-level2"
          required
          maxLength={80}
          defaultValue={values.city}
          error={errors.city}
        />
        <TextInput
          label="State / region"
          name="region"
          autoComplete="address-level1"
          required
          maxLength={80}
          placeholder="e.g. TX"
          defaultValue={values.region}
          error={errors.region}
        />
        <TextInput
          label="ZIP / postal code"
          name="postalCode"
          autoComplete="postal-code"
          maxLength={20}
          defaultValue={values.postalCode}
          error={errors.postalCode}
        />
      </div>
      <TextArea
        label="Short description"
        name="description"
        rows={2}
        maxLength={300}
        placeholder="e.g. Two-bedroom apartment in a 1920s walk-up"
        defaultValue={values.description}
        error={errors.description}
      />
      {role === "renter" && (
        <Select
          label="Landlord"
          name="landlordId"
          defaultValue={values.landlordId ?? ""}
          hint="If your landlord has a GossipRent account, link them so the property shows up on their profile."
          error={errors.landlordId}
        >
          <option value="">My landlord isn&apos;t on GossipRent / I&apos;m not sure</option>
          {landlords.map((landlord) => (
            <option key={landlord.id} value={landlord.id}>
              {landlord.name}
              {landlord.city ? ` — ${landlord.city}` : ""}
            </option>
          ))}
        </Select>
      )}
      <SubmitButton pendingLabel="Adding…">Add property</SubmitButton>
    </form>
  );
}
