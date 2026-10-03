import { placeName } from "@/lib/postcodes";
import type { Messages } from "./messages";
import type { Translator } from "./types";

/** What a property's address is made of (as stored). */
export type AddressParts = { address: string; unit: string | null; postalCode: number };

// An apartment number: "0201" (floor 02, flat 01), "3", "2B" or a lone letter
// ("B"). It reads "íbúð 3" / "apt. 3": the property form drops the word typed
// in front of one ("íbúð 3", "apt.B", "#4"; normalizeUnit), and on its own
// "Hringbraut 79, 3" would read like a second house number.
const APARTMENT_NUMBER = /^(?:\d{1,4}\p{L}?|\p{L})$/u;

/**
 * Line 1 of an address: "Njálsgata 23, íbúð 0201" (or "Njálsgata 23, apt. 0201"),
 * "Hringbraut 79, íbúð 3", "Hringbraut 79", "Laugavegur 5, 2. hæð til vinstri".
 * Works with getT and useT.
 */
export function streetLine(t: Translator<Messages>, { address, unit }: Pick<AddressParts, "address" | "unit">): string {
  if (!unit) return address;
  return APARTMENT_NUMBER.test(unit)
    ? t("common.address.apartment", { address, unit })
    : t("common.address.unit", { address, unit });
}

/** Line 2 of an address: "101 Reykjavík". The same in every language. */
export function placeLine(postalCode: number): string {
  return `${postalCode} ${placeName(postalCode)}`;
}

/** The whole address on one line, e.g. for page titles: "Njálsgata 23, íbúð 0201, 101 Reykjavík". */
export function addressText(t: Translator<Messages>, parts: AddressParts): string {
  return `${streetLine(t, parts)}, ${placeLine(parts.postalCode)}`;
}
