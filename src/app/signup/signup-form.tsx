"use client";

import Link from "next/link";
import { useActionState, useId, useRef } from "react";
import { signup } from "@/app/actions/auth";
import { FormMessage, KennitalaField, SubmitButton, TextInput, useFocusAfterSubmit } from "@/components/form";
import { cx } from "@/components/ui";
import { useT } from "@/i18n/client";
import { idleFormState, LIMITS } from "@/lib/form-state";

const ROLES = [
  {
    value: "renter",
    name: "isRenter",
    title: "auth.signup.roles.renter.title",
    body: "auth.signup.roles.renter.body",
  },
  {
    value: "landlord",
    name: "isLandlord",
    title: "auth.signup.roles.landlord.title",
    body: "auth.signup.roles.landlord.body",
  },
] as const;

export function SignupForm({
  next,
  defaultRole,
}: {
  next: string;
  defaultRole?: "landlord" | "renter";
}) {
  const t = useT();
  const [state, formAction] = useActionState(signup, idleFormState);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusAfterSubmit(formRef, state);
  const errors = state.fieldErrors ?? {};
  const values = state.values ?? {};
  // After a failed submit, keep what was ticked; otherwise preselect ?role=.
  const checked = (option: (typeof ROLES)[number]) =>
    state.values ? values[option.name] === "on" : defaultRole === option.value;
  const roleErrorId = useId();
  const roleHintId = useId();
  // The only link the action returns: "Not you? Report it" when the kennitala
  // already has an account. Shown under that field rather than in the banner.
  const reportLink = state.status === "error" ? state.link : undefined;

  return (
    <form ref={formRef} action={formAction} className="space-y-5" noValidate key={JSON.stringify(values)}>
      <input type="hidden" name="next" value={next} />
      <FormMessage state={reportLink ? { ...state, link: undefined } : state} />

      <fieldset aria-describedby={roleHintId}>
        <legend className="text-sm font-medium text-ink">{t("auth.signup.roles.legend")}</legend>
        <p id={roleHintId} className="mt-1 text-xs text-muted">
          {t("auth.signup.roles.hint")}
        </p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {ROLES.map((option) => (
            <label
              key={option.value}
              className={cx(
                "relative flex cursor-pointer flex-col rounded-xl border bg-surface p-4 transition-colors",
                errors.roles ? "border-danger" : "border-line-strong",
                "has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus",
              )}
            >
              <input
                type="checkbox"
                name={option.name}
                defaultChecked={checked(option)}
                aria-invalid={errors.roles ? true : undefined}
                aria-describedby={errors.roles ? roleErrorId : undefined}
                className="absolute right-4 top-4 size-4 accent-brand"
              />
              <span className="pr-6 font-semibold text-ink">{t(option.title)}</span>
              <span className="mt-1 text-sm text-muted">{t(option.body)}</span>
            </label>
          ))}
        </div>
        {errors.roles && (
          <p id={roleErrorId} className="mt-1.5 text-sm text-danger">
            {errors.roles[0]}
          </p>
        )}
      </fieldset>

      <div className="space-y-1.5">
        <KennitalaField
          label={t("auth.fields.kennitala")}
          name="kennitala"
          required
          defaultValue={values.kennitala}
          error={errors.kennitala}
          hint={
            <>
              <span className="block">{t("common.kennitala.hint")}</span>
              <span className="mt-1 block">{t("auth.signup.kennitalaWhy")}</span>
            </>
          }
        />
        {reportLink && (
          <p className="text-sm">
            <Link href={reportLink.href} className="font-semibold text-brand hover:underline">
              {reportLink.label}
            </Link>
          </p>
        )}
      </div>
      <TextInput
        label={t("auth.fields.name")}
        name="name"
        autoComplete="name"
        required
        maxLength={LIMITS.name.max}
        defaultValue={values.name}
        hint={t("auth.signup.nameHint")}
        error={errors.name}
      />
      <TextInput
        label={t("auth.fields.email")}
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={LIMITS.email.max}
        defaultValue={values.email}
        error={errors.email}
      />
      <TextInput
        label={t("auth.fields.password")}
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={LIMITS.password.min}
        hint={t("auth.passwordHint", { count: LIMITS.password.min })}
        error={errors.password}
      />
      <TextInput
        label={t("auth.fields.city")}
        name="city"
        autoComplete="address-level2"
        maxLength={LIMITS.city.max}
        defaultValue={values.city}
        placeholder={t("auth.signup.cityPlaceholder")}
        error={errors.city}
      />
      <SubmitButton pendingLabel={t("auth.signup.pending")} className="w-full">
        {t("auth.signup.submit")}
      </SubmitButton>
    </form>
  );
}
