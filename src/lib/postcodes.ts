import { postalCodes } from "postnumer";
import { foldForSearch } from "./text";

export type Postcode = { code: number; place: string };

/** Icelandic postcodes where people live (PO-box-only codes left out), in numeric order. */
export const HOME_POSTCODES: readonly Postcode[] = postalCodes
  .filter((p) => !("postholf" in p && (p as { postholf?: boolean }).postholf))
  .map((p) => ({ code: p.postnumer, place: p.name }))
  .sort((a, b) => a.code - b.code);

const PLACE_BY_CODE = new Map(HOME_POSTCODES.map((p) => [p.code, p.place]));

export function isHomePostcode(code: number): boolean {
  return PLACE_BY_CODE.has(code);
}

/** "Reykjavík" for 101. Falls back to the number if the code is unknown. */
export function placeName(code: number): string {
  return PLACE_BY_CODE.get(code) ?? String(code);
}

const FOLDED = HOME_POSTCODES.map((p) => ({ code: p.code, folded: foldForSearch(p.place) }));

/**
 * Postcodes a search word refers to: an exact code ("101") or a place name,
 * accent- and case-insensitively ("kopavogur" → 200, 201, 203).
 */
export function postcodesMatching(word: string): number[] {
  const trimmed = word.trim();
  if (/^\d{3}$/.test(trimmed)) {
    const code = Number(trimmed);
    return PLACE_BY_CODE.has(code) ? [code] : [];
  }
  const folded = foldForSearch(trimmed);
  if (folded.length < 3) return [];
  return FOLDED.filter((p) => p.folded.includes(folded)).map((p) => p.code);
}
