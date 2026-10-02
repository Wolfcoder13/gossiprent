import Link from "next/link";
import type { UserRole } from "@/db/schema";
import { listPeople, type PersonSort } from "@/lib/data";
import { plural } from "@/lib/format";
import { CardGrid, PersonCard } from "./cards";
import { DirectoryFilters, DirectoryLayout } from "./directory";
import { Pagination, redirectIfPastLastPage } from "./pagination";
import { ButtonLink, EmptyState, PageHeader } from "./ui";

const COPY: Record<UserRole, { title: string; description: string; noun: [string, string]; empty: string }> = {
  landlord: {
    title: "Landlords",
    description: "See how landlords are rated by the people who've rented from them.",
    noun: ["landlord", "landlords"],
    empty: "Landlords show up here once they create an account.",
  },
  renter: {
    title: "Renters",
    description: "See how renters are rated by the landlords they've rented from.",
    noun: ["renter", "renters"],
    empty: "Renters show up here once they create an account.",
  },
};

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
  const result = await listPeople({ role, query, sort, page });
  const basePath = `/${role}s`;
  const params = { q: query || undefined, sort: sort === "top" ? undefined : sort };
  redirectIfPastLastPage({ page, pageCount: result.pageCount, total: result.total, basePath, params });

  return (
    <DirectoryLayout
      header={<PageHeader title={copy.title} description={copy.description} />}
      filters={
        <DirectoryFilters
          basePath={basePath}
          query={query}
          sort={sort}
          placeholder={`Search ${copy.noun[1]} by name or city`}
        />
      }
      summary={
        query ? (
          <>
            {plural(result.total, copy.noun[0], copy.noun[1])} matching “{query}” ·{" "}
            <Link href={basePath} className="font-medium text-brand hover:underline">
              Clear search
            </Link>
          </>
        ) : (
          plural(result.total, copy.noun[0], copy.noun[1])
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
          <Pagination
            page={page}
            pageCount={result.pageCount}
            basePath={basePath}
            params={params}
          />
        </>
      ) : (
        <EmptyState
          title={query ? `No ${copy.noun[1]} match “${query}”` : `No ${copy.noun[1]} yet`}
          action={
            role === "landlord" ? (
              <ButtonLink href="/properties/new" variant="secondary">
                Review the place you rented instead
              </ButtonLink>
            ) : undefined
          }
        >
          {query ? "Try a different name or city." : copy.empty}
          {role === "landlord" &&
            " If your landlord isn't on GossipRent, you can still add and review the property you rented."}
        </EmptyState>
      )}
    </DirectoryLayout>
  );
}
