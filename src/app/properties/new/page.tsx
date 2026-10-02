import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/current-user";
import { listLandlordOptions } from "@/lib/data";
import { PropertyForm } from "./property-form";

export const metadata: Metadata = { title: "Add a property" };

export default async function NewPropertyPage({ searchParams }: PageProps<"/properties/new">) {
  const user = await requireUser("/properties/new");
  const { as } = await searchParams;
  // Renters can link their landlord. Someone who is only a landlord always
  // lists the property as their own, so they don't need the list.
  const landlords = user.isRenter
    ? (await listLandlordOptions()).filter((landlord) => landlord.id !== user.id)
    : [];

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-ink">Add a property</h1>
      <p className="mt-2 text-muted">
        {user.isLandlord && user.isRenter
          ? "List a home you own or manage, or add the place you rent so you can review it. Please check it isn't already listed first."
          : user.isLandlord
            ? "List a home or apartment you own or manage. It will appear on your landlord profile so your renters can review it."
            : "Add the place you rent (or used to rent) so you can review it. Please check it isn't already listed first."}
      </p>
      <div className="mt-8 rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <PropertyForm
          isLandlord={user.isLandlord}
          isRenter={user.isRenter}
          landlords={landlords}
          defaultRelation={as === "landlord" ? "own" : as === "renter" ? "rent" : undefined}
        />
      </div>
    </div>
  );
}
