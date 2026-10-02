"use client";

import { useActionState, useId, useRef } from "react";
import { createProperty } from "@/app/actions/properties";
import {
  FormMessage,
  Select,
  SubmitButton,
  TextArea,
  TextInput,
  useFocusAfterSubmit,
} from "@/components/form";
import { cx } from "@/components/ui";
import { idleFormState } from "@/lib/validation";

export function PropertyForm({
  isLandlord,
  isRenter,
  landlords,
  defaultRelation,
}: {
  isLandlord: boolean;
  isRenter: boolean;
  landlords: { id: string; name: string; city: string | null }[];
  /** Preselects "own" when coming from "Your properties" (?as=landlord). */
  defaultRelation?: "own" | "rent";
}) {
  const [state, formAction] = useActionState(createProperty, idleFormState);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusAfterSubmit(formRef, state);
  const errors = state.fieldErrors ?? {};
  const values = state.values ?? {};
  const both = isLandlord && isRenter;
  const initialRelation =
    values.relation === "own" || values.relation === "rent" ? values.relation : defaultRelation;
  const relationErrorId = useId();

  return (
    <form
      ref={formRef}
      action={formAction}
      className="group/property space-y-5"
      noValidate
      key={JSON.stringify(values)}
    >
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
      {both && (
        <fieldset
          aria-describedby={errors.relation ? relationErrorId : undefined}
          className="space-y-2"
        >
          <legend className="text-sm font-medium text-ink">This is a place I…</legend>
          <div
            role="radiogroup"
            aria-label="This is a place I…"
            aria-invalid={errors.relation ? true : undefined}
            className="grid gap-2 sm:grid-cols-2"
          >
            {(
              [
                ["own", "Own or manage", "It will show on your landlord profile."],
                ["rent", "Rent or used to rent", "So you can review it as a renter."],
              ] as const
            ).map(([value, title, body]) => (
              <label
                key={value}
                className={cx(
                  "relative flex cursor-pointer flex-col rounded-xl border bg-surface p-3.5 transition-colors",
                  errors.relation ? "border-danger" : "border-line-strong",
                  "has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus",
                )}
              >
                <input
                  type="radio"
                  name="relation"
                  value={value}
                  defaultChecked={initialRelation === value}
                  aria-describedby={errors.relation ? relationErrorId : undefined}
                  className="absolute right-3.5 top-3.5 size-4 accent-brand"
                />
                <span className="pr-6 font-semibold text-ink">{title}</span>
                <span className="mt-0.5 text-sm text-muted">{body}</span>
              </label>
            ))}
          </div>
          {errors.relation && (
            <p id={relationErrorId} className="text-sm text-danger">
              {errors.relation[0]}
            </p>
          )}
        </fieldset>
      )}
      {isRenter && (
        // For someone with both roles, only shown once they pick "Rent". Done
        // in CSS so it also works before JavaScript loads. (The server ignores
        // the landlord when they pick "Own".)
        <div
          className={
            both
              ? "hidden group-has-[input[name=relation][value=rent]:checked]/property:block"
              : undefined
          }
        >
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
        </div>
      )}
      <SubmitButton pendingLabel="Adding…">Add property</SubmitButton>
    </form>
  );
}
