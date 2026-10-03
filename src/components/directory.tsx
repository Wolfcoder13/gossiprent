import type { ReactNode } from "react";
import { getT } from "@/i18n/server";
import type { PersonSort } from "@/lib/data";
import { SearchBox } from "./search-box";

// Message keys (translated per request).
const SORTS = [
  { value: "top", label: "browse.sort.top" },
  { value: "most", label: "browse.sort.most" },
  { value: "newest", label: "browse.sort.newest" },
  { value: "name", label: "browse.sort.name" },
] as const satisfies readonly { value: PersonSort; label: string }[];

/**
 * Search + sort controls for a directory. A plain GET form, so it works
 * without JavaScript; a kennitala typed into it is never sent (see SearchBox).
 * `placeholder` is already translated. An async Server Component.
 */
export async function DirectoryFilters({
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
  const t = await getT();
  return (
    <SearchBox
      action={basePath}
      inputId="directory-q"
      label={t("browse.filters.label")}
      placeholder={placeholder}
      buttonLabel={t("browse.filters.button")}
      defaultValue={query}
      variant="bar"
    >
      <label htmlFor="directory-sort" className="sr-only">
        {t("browse.filters.sortLabel")}
      </label>
      <select
        id="directory-sort"
        name="sort"
        defaultValue={sort}
        className="rounded-xl border border-line-input bg-surface px-3 py-2.5 text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-focus/40"
      >
        {SORTS.map((option) => (
          <option key={option.value} value={option.value}>
            {t(option.label)}
          </option>
        ))}
      </select>
    </SearchBox>
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
      <p className="text-sm wrap-anywhere text-muted">{summary}</p>
      {children}
    </div>
  );
}
