import { INTL_TAG, TIME_ZONE, type Locale } from "./config";

export type Format = {
  /** 12.345 (is) / 12,345 (en) */
  number(value: number): string;
  /** An average rating: "4,3" / "4.3", "5", or "—" when there's none. */
  rating(value: number | null): string;
  /** "3. okt. 2026" / "3 Oct 2026" */
  date(value: Date): string;
  /** "október 2026" / "October 2026" */
  monthYear(value: Date): string;
  /** "a, b og c" / "a, b and c" */
  list(items: string[]): string;
};

const cache = new Map<Locale, Format>();

const NUMBER_FALLBACK: Record<Locale, string> = { is: "de-DE", en: "en-GB" };

/** Locale-aware formatters (memoized per locale). Dates use Iceland's time zone. */
export function createFormat(locale: Locale): Format {
  const cached = cache.get(locale);
  if (cached) return cached;
  const tag = INTL_TAG[locale];
  // Numbers are also formatted in client components, and not every browser
  // ships Icelandic locale data (it would fall back to "4.3" and break
  // hydration). German uses the same separators as Icelandic ("12.345",
  // "4,3"), so use it where Icelandic is missing. Dates are formatted on the
  // server only, since month names can't be borrowed that way.
  const numberTag = Intl.NumberFormat.supportedLocalesOf(tag).length > 0 ? tag : NUMBER_FALLBACK[locale];
  const number = new Intl.NumberFormat(numberTag);
  const rating = new Intl.NumberFormat(numberTag, { maximumFractionDigits: 1 });
  const date = new Intl.DateTimeFormat(tag, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: TIME_ZONE,
  });
  const monthYear = new Intl.DateTimeFormat(tag, { month: "long", year: "numeric", timeZone: TIME_ZONE });
  const list = new Intl.ListFormat(tag, { type: "conjunction" });
  const format: Format = {
    number: (value) => number.format(value),
    rating: (value) => (value === null ? "—" : rating.format(value)),
    date: (value) => date.format(value),
    monthYear: (value) => monthYear.format(value),
    list: (items) => list.format(items),
  };
  cache.set(locale, format);
  return format;
}
