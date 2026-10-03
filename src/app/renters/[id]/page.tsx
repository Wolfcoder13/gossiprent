import type { Metadata } from "next";
import { PersonProfile } from "@/components/person-profile";
import { getT } from "@/i18n/server";
import { getPublicUser, parsePage } from "@/lib/data";
import { hasRole } from "@/lib/roles";

// Renters are private people: their pages are never indexed.
const NOINDEX = { index: false, follow: false } as const;

export async function generateMetadata({ params }: PageProps<"/renters/[id]">): Promise<Metadata> {
  const [{ id }, t] = await Promise.all([params, getT()]);
  const person = await getPublicUser(id);
  if (!person || !hasRole(person, "renter")) return { title: t("meta.renterProfile.notFound"), robots: NOINDEX };
  return {
    title: t("meta.renterProfile.title", { name: person.name }),
    description: t("meta.renterProfile.description", { name: person.name }),
    robots: NOINDEX,
  };
}

export default async function RenterPage({ params, searchParams }: PageProps<"/renters/[id]">) {
  const [{ id }, { page, saved }] = await Promise.all([params, searchParams]);
  return <PersonProfile id={id} role="renter" page={parsePage(page)} saved={saved === "1"} />;
}
