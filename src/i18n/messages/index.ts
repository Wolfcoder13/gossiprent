import "server-only";
import type { Locale } from "../config";
import en from "./en";
import is from "./is";

/** The dictionary type. Keys and placeholders come from the Icelandic (default) dictionary. */
export type Messages = typeof is;

/** English has the same keys (checked at compile time) but its own text. */
export const MESSAGES: Record<Locale, Messages> = { is, en: en as unknown as Messages };
