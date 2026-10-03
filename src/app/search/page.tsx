import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CardGrid, PersonCard, PropertyCard } from "@/components/cards";
import { KennitalaLookup } from "@/components/kennitala-lookup";
import { redirectKennitalaQuery } from "@/components/kennitala-query";
import { SearchBox } from "@/components/search-box";
import { EmptyState, PageHeader } from "@/components/ui";
import { getFormat, getT } from "@/i18n/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listPeople, listProperties, parseQuery } from "@/lib/data";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("meta.pages.search"), robots: { index: false, follow: true } };
}

const RESULTS_PER_GROUP = 6;

/**
 * Search everything, with the kennitala lookup under the search box. A query
 * containing a kennitala is never searched or echoed: it lands on
 * /search?kt=1, which points to the lookup form instead.
 */
export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const search = await searchParams;
  redirectKennitalaQuery(search.q);
  const query = parseQuery(search.q);
  const fromKennitala = search.kt === "1";
  const [t, user] = await Promise.all([getT(), getCurrentUser()]);

  const lookup = (
    <div className="mt-6 max-w-xl space-y-3">
      {fromKennitala && (
        <p className="rounded-xl border border-line bg-surface-muted px-4 py-3 text-sm text-ink">
          {t("lookup.useFormBelow")}
        </p>
      )}
      <KennitalaLookup loggedIn={user !== null} />
    </div>
  );

  if (!query) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <PageHeader title={t("browse.results.title")} description={t("browse.results.description")} />
        <SearchForm query="" />
        {lookup}
      </div>
    );
  }

  const [landlords, renters, properties] = await Promise.all([
    listPeople({ role: "landlord", query, pageSize: RESULTS_PER_GROUP }),
    listPeople({ role: "renter", query, pageSize: RESULTS_PER_GROUP }),
    listProperties({ query, pageSize: RESULTS_PER_GROUP }),
  ]);
  const total = landlords.total + renters.total + properties.total;
  const q = new URLSearchParams({ q: query }).toString();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <PageHeader
        title={t("browse.results.heading", { query })}
        description={t("browse.results.count", { count: total })}
      />
      <SearchForm query={query} />
      {lookup}

      {total === 0 ? (
        <div className="mt-8">
          <EmptyState title={t("browse.results.noneTitle")}>
            {t.rich("browse.results.noneBody", {
              add: (
                <Link href="/properties/new" className="font-semibold text-brand hover:underline">
                  {t("browse.results.addIt")}
                </Link>
              ),
            })}
          </EmptyState>
        </div>
      ) : (
        <div className="mt-8 space-y-12">
          <ResultGroup
            title={t("browse.results.landlords")}
            total={landlords.total}
            moreHref={`/landlords?${q}`}
            moreLabel={t("browse.results.seeAll.landlords", { count: landlords.total })}
          >
            {landlords.items.map((p) => (
              <li key={p.id}>
                <PersonCard person={p} role="landlord" />
              </li>
            ))}
          </ResultGroup>
          <ResultGroup
            title={t("browse.results.properties")}
            total={properties.total}
            moreHref={`/properties?${q}`}
            moreLabel={t("browse.results.seeAll.properties", { count: properties.total })}
          >
            {properties.items.map((p) => (
              <li key={p.id}>
                <PropertyCard property={p} />
              </li>
            ))}
          </ResultGroup>
          <ResultGroup
            title={t("browse.results.renters")}
            total={renters.total}
            moreHref={`/renters?${q}`}
            moreLabel={t("browse.results.seeAll.renters", { count: renters.total })}
          >
            {renters.items.map((p) => (
              <li key={p.id}>
                <PersonCard person={p} role="renter" />
              </li>
            ))}
          </ResultGroup>
        </div>
      )}
    </div>
  );
}

async function SearchForm({ query }: { query: string }) {
  const t = await getT();
  return (
    <SearchBox
      action="/search"
      inputId="search-q"
      label={t("browse.results.label")}
      placeholder={t("browse.results.placeholder")}
      buttonLabel={t("browse.results.button")}
      defaultValue={query}
      variant="page"
    />
  );
}

async function ResultGroup({
  title,
  total,
  moreHref,
  moreLabel,
  children,
}: {
  title: string;
  total: number;
  moreHref: string;
  moreLabel: string;
  children: ReactNode;
}) {
  if (total === 0) return null;
  const format = await getFormat();
  return (
    <section aria-label={title}>
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 className="text-xl font-bold text-ink">
          {title} <span className="font-normal text-muted">({format.number(total)})</span>
        </h2>
        {total > RESULTS_PER_GROUP && (
          <Link href={moreHref} className="text-sm font-semibold text-brand hover:underline">
            {moreLabel}
          </Link>
        )}
      </div>
      <CardGrid>{children}</CardGrid>
    </section>
  );
}
