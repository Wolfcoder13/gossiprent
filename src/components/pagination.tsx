import Link from "next/link";
import { redirect } from "next/navigation";
import { pageHref } from "@/lib/paths";
import { buttonStyles, cx } from "./ui";

/**
 * Send a request for a page past the end (an old link, or the last review on
 * the last page was deleted) to the last page that exists.
 */
export function redirectIfPastLastPage(options: {
  page: number;
  pageCount: number;
  total: number;
  basePath: string;
  params?: Record<string, string | undefined>;
  hash?: string;
}): void {
  const { page, pageCount, total, basePath, params, hash } = options;
  if (total > 0 && page > pageCount) redirect(pageHref(basePath, pageCount, params, hash));
}

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

  const href = (target: number) => pageHref(basePath, target, params, hash);

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
        Page {page} of {pageCount}
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
