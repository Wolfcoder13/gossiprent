export const LOCALES = ["is", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Iceland-only site: Icelandic unless the visitor picked English. */
export const DEFAULT_LOCALE: Locale = "is";

/** httpOnly cookie holding the visitor's chosen language. */
export const LOCALE_COOKIE = "lang";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** BCP 47 tags for Intl formatting. */
export const INTL_TAG: Record<Locale, string> = { is: "is-IS", en: "en-GB" };

/** Iceland is UTC+0 all year. */
export const TIME_ZONE = "Atlantic/Reykjavik";

/** Each language's name in that language (used by the language switch). */
export const LANGUAGE_NAME: Record<Locale, string> = { is: "Íslenska", en: "English" };
