import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { prefersIcelandic } from "./accept-language";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "./config";
import { createFormat, type Format } from "./format";
import { MESSAGES, type Messages } from "./messages";
import { createT } from "./translate";
import type { Translator } from "./types";

export type T = Translator<Messages>;

/** The visitor's language: the `lang` cookie, else Icelandic. Cached per request. */
export const getLocale = cache(async (): Promise<Locale> => {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
});

/** The translate function for this request (Server Components, Server Actions, generateMetadata). */
export const getT = cache(async (): Promise<T> => {
  const locale = await getLocale();
  return createT(MESSAGES[locale], locale);
});

export async function getFormat(): Promise<Format> {
  return createFormat(await getLocale());
}

/** The active dictionary, for the client-side I18nProvider in the root layout. */
export async function getMessages(): Promise<Messages> {
  return MESSAGES[await getLocale()];
}

/**
 * Offer English above the header? Only to visitors who haven't picked a
 * language and whose browser doesn't put Icelandic first.
 */
export async function shouldOfferEnglish(): Promise<boolean> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  if (isLocale(cookieStore.get(LOCALE_COOKIE)?.value)) return false;
  return !prefersIcelandic(headerList.get("accept-language"));
}
