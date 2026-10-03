import { formatKennitala as formatKt, getKennitalaBirthDate, parseKennitala } from "is-kennitala";
import { KENNITALA_LIKE_SOURCE, kennitalaSearchText } from "./kennitala-pattern";

/**
 * Kennitala (Icelandic ID number) parsing. Pure: no database access.
 *
 * is-kennitala checks the format and the date but (since Þjóðskrá stopped
 * using it) no check digit, so a typo usually still parses. Forms therefore
 * show the person's name or the date before anything is saved.
 */
export type ParsedKennitala = {
  /** 10 digits, no separator. */
  value: string;
  type: "person" | "company";
  /** A temporary "kerfiskennitala" (no birth date). */
  temporary: boolean;
  /** Birth date (person) or registration date (company); null for temporary numbers. */
  birthDate: Date | null;
};

const MAX_AGE_YEARS = 110;
const ADULT_AGE_YEARS = 18;

/**
 * Accept the "Gervimaður" test numbers (010130-xxx9) used by the demo data?
 * Yes in development and tests, no in production unless ALLOW_TEST_KENNITALA=true.
 */
export function allowTestKennitalas(): boolean {
  const flag = process.env.ALLOW_TEST_KENNITALA;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}

function yearsBefore(now: Date, years: number): Date {
  const date = new Date(now);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date;
}

// Hyphens and dashes the parser doesn't know (iOS turns "--" into "—"); it
// takes "-" and "–" only.
const OTHER_DASHES = /[\u2010-\u2012\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;

/**
 * Parse what someone typed ("010190-2939", "0101902939", "kt. 010190 2939",
 * "010190 — 2939"). Returns null for anything that can't be a real kennitala,
 * including people born in the future or more than 110 years ago.
 */
export function parseKennitalaInput(raw: string, now = new Date()): ParsedKennitala | null {
  if (typeof raw !== "string" || raw.length > 40) return null;
  const parsed = parseKennitala(raw.normalize("NFKC").replace(OTHER_DASHES, "-"), {
    clean: "aggressive",
    strictDate: true,
    robot: allowTestKennitalas(),
  });
  if (!parsed) return null;
  const temporary = parsed.type === "person" && parsed.temporary === true;
  const birthDate = temporary ? null : (getKennitalaBirthDate(parsed.value) ?? null);
  if (birthDate) {
    if (birthDate.getTime() > now.getTime()) return null;
    if (parsed.type === "person" && birthDate < yearsBefore(now, MAX_AGE_YEARS)) return null;
  }
  return { value: parsed.value, type: parsed.type, temporary, birthDate };
}

/** Persons with a known birth date must be 18 or older. Companies and temporary numbers pass. */
export function isAdultKennitala(kennitala: ParsedKennitala, now = new Date()): boolean {
  if (kennitala.type !== "person" || !kennitala.birthDate) return true;
  return kennitala.birthDate <= yearsBefore(now, ADULT_AGE_YEARS);
}

/** "0101302989" → "010130-2989". Only ever shown to the person who typed it, or its owner. */
export function formatKennitala(value: string): string {
  return formatKt(value);
}

// A kennitala-like sequence that isn't part of a longer run of digits.
const KENNITALA_IN_TEXT = new RegExp(String.raw`(?<!\d)${KENNITALA_LIKE_SOURCE}(?!\d)`, "g");

/**
 * True if free text contains something that parses as a kennitala (reviews,
 * bios, names…), however it's spaced or dashed ("150385 – 3579") and even
 * with invisible characters in it (see kennitala-pattern.ts).
 */
export function containsKennitala(text: string): boolean {
  for (const match of kennitalaSearchText(text).matchAll(KENNITALA_IN_TEXT)) {
    // Just the digits: the match may span spaces and dashes the parser would
    // reject between the two parts (a line break, several dashes…).
    if (parseKennitalaInput(match[0].replace(/\D/g, ""))) return true;
  }
  return false;
}
