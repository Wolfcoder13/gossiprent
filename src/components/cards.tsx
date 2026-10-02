import Link from "next/link";
import type { ReactNode } from "react";
import type { PersonListItem, PropertyListItem } from "@/lib/data";
import { propertyLabel } from "@/lib/data";
import { plural } from "@/lib/format";
import { subjectPath } from "@/lib/paths";
import { RatingInline } from "./stars";
import { Avatar, RoleBadge } from "./ui";

const cardClass =
  "group flex h-full flex-col rounded-2xl border border-line bg-surface p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md";

export function PersonCard({ person }: { person: PersonListItem }) {
  return (
    <Link href={subjectPath(person.role, person.id)} className={cardClass}>
      <div className="flex items-center gap-3">
        <Avatar name={person.name} id={person.id} />
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink group-hover:underline">{person.name}</p>
          <p className="truncate text-sm text-muted">{person.city ?? "Location not listed"}</p>
        </div>
      </div>
      <div className="mt-4">
        <RatingInline average={person.average} count={person.reviewCount} />
      </div>
      {person.bio && <p className="mt-3 line-clamp-2 text-sm text-ink/80">{person.bio}</p>}
      <div className="mt-auto flex items-center gap-2 pt-4">
        <RoleBadge role={person.role} />
        {person.deletedAt && <span className="text-xs text-muted">Account closed</span>}
        {person.role === "landlord" && person.propertyCount > 0 && (
          <span className="text-xs text-muted">{plural(person.propertyCount, "property", "properties")}</span>
        )}
      </div>
    </Link>
  );
}

export function PropertyCard({ property }: { property: PropertyListItem }) {
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
        <div className="min-w-0 flex-1">
          <p className="font-semibold wrap-anywhere text-ink group-hover:underline">
            {propertyLabel(property)}
          </p>
          <p className="text-sm wrap-anywhere text-muted">
            {property.city}, {property.region}
            {property.postalCode ? ` ${property.postalCode}` : ""}
          </p>
        </div>
      </div>
      <div className="mt-4">
        <RatingInline average={property.average} count={property.reviewCount} />
      </div>
      {property.description && (
        <p className="mt-3 line-clamp-2 text-sm text-ink/80">{property.description}</p>
      )}
      <p className="mt-auto pt-4 text-xs wrap-anywhere text-muted">
        {property.landlord ? <>Landlord: {property.landlord.name}</> : "Landlord not on GossipRent yet"}
      </p>
    </Link>
  );
}

export function CardGrid({ children }: { children: ReactNode }) {
  return <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</ul>;
}
