import type { Metadata } from "next";
import { PersonProfile } from "@/components/person-profile";
import { getPublicUser, parsePage } from "@/lib/data";

export async function generateMetadata({ params }: PageProps<"/landlords/[id]">): Promise<Metadata> {
  const person = await getPublicUser((await params).id, "landlord");
  return person
    ? { title: `${person.name} — landlord reviews`, description: `Reviews of ${person.name}, a landlord on GossipRent.` }
    : { title: "Landlord not found" };
}

export default async function LandlordPage({ params, searchParams }: PageProps<"/landlords/[id]">) {
  const [{ id }, { page }] = await Promise.all([params, searchParams]);
  return <PersonProfile id={id} role="landlord" page={parsePage(page)} />;
}
