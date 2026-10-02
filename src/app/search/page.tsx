import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CardGrid, PersonCard, PropertyCard } from "@/components/cards";
import { EmptyState, PageHeader } from "@/components/ui";
import { listPeople, listProperties, parseQuery } from "@/lib/data";
import { plural } from "@/lib/format";

export const metadata: Metadata = { title: "Search" };

const RESULTS_PER_GROUP = 6;

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const query = parseQuery((await searchParams).q);

  if (!query) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <PageHeader title="Search" description="Find landlords, renters, and properties by name, city, or address." />
        <SearchForm query="" />
      </div>
    );
  }

  const [landlords, renters, properties] = await Promise.all([
    listPeople({ role: "landlord", query, pageSize: RESULTS_PER_GROUP }),
    listPeople({ role: "renter", query, pageSize: RESULTS_PER_GROUP }),
    listProperties({ query, pageSize: RESULTS_PER_GROUP }),
  ]);
  const total = landlords.total + renters.total + properties.total;
  const q = encodeURIComponent(query);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <PageHeader title={<>Results for “{query}”</>} description={plural(total, "match", "matches")} />
      <SearchForm query={query} />

      {total === 0 ? (
        <div className="mt-8">
          <EmptyState title="Nothing matched your search">
            Try a shorter name, just the city, or the street name. Can&apos;t find the place you rent?{" "}
            <Link href="/properties/new" className="font-semibold text-brand hover:underline">
              Add it
            </Link>
            .
          </EmptyState>
        </div>
      ) : (
        <div className="mt-8 space-y-12">
          <ResultGroup title="Landlords" total={landlords.total} moreHref={`/landlords?q=${q}`}>
            {landlords.items.map((p) => (
              <li key={p.id}>
                <PersonCard person={p} />
              </li>
            ))}
          </ResultGroup>
          <ResultGroup title="Properties" total={properties.total} moreHref={`/properties?q=${q}`}>
            {properties.items.map((p) => (
              <li key={p.id}>
                <PropertyCard property={p} />
              </li>
            ))}
          </ResultGroup>
          <ResultGroup title="Renters" total={renters.total} moreHref={`/renters?q=${q}`}>
            {renters.items.map((p) => (
              <li key={p.id}>
                <PersonCard person={p} />
              </li>
            ))}
          </ResultGroup>
        </div>
      )}
    </div>
  );
}

function SearchForm({ query }: { query: string }) {
  return (
    <form action="/search" role="search" className="mt-6 flex max-w-xl gap-2">
      <label htmlFor="search-q" className="sr-only">
        Search
      </label>
      <input
        id="search-q"
        name="q"
        type="search"
        defaultValue={query}
        placeholder="Search a name, city, or address"
        className="min-w-0 flex-1 rounded-full border border-line-input bg-surface px-5 py-2.5 text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-focus/40"
      />
      <button type="submit" className="rounded-full bg-brand px-5 py-2.5 font-semibold text-brand-ink hover:bg-brand-hover">
        Search
      </button>
    </form>
  );
}

function ResultGroup({
  title,
  total,
  moreHref,
  children,
}: {
  title: string;
  total: number;
  moreHref: string;
  children: ReactNode;
}) {
  if (total === 0) return null;
  return (
    <section aria-label={title}>
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 className="text-xl font-bold text-ink">
          {title} <span className="font-normal text-muted">({total})</span>
        </h2>
        {total > RESULTS_PER_GROUP && (
          <Link href={moreHref} className="text-sm font-semibold text-brand hover:underline">
            See all {total} →
          </Link>
        )}
      </div>
      <CardGrid>{children}</CardGrid>
    </section>
  );
}
