import type { Metadata } from "next";
import { redirectKennitalaQuery } from "@/components/kennitala-query";
import { PersonDirectory } from "@/components/person-directory";
import { getT } from "@/i18n/server";
import { parsePage, parseQuery, parseSort } from "@/lib/data";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  // Renters are private people: their directory and profiles aren't indexed (see also robots.ts).
  return { title: t("meta.pages.renters"), robots: { index: false, follow: false } };
}

export default async function RentersPage({ searchParams }: PageProps<"/renters">) {
  const { q, sort, page } = await searchParams;
  // A kennitala is never searched for or shown: send it to the lookup form.
  redirectKennitalaQuery(q);
  return <PersonDirectory role="renter" query={parseQuery(q)} sort={parseSort(sort)} page={parsePage(page)} />;
}
