/**
 * Whether a browser's Accept-Language header puts Icelandic first, e.g.
 * "is-IS,is;q=0.9,en;q=0.8" → true, "en-GB,en;q=0.9,is;q=0.8" → false.
 * Ranges are ranked by their q value (default 1); ties keep header order.
 */
export function prefersIcelandic(acceptLanguage: string | null | undefined): boolean {
  let best: { range: string; q: number } | undefined;
  for (const entry of (acceptLanguage ?? "").split(",")) {
    const [range = "", ...params] = entry.split(";").map((part) => part.trim());
    const qParam = params.find((param) => param.startsWith("q="));
    const q = qParam === undefined ? 1 : Number(qParam.slice(2));
    if (!range || !(q > 0)) continue;
    if (!best || q > best.q) best = { range: range.toLowerCase(), q };
  }
  return best !== undefined && (best.range === "is" || best.range.startsWith("is-"));
}
