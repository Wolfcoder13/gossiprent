import Link from "next/link";
import type { UserRole } from "@/db/schema";
import { getT } from "@/i18n/server";
import { listPeople, type PersonSort } from "@/lib/data";
import { CardGrid, PersonCard } from "./cards";
import { DirectoryFilters, DirectoryLayout } from "./directory";
import { Pagination, redirectIfPastLastPage } from "./pagination";
import { ButtonLink, EmptyState, PageHeader } from "./ui";

// Message keys per role (one whole sentence per role; see the writing rules).
const COPY = {
  landlord: {
    title: "browse.landlords.title",
    description: "browse.landlords.description",
    placeholder: "browse.landlords.placeholder",
    count: "browse.landlords.count",
    countMatching: "browse.landlords.countMatching",
    noneMatching: "browse.landlords.noneMatching",
    none: "browse.landlords.none",
    empty: "browse.landlords.empty",
    notListed: "browse.landlords.notListed",
  },
  renter: {
    title: "browse.renters.title",
    description: "browse.renters.description",
    placeholder: "browse.renters.placeholder",
    count: "browse.renters.count",
    countMatching: "browse.renters.countMatching",
    noneMatching: "browse.renters.noneMatching",
    none: "browse.renters.none",
    empty: "browse.renters.empty",
    notListed: "browse.renters.notListed",
  },
} as const;

/**
 * /landlords or /renters: everyone in that role, with or without an account.
 * `query` must already be free of kennitalas (the page redirects those).
 */
export async function PersonDirectory({
  role,
  query,
  sort,
  page,
}: {
  role: UserRole;
  query: string;
  sort: PersonSort;
  page: number;
}) {
  const copy = COPY[role];
  const [t, result] = await Promise.all([getT(), listPeople({ role, query, sort, page })]);
  const basePath = `/${role}s`;
  const params = { q: query || undefined, sort: sort === "top" ? undefined : sort };
  redirectIfPastLastPage({ page, pageCount: result.pageCount, total: result.total, basePath, params });

  return (
    <DirectoryLayout
      header={<PageHeader title={t(copy.title)} description={t(copy.description)} />}
      filters={<DirectoryFilters basePath={basePath} query={query} sort={sort} placeholder={t(copy.placeholder)} />}
      summary={
        query ? (
          <>
            {t(copy.countMatching, { count: result.total, query })} ·{" "}
            <Link href={basePath} className="font-medium text-brand hover:underline">
              {t("browse.filters.clear")}
            </Link>
          </>
        ) : (
          t(copy.count, { count: result.total })
        )
      }
    >
      {result.items.length > 0 ? (
        <>
          <CardGrid>
            {result.items.map((person) => (
              <li key={person.id}>
                <PersonCard person={person} role={role} />
              </li>
            ))}
          </CardGrid>
          <Pagination page={page} pageCount={result.pageCount} basePath={basePath} params={params} />
        </>
      ) : (
        <EmptyState
          title={query ? t(copy.noneMatching, { query }) : t(copy.none)}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href={`/reviews/new?kind=${role}`}>{t("browse.writeReview")}</ButtonLink>
              {role === "landlord" && (
                <ButtonLink href="/properties/new" variant="secondary">
                  {t("browse.reviewPropertyInstead")}
                </ButtonLink>
              )}
            </div>
          }
        >
          {query ? t("browse.tryAgain") : t(copy.empty)} {t(copy.notListed)}
        </EmptyState>
      )}
    </DirectoryLayout>
  );
}
