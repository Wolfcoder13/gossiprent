import type { Metadata } from "next";
import Link from "next/link";
import { CardGrid, PropertyCard } from "@/components/cards";
import { DirectoryFilters, DirectoryLayout } from "@/components/directory";
import { Pagination } from "@/components/pagination";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { listProperties, parsePage, parseQuery, parseSort } from "@/lib/data";
import { plural } from "@/lib/format";

export const metadata: Metadata = { title: "Properties" };

export default async function PropertiesPage({ searchParams }: PageProps<"/properties">) {
  const params = await searchParams;
  const query = parseQuery(params.q);
  const sort = parseSort(params.sort);
  const page = parsePage(params.page);
  const result = await listProperties({ query, sort, page });

  return (
    <DirectoryLayout
      header={
        <PageHeader
          title="Properties"
          description="Homes and apartments, reviewed by the renters who've lived there."
          actions={<ButtonLink href="/properties/new">Add a property</ButtonLink>}
        />
      }
      filters={
        <DirectoryFilters
          basePath="/properties"
          query={query}
          sort={sort}
          placeholder="Search by address, city, ZIP, or landlord"
        />
      }
      summary={
        query ? (
          <>
            {plural(result.total, "property", "properties")} matching “{query}” ·{" "}
            <Link href="/properties" className="font-medium text-brand hover:underline">
              Clear search
            </Link>
          </>
        ) : (
          plural(result.total, "property", "properties")
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
          <Pagination
            page={page}
            pageCount={result.pageCount}
            basePath="/properties"
            params={{ q: query || undefined, sort: sort === "top" ? undefined : sort }}
          />
        </>
      ) : (
        <EmptyState
          title={query ? `No properties match “${query}”` : "No properties yet"}
          action={<ButtonLink href="/properties/new">Add the place you rent</ButtonLink>}
        >
          {query
            ? "Try just the street name or the city — or add it if it's not listed yet."
            : "Add the place you rent so you (and others) can review it."}
        </EmptyState>
      )}
    </DirectoryLayout>
  );
}
