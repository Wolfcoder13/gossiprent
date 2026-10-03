import type { Metadata } from "next";
import Link from "next/link";
import { CardGrid, PropertyCard } from "@/components/cards";
import { DirectoryFilters, DirectoryLayout } from "@/components/directory";
import { redirectKennitalaQuery } from "@/components/kennitala-query";
import { Pagination, redirectIfPastLastPage } from "@/components/pagination";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { getT } from "@/i18n/server";
import { listProperties, parsePage, parseQuery, parseSort } from "@/lib/data";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("meta.pages.properties") };
}

export default async function PropertiesPage({ searchParams }: PageProps<"/properties">) {
  const search = await searchParams;
  // A kennitala is never searched for (or echoed): send it to the lookup form.
  redirectKennitalaQuery(search.q);

  const query = parseQuery(search.q);
  const sort = parseSort(search.sort);
  const page = parsePage(search.page);
  const [result, t] = await Promise.all([listProperties({ query, sort, page }), getT()]);
  const params = { q: query || undefined, sort: sort === "top" ? undefined : sort };
  redirectIfPastLastPage({
    page,
    pageCount: result.pageCount,
    total: result.total,
    basePath: "/properties",
    params,
  });

  return (
    <DirectoryLayout
      header={
        <PageHeader
          title={t("properties.list.title")}
          description={t("properties.list.description")}
          actions={<ButtonLink href="/properties/new">{t("properties.list.add")}</ButtonLink>}
        />
      }
      filters={
        <DirectoryFilters
          basePath="/properties"
          query={query}
          sort={sort}
          placeholder={t("properties.list.searchPlaceholder")}
        />
      }
      summary={
        query ? (
          <>
            {t("properties.list.matching", { count: result.total, query })} ·{" "}
            <Link href="/properties" className="font-medium text-brand hover:underline">
              {t("properties.list.clearSearch")}
            </Link>
          </>
        ) : (
          t("properties.list.count", { count: result.total })
        )
      }
    >
      {result.items.length > 0 ? (
        <>
          <CardGrid>
            {result.items.map((property) => (
              <li key={property.id}>
                <PropertyCard property={property} />
              </li>
            ))}
          </CardGrid>
          <Pagination page={page} pageCount={result.pageCount} basePath="/properties" params={params} />
        </>
      ) : (
        <EmptyState
          title={query ? t("properties.list.noMatchTitle", { query }) : t("properties.list.emptyTitle")}
          action={<ButtonLink href="/properties/new">{t("properties.list.addRented")}</ButtonLink>}
        >
          {query ? t("properties.list.noMatchBody") : t("properties.list.emptyBody")}
        </EmptyState>
      )}
    </DirectoryLayout>
  );
}
