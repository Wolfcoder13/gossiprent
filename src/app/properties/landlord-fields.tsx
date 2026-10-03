"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PropertyFormState } from "@/app/actions/properties";
import { KennitalaField, SubmitButton, TextInput } from "@/components/form";
import { useT } from "@/i18n/client";
import { LIMITS } from "@/lib/form-state";

/**
 * The landlord's kennitala with a "Check" button (a second submit button,
 * intent=check), the answer, and, for a kennitala nobody has yet, the
 * landlord's name and a confirmation. Used by the add-a-property form and the
 * "change the landlord" form; both actions answer a check with `landlord`.
 */
export function LandlordFields({ state }: { state: PropertyFormState }) {
  const t = useT();
  const values = state.values ?? {};
  const errors = state.fieldErrors ?? {};
  // Editing the kennitala after a check makes the answer stale: hide it until the next one.
  const [staleFor, setStaleFor] = useState<PropertyFormState | null>(null);
  const lookup = staleFor === state ? undefined : state.landlord;
  const askForName = state.landlord
    ? !state.landlord.found
    : Boolean(values.landlordName || errors.landlordName || errors.confirmNewLandlord);
  const answerRef = useRef<HTMLDivElement>(null);
  const confirmId = useId();
  const confirmErrorId = `${confirmId}-error`;

  // After "Check", move focus to the answer so it's read out, next to the next step.
  useEffect(() => {
    if (state.status === "idle" && state.landlord) answerRef.current?.focus();
  }, [state]);

  return (
    <div
      className="space-y-3"
      onChange={(event) => {
        if ((event.target as HTMLInputElement).name === "landlordKennitala") setStaleFor(state);
      }}
    >
      <KennitalaField
        label={t("properties.form.landlord.kennitala")}
        name="landlordKennitala"
        defaultValue={values.landlordKennitala}
        error={errors.landlordKennitala}
        hint={t("properties.form.landlord.kennitalaHint")}
      />
      <SubmitButton
        name="intent"
        value="check"
        variant="secondary"
        pendingLabel={t("properties.form.landlord.checking")}
        className="px-4! py-2! text-sm"
      >
        {t("properties.form.landlord.check")}
      </SubmitButton>
      {lookup && (
        <div
          ref={answerRef}
          tabIndex={-1}
          className="space-y-1 rounded-xl bg-surface-muted px-4 py-3 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {lookup.found ? (
            <p className="wrap-anywhere">
              {t.rich("properties.form.landlord.found", { name: <strong>{lookup.name}</strong> })}
            </p>
          ) : (
            <>
              <p>{t("properties.form.landlord.notFound")}</p>
              {lookup.isCompany && <p className="text-muted">{t("properties.form.landlord.company")}</p>}
              {lookup.birthDate && (
                <p className="text-muted">{t("properties.form.landlord.born", { date: lookup.birthDate })}</p>
              )}
            </>
          )}
        </div>
      )}
      {askForName && (
        <>
          <TextInput
            label={t("properties.form.landlord.name")}
            name="landlordName"
            required
            autoComplete="off"
            spellCheck={false}
            maxLength={LIMITS.name.max}
            defaultValue={values.landlordName}
            hint={t("properties.form.landlord.nameHint")}
            error={errors.landlordName}
          />
          <div className="space-y-1.5">
            <label htmlFor={confirmId} className="flex items-start gap-2.5 text-sm text-ink">
              <input
                id={confirmId}
                type="checkbox"
                name="confirmNewLandlord"
                defaultChecked={values.confirmNewLandlord === "on"}
                aria-invalid={errors.confirmNewLandlord ? true : undefined}
                aria-describedby={errors.confirmNewLandlord ? confirmErrorId : undefined}
                className="mt-0.5 size-4 shrink-0 accent-brand"
              />
              <span>{t("properties.form.landlord.confirm")}</span>
            </label>
            {errors.confirmNewLandlord && (
              <p id={confirmErrorId} className="text-sm text-danger">
                {errors.confirmNewLandlord[0]}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
