"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { useT } from "@/i18n/client";
import { KENNITALA_LOOKUP_FORM_ID, KENNITALA_LOOKUP_PATH, queryHasKennitala } from "./kennitala-query";
import { buttonStyles, cx } from "./ui";

const VARIANTS = {
  /** The home page's big search box. */
  hero: {
    wrapper: "mt-8 max-w-xl",
    form: "flex flex-col gap-2 sm:flex-row",
    input:
      "flex-1 rounded-full border border-line-input bg-surface px-5 py-3 text-ink shadow-sm placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-focus/40",
    button: "rounded-full bg-brand px-6 py-3 font-semibold text-brand-ink hover:bg-brand-hover",
  },
  /** /search */
  page: {
    wrapper: "mt-6 max-w-xl",
    form: "flex gap-2",
    input:
      "min-w-0 flex-1 rounded-full border border-line-input bg-surface px-5 py-2.5 text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-focus/40",
    button: "rounded-full bg-brand px-5 py-2.5 font-semibold text-brand-ink hover:bg-brand-hover",
  },
  /** A directory's filter bar (with the sort select as children). */
  bar: {
    wrapper: "",
    form: "flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3 shadow-sm sm:flex-row sm:items-center",
    input:
      "min-w-0 flex-1 rounded-xl border border-line-input bg-surface px-4 py-2.5 text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-focus/40",
    button: cx(buttonStyles.base, buttonStyles.primary, "py-2.5"),
  },
};

/**
 * A search box: a plain GET form (`q`), so it works without JavaScript. With
 * JavaScript it never sends a kennitala: one typed here is moved into the
 * kennitala lookup form on the same page (and focused), or, where there's no
 * lookup form, the visitor is taken to it (/search?kt=1, whose lookup field
 * has autofocus) without the number. Without JavaScript the page itself
 * redirects there (redirectKennitalaQuery).
 */
export function SearchBox({
  action,
  inputId,
  label,
  placeholder,
  buttonLabel,
  defaultValue,
  variant,
  children,
}: {
  /** Where the form goes, e.g. "/search" or "/landlords". */
  action: string;
  inputId: string;
  /** Accessible name of the search box (visually hidden). */
  label: string;
  placeholder: string;
  buttonLabel: string;
  defaultValue?: string;
  variant: keyof typeof VARIANTS;
  /** Controls between the box and the button (e.g. the directory's sort select). */
  children?: ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const [handedOver, setHandedOver] = useState(false);
  const styles = VARIANTS[variant];

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const input = event.currentTarget.elements.namedItem("q");
    if (!(input instanceof HTMLInputElement) || !queryHasKennitala(input.value)) {
      setHandedOver(false);
      return;
    }
    event.preventDefault();
    const typed = input.value.trim();
    input.value = "";
    const lookup = document.querySelector<HTMLInputElement>(`#${KENNITALA_LOOKUP_FORM_ID} input[name="kennitala"]`);
    if (lookup) {
      lookup.value = typed;
      lookup.focus();
      setHandedOver(true);
    } else {
      router.push(KENNITALA_LOOKUP_PATH);
    }
  }

  return (
    <div className={styles.wrapper}>
      <form action={action} role="search" onSubmit={onSubmit} className={styles.form}>
        <label htmlFor={inputId} className="sr-only">
          {label}
        </label>
        <input
          id={inputId}
          name="q"
          type="search"
          defaultValue={defaultValue}
          placeholder={placeholder}
          className={styles.input}
        />
        {children}
        <button type="submit" className={styles.button}>
          {buttonLabel}
        </button>
      </form>
      {/* Always rendered, so screen readers announce the text when it appears. */}
      <p role="status" className={cx("text-sm text-muted", handedOver && "mt-2")}>
        {handedOver ? t("lookup.useFormBelow") : null}
      </p>
    </div>
  );
}
