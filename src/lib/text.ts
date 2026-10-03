/**
 * Text helpers for Icelandic names and addresses: normalizing input, folding
 * for accent-insensitive search, and sort keys in Icelandic alphabetical order.
 * Pure (no database access), so the same rules apply on write and on search,
 * and the demo-data seed can use them too.
 */

// Line breaks, however they were sent: browsers send a textarea's as CRLF.
const LINE_BREAK = /\r\n?|[\u0085\u2028\u2029]/g;
// C0 and C1 control characters (ESC, backspace…) and DEL, except tab and "\n"
// (run after LINE_BREAK, so no "\r" is left): never meaningful in what people
// type here, and an escape sequence could take over the operator's terminal
// when a report is printed. So they're never stored.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/** NFC, trimmed, with runs of whitespace (line breaks too) collapsed to one space and no control characters. */
export function normalizeText(value: string): string {
  return value.normalize("NFC").replace(LINE_BREAK, " ").replace(CONTROL, "").replace(/\s+/g, " ").trim();
}

/**
 * Multi-line text (reviews, bios, descriptions, report details): NFC, trimmed,
 * every line break as "\n", tabs kept, and no other control characters.
 */
export function normalizeMultilineText(value: string): string {
  return value.normalize("NFC").replace(LINE_BREAK, "\n").replace(CONTROL, "").trim();
}

/**
 * Accented letter → plain letters, for search. Exported so SQL can fold a
 * column that has no precomputed search key (a person's city) the same way.
 */
export const SEARCH_FOLDS: Readonly<Record<string, string>> = {
  á: "a",
  à: "a",
  ä: "a",
  å: "a",
  é: "e",
  è: "e",
  ë: "e",
  í: "i",
  ï: "i",
  ó: "o",
  ò: "o",
  ö: "o",
  ø: "o",
  ú: "u",
  ù: "u",
  ü: "u",
  ý: "y",
  ð: "d",
  þ: "th",
  æ: "ae",
};

/**
 * Lower-case and strip Icelandic accents so "Kopavogur" finds "Kópavogur" and
 * "Thordis" finds "Þórdís". Applied to stored search columns and to queries.
 */
export function foldForSearch(value: string): string {
  return normalizeText(value)
    .toLocaleLowerCase("is")
    .replace(/[áàäåéèëíïóòöøúùüýðþæ]/g, (char) => SEARCH_FOLDS[char] ?? char);
}

// The Icelandic alphabet (plus c, q, w, z, which appear in loanwords and names).
const ALPHABET = "aábcdðeéfghiíjklmnoópqrstuúvwxyýzþæö";
const RANK = new Map([...ALPHABET].map((char, i) => [char, i]));
// Foreign letters that don't simply lose an accent: sort them with their Icelandic look-alikes.
const SORT_AS: Record<string, string> = { ø: "ö", ä: "æ", ł: "l", đ: "d", ß: "ss" };
// Shortest width numbers are padded to, so "Hringbraut 9" sorts before "Hringbraut 79".
const NUMBER_WIDTH = 10;

function letterKey(char: string): string | undefined {
  const rank = RANK.get(char);
  return rank === undefined ? undefined : String.fromCharCode(0x41 + Math.floor(rank / 26), 0x41 + (rank % 26));
}

/**
 * A key that sorts in Icelandic order (A–Ö) under any database collation:
 * each letter becomes two capital letters from its alphabet rank, so "Ásta"
 * sorts after "Anna" and before "Bjarni", and "Þórdís" after "Zoe". Numbers sort
 * by value. The key uses only 0–9 and A–Z: collations such as en_US ignore
 * spaces and punctuation, which would otherwise scramble the order.
 */
export function icelandicSortKey(value: string): string {
  let key = "";
  const text = normalizeText(value).toLocaleLowerCase("is");
  for (const [token] of text.matchAll(/\d+|./gu)) {
    if (/^\d/.test(token)) {
      // After a word break ("00") and before any letter ("A…").
      key += `1${token.padStart(NUMBER_WIDTH, "0")}`;
      continue;
    }
    if (token === " " || token === "-" || token === "–") {
      key += "00";
      continue;
    }
    if (/^[.,'’]$/.test(token)) continue;
    const letter = letterKey(token);
    if (letter) {
      key += letter;
      continue;
    }
    const plain = SORT_AS[token] ?? token.normalize("NFD").replace(/\p{M}/gu, "");
    const letters = [...plain].map(letterKey);
    if (plain && letters.every(Boolean)) key += letters.join("");
    // Anything else after every letter, by code point.
    else key += `Z${token.codePointAt(0)!.toString(16).toUpperCase().padStart(6, "0")}`;
  }
  return key;
}

/**
 * Words an apartment may start with ("íbúð 0201", "íb. 3", "apt. 2B",
 * "unit 5"), lower-case. normalizeUnit drops them (and "#"), with or without
 * the period, and the site puts "íbúð"/"apt." back in front of a short
 * apartment number (streetLine).
 */
export const UNIT_PREFIX_WORDS = ["íbúð", "íb.", "apt.", "unit"] as const;

// One of the words as a whole word ("Unitas" and "íbúðin 2" keep theirs), or
// "#", then any separators: "íbúð-0201", "íb.3", "apt.B", "unit: 5", "# 4".
const UNIT_PREFIX = new RegExp(
  String.raw`^(?:#|(?:${UNIT_PREFIX_WORDS.map((word) => word.replace(/\.$/, "")).join("|")})(?!\p{L}))[\s:.,\-\u2010-\u2015]*`,
  "iu",
);

/**
 * An apartment as typed, without a leading "íbúð"/"íb."/"apt."/"unit"/"#" and
 * whatever separates it from the rest; null when blank. The one rule for the
 * stored unit and its search key (the property form and propertyAddressKeys
 * both use it), so "íbúð-0201", "íbúð 0201" and "0201" are the same apartment.
 */
export function normalizeUnit(unit: string | null | undefined): string | null {
  return normalizeText(unit ?? "").replace(UNIT_PREFIX, "").trim() || null;
}

/** The users columns derived from a name. Every writer of `users.name` stores all three. */
export function personNameKeys(name: string): { name: string; nameSort: string; nameSearch: string } {
  const normalized = normalizeText(name);
  return { name: normalized, nameSort: icelandicSortKey(normalized), nameSearch: foldForSearch(normalized) };
}

/**
 * The properties columns derived from an address and apartment. Every writer of
 * `properties.address`/`unit` stores all four; (addressSearch, postalCode) is unique.
 */
export function propertyAddressKeys(
  address: string,
  unit: string | null | undefined,
): { address: string; unit: string | null; addressSort: string; addressSearch: string } {
  const normalizedAddress = normalizeText(address);
  const normalizedUnit = normalizeUnit(unit);
  const full = normalizedUnit ? `${normalizedAddress} ${normalizedUnit}` : normalizedAddress;
  return {
    address: normalizedAddress,
    unit: normalizedUnit,
    addressSort: icelandicSortKey(full),
    addressSearch: foldForSearch(full),
  };
}
