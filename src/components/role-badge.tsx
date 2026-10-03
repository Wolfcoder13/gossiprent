"use client";

import type { UserRole } from "@/db/schema";
import { useT } from "@/i18n/client";

// Client components (translated with useT), so they work in server and client
// trees alike. Import them from "./ui" or from here.

const BADGE = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold";

const ROLE_STYLES: Record<UserRole | "property", string> = {
  landlord: "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200",
  renter: "bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200",
  property: "bg-sky-100 text-sky-900 dark:bg-sky-400/15 dark:text-sky-200",
};

const ROLE_LABELS = {
  landlord: "common.roles.landlord",
  renter: "common.roles.renter",
  property: "common.roles.property",
} as const;

/** "Landlord" / "Leigusali", "Renter" / "Leigjandi", "Property" / "Eign". */
export function RoleBadge({ role }: { role: UserRole | "property" }) {
  const t = useT();
  return <span className={`${BADGE} ${ROLE_STYLES[role]}`}>{t(ROLE_LABELS[role])}</span>;
}

/** "No account" / "Án aðgangs": a profile created by a review, not by its person signing up. */
export function NoAccountBadge() {
  const t = useT();
  return <span className={`${BADGE} bg-surface-muted text-muted`}>{t("common.noAccount")}</span>;
}
