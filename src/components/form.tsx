"use client";

import Link from "next/link";
import { useEffect, useId, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { useFormStatus } from "react-dom";
import { useT } from "@/i18n/client";
import type { FormState } from "@/lib/form-state";
import { buttonStyles, cx, Notice } from "./ui";

const inputStyles =
  "block w-full rounded-xl border border-line-input bg-surface px-3.5 py-2.5 text-ink placeholder:text-muted shadow-xs transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-focus/40 aria-invalid:border-danger";

type FieldProps = {
  label: string;
  name: string;
  error?: string[];
  hint?: ReactNode;
  required?: boolean;
  /** The id of text elsewhere on the page that also describes the control (read before the hint). */
  describedBy?: string;
  children: (ids: { inputId: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
};

/** Label + control + hint + error, wired up with ids for screen readers. */
function Field({ label, name, error, hint, required, describedBy: extraDescription, children }: FieldProps) {
  const t = useT();
  const id = useId();
  const inputId = `${name}-${id}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error?.length ? `${inputId}-error` : undefined;
  const describedBy = [extraDescription, hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-ink">
        {label}
        {!required && <span className="font-normal text-muted"> {t("common.optional")}</span>}
      </label>
      {children({ inputId, describedBy, invalid: Boolean(errorId) })}
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {errorId && (
        <p id={errorId} className="text-sm text-danger">
          {error![0]}
        </p>
      )}
    </div>
  );
}

type InputProps = {
  label: string;
  name: string;
  type?: "text" | "email" | "password";
  defaultValue?: string;
  error?: string[];
  hint?: ReactNode;
  required?: boolean;
  autoComplete?: string;
  maxLength?: number;
  minLength?: number;
  placeholder?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  spellCheck?: boolean;
  autoCapitalize?: "off" | "none" | "on" | "sentences" | "words" | "characters";
  autoCorrect?: "on" | "off";
  /** Focus the field when the page loads (rendered as `autofocus`, so it works without JavaScript too). */
  autoFocus?: boolean;
  describedBy?: string;
};

export function TextInput({ label, name, error, hint, required, describedBy, ...rest }: InputProps) {
  return (
    <Field label={label} name={name} error={error} hint={hint} required={required} describedBy={describedBy}>
      {({ inputId, describedBy, invalid }) => (
        <input
          id={inputId}
          name={name}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={inputStyles}
          {...rest}
          type={rest.type ?? "text"}
        />
      )}
    </Field>
  );
}

export function TextArea({
  label,
  name,
  error,
  hint,
  required,
  describedBy,
  rows,
  ...rest
}: Omit<InputProps, "type" | "autoComplete"> & { rows: number }) {
  return (
    <Field label={label} name={name} error={error} hint={hint} required={required} describedBy={describedBy}>
      {({ inputId, describedBy, invalid }) => (
        <textarea
          id={inputId}
          name={name}
          rows={rows}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cx(inputStyles, "resize-y")}
          {...rest}
        />
      )}
    </Field>
  );
}

/**
 * A kennitala input. Text with a numeric keyboard (never type="number", which
 * would drop the hyphen and leading zeros); the server accepts "123456-7890",
 * "123456 7890" or "1234567890". `hint` defaults to the format; pass null to hide it.
 */
export function KennitalaField({
  label,
  name,
  defaultValue,
  error,
  hint,
  required,
  autoFocus,
  describedBy,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  error?: string[];
  hint?: ReactNode;
  required?: boolean;
  autoFocus?: boolean;
  /** The id of text elsewhere on the page that also describes the field. */
  describedBy?: string;
}) {
  const t = useT();
  return (
    <TextInput
      label={label}
      name={name}
      defaultValue={defaultValue}
      error={error}
      hint={hint === undefined ? t("common.kennitala.hint") : hint}
      required={required}
      autoFocus={autoFocus}
      describedBy={describedBy}
      inputMode="numeric"
      autoComplete="off"
      maxLength={13}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
    />
  );
}

export function Select({
  label,
  name,
  error,
  hint,
  required,
  defaultValue,
  children,
}: {
  label: string;
  name: string;
  error?: string[];
  hint?: ReactNode;
  required?: boolean;
  defaultValue?: string;
  children: ReactNode;
}) {
  return (
    <Field label={label} name={name} error={error} hint={hint} required={required}>
      {({ inputId, describedBy, invalid }) => (
        <select
          id={inputId}
          name={name}
          required={required}
          defaultValue={defaultValue}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={inputStyles}
        >
          {children}
        </select>
      )}
    </Field>
  );
}

/**
 * Submit button that disables itself while the form is submitting. With
 * `name`/`value` (e.g. intent=check next to intent=save), only the button that
 * was pressed shows its `pendingLabel`.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  className,
  name,
  value,
}: {
  children: ReactNode;
  pendingLabel: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending, data } = useFormStatus();
  const pressed = pending && (name === undefined || data?.get(name) === value);
  return (
    <button
      type="submit"
      name={name}
      value={value}
      // Not `disabled`: a disabled button loses keyboard focus mid-submit.
      aria-disabled={pending}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
      className={cx(buttonStyles.base, buttonStyles[variant], "px-5 py-2.5", className)}
    >
      {pressed ? pendingLabel : children}
    </button>
  );
}

/**
 * After a submission, move keyboard focus somewhere useful: the first invalid
 * field, else the error or success message. Forms re-render (and often
 * re-mount) after an action, which would otherwise drop focus to <body>.
 */
export function useFocusAfterSubmit(
  formRef: RefObject<HTMLElement | null>,
  state: FormState,
): void {
  useEffect(() => {
    const form = formRef.current;
    if (!form || state.status === "idle") return;
    const target =
      state.status === "error"
        ? (form.querySelector<HTMLElement>(
            'fieldset[aria-invalid="true"] input, [role="radiogroup"][aria-invalid="true"] input, [aria-invalid="true"]:is(input, textarea, select)',
          ) ?? form.querySelector<HTMLElement>('[role="alert"]'))
        : form.querySelector<HTMLElement>('[role="status"]');
    target?.focus();
  }, [formRef, state]);
}

/** Success or error banner for a form's last submission. */
export function FormMessage({ state }: { state: FormState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <Notice tone={state.status === "error" ? "error" : "success"}>
      {state.message}
      {state.link && (
        <>
          {" "}
          <Link href={state.link.href} className="font-semibold underline underline-offset-2">
            {state.link.label}
          </Link>
        </>
      )}
    </Notice>
  );
}
