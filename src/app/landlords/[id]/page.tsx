import type { Metadata } from "next";
import { PersonProfile } from "@/components/person-profile";
import { getT } from "@/i18n/server";
import { getPublicUser, parsePage } from "@/lib/data";
import { hasRole } from "@/lib/roles";

const NOINDEX = { index: false, follow: false } as const;

export async function generateMetadata({ params }: PageProps<"/landlords/[id]">): Promise<Metadata> {
  const [{ id }, t] = await Promise.all([params, getT()]);
  const person = await getPublicUser(id);
  if (!person || !hasRole(person, "landlord")) return { title: t("meta.landlordProfile.notFound"), robots: NOINDEX };
  return {
    title: t("meta.landlordProfile.title", { name: person.name }),
    description: t("meta.landlordProfile.description", { name: person.name }),
    // A person who hasn't signed up didn't choose to be on GossipRent: keep their page out of search engines.
    ...(person.hasAccount || person.isCompany ? {} : { robots: NOINDEX }),
  };
}

export default async function LandlordPage({ params, searchParams }: PageProps<"/landlords/[id]">) {
  const [{ id }, { page, saved }] = await Promise.all([params, searchParams]);
  return <PersonProfile id={id} role="landlord" page={parsePage(page)} saved={saved === "1"} />;
}
