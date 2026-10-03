import type { Metadata } from "next";
import { PersonProfile } from "@/components/person-profile";
import { getPublicUser, parsePage } from "@/lib/data";
import { hasRole } from "@/lib/roles";

export async function generateMetadata({ params }: PageProps<"/renters/[id]">): Promise<Metadata> {
  const person = await getPublicUser((await params).id);
  return person && hasRole(person, "renter")
    ? { title: `${person.name} — renter reviews`, description: `Reviews of ${person.name}, a renter on GossipRent.` }
    : { title: "Renter not found" };
}

export default async function RenterPage({ params, searchParams }: PageProps<"/renters/[id]">) {
  const [{ id }, { page }] = await Promise.all([params, searchParams]);
  return <PersonProfile id={id} role="renter" page={parsePage(page)} />;
}
