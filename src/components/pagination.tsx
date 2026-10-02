import Link from "next/link";
import { buttonStyles, cx } from "./ui";

/** Previous / next links that keep the other search params (q, sort…). */
export function Pagination({
  page,
  pageCount,
  basePath,
  params = {},
  hash,
}: {
  page: number;
  pageCount: number;
  basePath: string;
  params?: Record<string, string | undefined>;
  hash?: string;
}) {
  if (pageCount <= 1) return null;

  const href = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value);
    }
    if (target > 1) search.set("page", String(target));
    const qs = search.toString();
    return `${basePath}${qs ? `?${qs}` : ""}${hash ? `#${hash}` : ""}`;
  };

  const linkClass = cx(buttonStyles.base, buttonStyles.secondary);
  const disabledClass = cx(linkClass, "pointer-events-none opacity-40");

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 pt-2">
      {page > 1 ? (
        <Link href={href(page - 1)} className={linkClass} rel="prev">
          ← Previous
        </Link>
      ) : (
        <span className={disabledClass} aria-hidden>
          ← Previous
        </span>
      )}
      <span className="text-sm text-muted">
        Page {Math.min(page, pageCount)} of {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={href(page + 1)} className={linkClass} rel="next">
          Next →
        </Link>
      ) : (
        <span className={disabledClass} aria-hidden>
          Next →
        </span>
      )}
    </nav>
  );
}
