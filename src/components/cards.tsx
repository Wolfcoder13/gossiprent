"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { UserRole } from "@/db/schema";
import { useT } from "@/i18n/client";
import type { PersonListItem, PropertyListItem } from "@/lib/data";
import { subjectPath } from "@/lib/paths";
import { PropertyAddress } from "./property-address";
import { NoAccountBadge, RoleBadge } from "./role-badge";
import { RatingInline } from "./stars";
import { Avatar } from "./ui";

// Client components (translated with useT), so they work in server and client
// trees alike. Every value they get is public (no kennitala, email…).

const cardClass =
  "group flex h-full flex-col rounded-2xl border border-line bg-surface p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md";

// Message keys.
const ALSO_OTHER_ROLE = { landlord: "browse.card.alsoRenter", renter: "browse.card.alsoLandlord" } as const;

/**
 * A person in one of their roles: the card shows their rating *as* that role.
 * Profiles without an account are badged "No account". Under the name: the
 * city (accounts only) and, for a landlord, how many properties they're linked to.
 */
export function PersonCard({ person, role }: { person: PersonListItem; role: UserRole }) {
  const t = useT();
  const alsoOther = role === "landlord" ? person.isRenter : person.isLandlord;
  const subtitle = [
    person.city,
    role === "landlord"
      ? person.propertyCount > 0
        ? t("browse.card.properties", { count: person.propertyCount })
        : person.city
          ? null
          : t("browse.card.noProperties")
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link href={subjectPath(role, person.id)} className={cardClass}>
      <div className="flex items-center gap-3">
        <Avatar name={person.name} id={person.id} />
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink group-hover:underline">{person.name}</p>
          {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      <div className="mt-4">
        <RatingInline average={person.average} count={person.reviewCount} />
      </div>
      {person.bio && <p className="mt-3 line-clamp-2 text-sm text-ink/80">{person.bio}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-4">
        <RoleBadge role={role} />
        {!person.hasAccount && <NoAccountBadge />}
        {alsoOther && <span className="text-xs text-muted">· {t(ALSO_OTHER_ROLE[role])}</span>}
      </div>
    </Link>
  );
}

/** A property: its address ("Njálsgata 23, íbúð 0201" over "101 Reykjavík"), rating and landlord. */
export function PropertyCard({ property }: { property: PropertyListItem }) {
  const t = useT();
  const { landlord } = property;
  return (
    <Link href={subjectPath("property", property.id)} className={cardClass}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200"
        >
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M3 10.5 12 3l9 7.5M5 9v11h14V9" strokeLinejoin="round" strokeLinecap="round" />
            <path d="M10 20v-6h4v6" strokeLinejoin="round" />
          </svg>
        </span>
        <p className="min-w-0 flex-1 font-semibold text-ink group-hover:underline">
          <PropertyAddress address={property.address} unit={property.unit} postalCode={property.postalCode} />
        </p>
      </div>
      <div className="mt-4">
        <RatingInline average={property.average} count={property.reviewCount} />
      </div>
      {property.description && (
        <p className="mt-3 line-clamp-2 text-sm text-ink/80">{property.description}</p>
      )}
      <p className="mt-auto pt-4 text-xs wrap-anywhere text-muted">
        {landlord
          ? t(landlord.hasAccount ? "browse.card.landlord" : "browse.card.landlordUnconfirmed", { name: landlord.name })
          : t("browse.card.noLandlord")}
      </p>
    </Link>
  );
}

export function CardGrid({ children }: { children: ReactNode }) {
  return <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</ul>;
}
