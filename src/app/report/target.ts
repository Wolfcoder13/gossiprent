import "server-only";
import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import { properties, reviews, users, type ReportReason, type ReportTarget, type UserRole } from "@/db/schema";
import type { AddressParts } from "@/i18n/address";
import { isUuid } from "@/lib/data";
import { profilePath, subjectPath } from "@/lib/paths";
import { REPORT_TARGETS } from "@/lib/validation";

/** What a report is about, as the report page shows it. Only public facts (no kennitala). */
export type ReportSubject =
  | { target: "account"; id: null; href: null }
  | {
      target: "review";
      id: string;
      title: string;
      /** Who or what the review is about. */
      about: { kind: UserRole; name: string } | ({ kind: "property" } & AddressParts);
      href: string;
    }
  | { target: "profile"; id: string; name: string; href: string }
  | ({ target: "property"; id: string; href: string } & AddressParts);

/** The reasons offered for each kind of report, most likely first. (The action accepts any reason.) */
export const REASONS_FOR: Record<ReportTarget, readonly ReportReason[]> = {
  review: ["false_or_abusive", "personal_data", "wrong_person", "other"],
  profile: ["wrong_name", "wrong_person", "identity_claimed", "personal_data", "other"],
  property: ["wrong_person", "personal_data", "false_or_abusive", "other"],
  account: ["identity_claimed", "other"],
};

const subjectUser = alias(users, "subject_user");

/**
 * The thing a /report link points to, or null if the link is broken: an
 * unknown target, a missing or malformed id, or a review, profile or property
 * that doesn't exist (any more). Takes raw search params or form values.
 */
export async function findReportTarget(target: unknown, id: unknown): Promise<ReportSubject | null> {
  const kind = REPORT_TARGETS.find((t) => t === target);
  if (!kind) return null;
  if (kind === "account") return { target: "account", id: null, href: null };
  if (typeof id !== "string" || !isUuid(id)) return null;

  const db = await getDb();
  switch (kind) {
    case "review": {
      const [row] = await db
        .select({
          title: reviews.title,
          kind: reviews.kind,
          subjectId: subjectUser.id,
          subjectName: subjectUser.name,
          propertyId: properties.id,
          address: properties.address,
          unit: properties.unit,
          postalCode: properties.postalCode,
        })
        .from(reviews)
        .leftJoin(subjectUser, eq(subjectUser.id, reviews.subjectUserId))
        .leftJoin(properties, eq(properties.id, reviews.propertyId))
        .where(eq(reviews.id, id))
        .limit(1);
      if (!row) return null;
      if (row.kind === "property") {
        if (!row.propertyId || row.address === null || row.postalCode === null) return null;
        return {
          target: "review",
          id,
          title: row.title,
          about: { kind: "property", address: row.address, unit: row.unit, postalCode: row.postalCode },
          href: subjectPath("property", row.propertyId),
        };
      }
      if (!row.subjectId || row.subjectName === null) return null;
      return {
        target: "review",
        id,
        title: row.title,
        about: { kind: row.kind, name: row.subjectName },
        href: subjectPath(row.kind, row.subjectId),
      };
    }
    case "profile": {
      const [row] = await db
        .select({ name: users.name, isLandlord: users.isLandlord, isRenter: users.isRenter })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      return row ? { target: "profile", id, name: row.name, href: profilePath({ id, ...row }) } : null;
    }
    case "property": {
      const [row] = await db
        .select({ address: properties.address, unit: properties.unit, postalCode: properties.postalCode })
        .from(properties)
        .where(eq(properties.id, id))
        .limit(1);
      return row ? { target: "property", id, ...row, href: subjectPath("property", id) } : null;
    }
  }
}
