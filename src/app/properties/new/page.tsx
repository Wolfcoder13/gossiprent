import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth/current-user";
import { HOME_POSTCODES } from "@/lib/postcodes";
import { PropertyForm } from "./property-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("meta.pages.newProperty") };
}

export default async function NewPropertyPage({ searchParams }: PageProps<"/properties/new">) {
  const user = await requireUser("/properties/new");
  const [{ as }, t] = await Promise.all([searchParams, getT()]);
  const intro =
    user.isLandlord && user.isRenter
      ? t("properties.new.intro.both")
      : user.isLandlord
        ? t("properties.new.intro.landlord")
        : t("properties.new.intro.renter");

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-ink">{t("properties.new.title")}</h1>
      <p className="mt-2 text-muted">{intro}</p>
      <div className="mt-8 rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <PropertyForm
          isLandlord={user.isLandlord}
          isRenter={user.isRenter}
          postcodes={HOME_POSTCODES}
          defaultRelation={as === "landlord" ? "own" : as === "renter" ? "rent" : undefined}
        />
      </div>
    </div>
  );
}
