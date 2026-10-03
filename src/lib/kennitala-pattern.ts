/**
 * What a kennitala looks like in text: six digits, then any spaces and
 * hyphens or dashes of any kind, then four digits: "150385-3579",
 * "150385 3579", "150385  3579", "150385 - 3579", "150385–3579",
 * "1503853579". Every way of writing one that the parser (parseKennitalaInput)
 * accepts with the number split 6 + 4, and a few more.
 *
 * The one pattern behind every kennitala check: free text (containsKennitala),
 * search boxes (kennitala-query.ts) and the search backstop (parseQuery).
 * Dependency-free, so client components can use it.
 */

// Whitespace, hyphen-minus, the Unicode hyphens and dashes (‐ ‑ ‒ – — ―), the
// minus sign, and the small and fullwidth hyphen-minus. One character class,
// so a run of them can only be matched one way (no slow backtracking).
const SEPARATORS = String.raw`[\s\-\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]*`;

/** Regex source (no anchors or flags) for one kennitala-like sequence. */
export const KENNITALA_LIKE_SOURCE = String.raw`\d{6}${SEPARATORS}\d{4}`;

const ANYWHERE = new RegExp(KENNITALA_LIKE_SOURCE);
const WHOLE = new RegExp(String.raw`^\s*${KENNITALA_LIKE_SOURCE}\s*$`);

// Characters that show nothing (soft hyphen, zero-width space and joiners,
// bidi controls, word joiner, BOM…), combining marks (variation selectors) and
// control characters other than whitespace. "150385\u00AD3579" (a soft
// hyphen) looks just like "1503853579" on screen.
const INVISIBLE = /[\p{Cf}\p{Mn}\p{Me}\u0000-\u0008\u000e-\u001f\u007f-\u009f]/gu;

/**
 * Text as it reads on screen, for kennitala checks only (never stored or
 * shown): compatibility forms folded ("１５０３８５" → "150385") and invisible
 * characters dropped, so neither can hide a kennitala.
 */
export function kennitalaSearchText(text: string): string {
  return text.normalize("NFKC").replace(INVISIBLE, "");
}

/** True if a kennitala-like sequence appears anywhere in the text ("Jón 150385 - 3579"). */
export function hasKennitalaShape(text: string): boolean {
  return ANYWHERE.test(kennitalaSearchText(text));
}

/** True if the whole text (ignoring surrounding spaces) is one kennitala-like sequence. */
export function isKennitalaShaped(text: string): boolean {
  return WHOLE.test(kennitalaSearchText(text));
}
