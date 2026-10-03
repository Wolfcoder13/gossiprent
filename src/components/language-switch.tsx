"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { setLocale } from "@/app/actions/locale";
import { useLocale } from "@/i18n/client";
import { LANGUAGE_NAME, LOCALES, type Locale } from "@/i18n/config";
import { buttonStyles, cx } from "./ui";

/**
 * A one-button form that switches to `locale` and comes back to this page
 * (path and query). A plain form post to a Server Action, so it also works
 * without JavaScript.
 */
function SwitchForm({ locale, className, children }: { locale: Locale; className: string; children: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return (
    <form action={setLocale}>
      <input type="hidden" name="next" value={search ? `${pathname}?${search}` : pathname} />
      <button type="submit" name="locale" value={locale} lang={locale} className={className}>
        {children}
      </button>
    </form>
  );
}

/**
 * Switch to the other language, labelled in that language: "English" on the
 * Icelandic site, "Íslenska" on the English one. In the header, phones show
 * just "EN" / "IS" (the full name stays the button's accessible name).
 */
export function LanguageSwitch({ variant = "header" }: { variant?: "header" | "footer" }) {
  const current = useLocale();
  const other = LOCALES.find((locale) => locale !== current)!;
  if (variant === "footer") {
    return (
      <SwitchForm locale={other} className="cursor-pointer hover:text-ink">
        {LANGUAGE_NAME[other]}
      </SwitchForm>
    );
  }
  return (
    <SwitchForm locale={other} className={cx(buttonStyles.base, buttonStyles.ghost, "cursor-pointer px-2.5! sm:px-4!")}>
      <span aria-hidden className="sm:hidden">
        {other.toUpperCase()}
      </span>
      <span className="sr-only sm:not-sr-only">{LANGUAGE_NAME[other]}</span>
    </SwitchForm>
  );
}

/**
 * One line above the header for visitors who haven't picked a language and
 * whose browser doesn't prefer Icelandic. In English (it's for people who
 * can't read the Icelandic site yet), with a second button, in Icelandic, for
 * those who can: either choice sets the language cookie, so the line goes away.
 */
export function EnglishHint() {
  return (
    <div lang="en" className="border-b border-line bg-brand-soft text-brand-soft-ink">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-6">
        <p>This site is in Icelandic.</p>
        <SwitchForm
          locale="en"
          className="cursor-pointer font-semibold underline underline-offset-2 hover:no-underline"
        >
          Switch to English
        </SwitchForm>
        <SwitchForm locale="is" className="cursor-pointer underline underline-offset-2 hover:no-underline">
          Halda áfram á íslensku
        </SwitchForm>
      </div>
    </div>
  );
}
