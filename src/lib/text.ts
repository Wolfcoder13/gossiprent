/**
 * Text helpers for Icelandic names and addresses: normalizing input, folding
 * for accent-insensitive search, and sort keys in Icelandic alphabetical order.
 * Pure (no database access), so the same rules apply on write and on search,
 * and the demo-data seed can use them too.
 */

/** NFC, trimmed, with runs of whitespace collapsed to one space. */
export function normalizeText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
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

// "íbúð 0201", "íb. 0201", "apt 3", "unit 2B", "#4" → just the apartment.
const UNIT_PREFIX = /^(?:íbúð|íb\.|apt\.?|unit|#)(?=\s|\d|$)\s*/iu;

/** An apartment as typed, without a leading "íbúð"/"apt"/"#"; null when blank. */
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
