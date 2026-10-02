import type { ReactNode } from "react";
import type { PersonSort } from "@/lib/data";
import { buttonStyles, cx } from "./ui";

const SORTS: { value: PersonSort; label: string }[] = [
  { value: "top", label: "Top rated" },
  { value: "most", label: "Most reviewed" },
  { value: "newest", label: "Newest" },
  { value: "name", label: "A–Z" },
];

/** Search + sort controls for a directory. A plain GET form, so it works without JavaScript. */
export function DirectoryFilters({
  basePath,
  query,
  sort,
  placeholder,
}: {
  basePath: string;
  query: string;
  sort: PersonSort;
  placeholder: string;
}) {
  return (
    <form
      action={basePath}
      role="search"
      className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3 shadow-sm sm:flex-row sm:items-center"
    >
      <label htmlFor="directory-q" className="sr-only">
        Search
      </label>
      <input
        id="directory-q"
        name="q"
        type="search"
        defaultValue={query}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-focus/40"
      />
      <label htmlFor="directory-sort" className="sr-only">
        Sort by
      </label>
      <select
        id="directory-sort"
        name="sort"
        defaultValue={sort}
        className="rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-focus/40"
      >
        {SORTS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button type="submit" className={cx(buttonStyles.base, buttonStyles.primary, "py-2.5")}>
        Search
      </button>
    </form>
  );
}

export function DirectoryLayout({
  header,
  filters,
  summary,
  children,
}: {
  header: ReactNode;
  filters: ReactNode;
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-10 sm:px-6">
      {header}
      {filters}
      <p className="text-sm text-muted">{summary}</p>
      {children}
    </div>
  );
}
