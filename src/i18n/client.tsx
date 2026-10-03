"use client";

import { createContext, use, useMemo, type ReactNode } from "react";
import type { Locale } from "./config";
import { createFormat, type Format } from "./format";
import type { Messages } from "./messages";
import { createT } from "./translate";
import type { Translator } from "./types";

type I18nValue = { locale: Locale; messages: Messages };

const I18nContext = createContext<I18nValue | null>(null);

/** Gives client components the visitor's language. Rendered once, in the root layout. */
export function I18nProvider({ locale, messages, children }: I18nValue & { children: ReactNode }) {
  const value = useMemo(() => ({ locale, messages }), [locale, messages]);
  return <I18nContext value={value}>{children}</I18nContext>;
}

function useI18n(): I18nValue {
  const value = use(I18nContext);
  if (!value) throw new Error("I18nProvider is missing");
  return value;
}

export function useLocale(): Locale {
  return useI18n().locale;
}

export function useT(): Translator<Messages> {
  const { locale, messages } = useI18n();
  return useMemo(() => createT(messages, locale), [messages, locale]);
}

export function useFormat(): Format {
  return createFormat(useI18n().locale);
}
