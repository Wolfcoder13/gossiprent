import type { Metadata } from "next";
import { PersonDirectory } from "@/components/person-directory";
import { parsePage, parseQuery, parseSort } from "@/lib/data";

export const metadata: Metadata = { title: "Landlords" };

export default async function LandlordsPage({ searchParams }: PageProps<"/landlords">) {
  const { q, sort, page } = await searchParams;
  return (
    <PersonDirectory
      role="landlord"
      query={parseQuery(q)}
      sort={parseSort(sort)}
      page={parsePage(page)}
    />
  );
}
