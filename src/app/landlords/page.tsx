import type { Metadata } from "next";
import { redirectKennitalaQuery } from "@/components/kennitala-query";
import { PersonDirectory } from "@/components/person-directory";
import { getT } from "@/i18n/server";
import { parsePage, parseQuery, parseSort } from "@/lib/data";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("meta.pages.landlords") };
}

export default async function LandlordsPage({ searchParams }: PageProps<"/landlords">) {
  const { q, sort, page } = await searchParams;
  // A kennitala is never searched for or shown: send it to the lookup form.
  redirectKennitalaQuery(q);
  return <PersonDirectory role="landlord" query={parseQuery(q)} sort={parseSort(sort)} page={parsePage(page)} />;
}
