"use client";

import { useActionState, useId, useRef } from "react";
import { createProperty, type PropertyFormState } from "@/app/actions/properties";
import { FormMessage, Select, SubmitButton, TextArea, TextInput, useFocusAfterSubmit } from "@/components/form";
import { cx } from "@/components/ui";
import { useT } from "@/i18n/client";
import { idleFormState, LIMITS } from "@/lib/form-state";
import type { Postcode } from "@/lib/postcodes";
import { LandlordFields } from "../landlord-fields";

// Message keys for the own/rent choice (people with both roles).
const RELATIONS = [
  { value: "own", title: "properties.form.relation.own", body: "properties.form.relation.ownHint" },
  { value: "rent", title: "properties.form.relation.rent", body: "properties.form.relation.rentHint" },
] as const;

export function PropertyForm({
  isLandlord,
  isRenter,
  postcodes,
  defaultRelation,
}: {
  isLandlord: boolean;
  isRenter: boolean;
  /** The choices for "Postcode" (HOME_POSTCODES). */
  postcodes: readonly Postcode[];
  /** Preselected own/rent choice, from ?as=landlord or ?as=renter (dashboard links). */
  defaultRelation?: "own" | "rent";
}) {
  const t = useT();
  const [state, formAction] = useActionState<PropertyFormState, FormData>(createProperty, idleFormState);
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
      {isRenter && (
        // Enter in a text field presses the form's first submit button. Make
        // that "Add property", not the "Check" button further down.
        <button type="submit" name="intent" value="save" tabIndex={-1} aria-hidden className="sr-only">
          {t("properties.form.submit")}
        </button>
      )}
      <FormMessage state={state} />
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <TextInput
          label={t("properties.form.address")}
          name="address"
          autoComplete="address-line1"
          required
          maxLength={LIMITS.address.max}
          hint={t("properties.form.addressHint")}
          defaultValue={values.address}
          error={errors.address}
        />
        <TextInput
          label={t("properties.form.unit")}
          name="unit"
          autoComplete="address-line2"
          maxLength={LIMITS.unit.max}
          hint={t("properties.form.unitHint")}
          defaultValue={values.unit}
          error={errors.unit}
        />
      </div>
      <Select
        label={t("properties.form.postalCode")}
        name="postalCode"
        required
        defaultValue={values.postalCode ?? ""}
        error={errors.postalCode}
      >
        <option value="">{t("properties.form.choosePostcode")}</option>
        {postcodes.map((postcode) => (
          <option key={postcode.code} value={String(postcode.code)}>
            {postcode.code} {postcode.place}
          </option>
        ))}
      </Select>
      <TextArea
        label={t("properties.form.description")}
        name="description"
        rows={2}
        maxLength={LIMITS.description.max}
        placeholder={t("properties.form.descriptionPlaceholder")}
        defaultValue={values.description}
        error={errors.description}
      />
      {both && (
        <fieldset aria-describedby={errors.relation ? relationErrorId : undefined} className="space-y-2">
          <legend className="text-sm font-medium text-ink">{t("properties.form.relation.legend")}</legend>
          <div
            role="radiogroup"
            aria-label={t("properties.form.relation.legend")}
            aria-invalid={errors.relation ? true : undefined}
            className="grid gap-2 sm:grid-cols-2"
          >
            {RELATIONS.map((relation) => (
              <label
                key={relation.value}
                className={cx(
                  "relative flex cursor-pointer flex-col rounded-xl border bg-surface p-3.5 transition-colors",
                  errors.relation ? "border-danger" : "border-line-strong",
                  "has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus",
                )}
              >
                <input
                  type="radio"
                  name="relation"
                  value={relation.value}
                  defaultChecked={initialRelation === relation.value}
                  aria-describedby={errors.relation ? relationErrorId : undefined}
                  className="absolute right-3.5 top-3.5 size-4 accent-brand"
                />
                <span className="pr-6 font-semibold text-ink">{t(relation.title)}</span>
                <span className="mt-0.5 text-sm text-muted">{t(relation.body)}</span>
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
        // the landlord fields when they pick "Own".)
        <div
          className={
            both ? "hidden group-has-[input[name=relation][value=rent]:checked]/property:block" : undefined
          }
        >
          <LandlordFields state={state} />
        </div>
      )}
      <SubmitButton name="intent" value="save" pendingLabel={t("properties.form.submitting")}>
        {t("properties.form.submit")}
      </SubmitButton>
    </form>
  );
}
