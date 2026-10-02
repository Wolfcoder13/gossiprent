import type { Metadata } from "next";
import { PersonDirectory } from "@/components/person-directory";
import { parsePage, parseQuery, parseSort } from "@/lib/data";

export const metadata: Metadata = { title: "Renters" };

export default async function RentersPage({ searchParams }: PageProps<"/renters">) {
  const { q, sort, page } = await searchParams;
  return (
    <PersonDirectory
      role="renter"
      query={parseQuery(q)}
      sort={parseSort(sort)}
      page={parsePage(page)}
    />
  );
}
