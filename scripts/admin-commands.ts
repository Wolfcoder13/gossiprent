// The operator commands behind `npm run admin` (scripts/admin.ts; see
// docs/iceland-spec.md §10), kept apart from the script's start-up code so
// tests can run them against a test database.
//
// Never prints a kennitala: people are shown by id and name. Everything people
// typed (report details, names, emails) goes through forTerminal first.
import { asc, count, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../src/db/connect";
import { properties, reports, reviews, users } from "../src/db/schema";
import { containsKennitala, isAdultKennitala, parseKennitalaInput } from "../src/lib/kennitala";
import { KENNITALA_LIKE_SOURCE } from "../src/lib/kennitala-pattern";
import {
  detachAccount,
  ensurePerson,
  grantRoleByKennitala,
  hasReviewedProperty,
  isDisclaimedLandlord,
  reconcileProfiles,
  reconcileSkipped,
} from "../src/lib/people";
import { personNameKeys } from "../src/lib/text";

export const USAGE = `Usage: npm run admin -- <command>

  reports                                      List unresolved reports
  resolve <reportId> <note>                    Mark a report as resolved
  remove-review <reviewId>                     Delete a review
  reset-account <userId>                       Remove the account (email, password, city, bio,
                                               sessions) but keep the profile and reviews about
                                               them; a profile nothing refers to is removed
  rename-profile <userId> <name>               Correct a person's name
  relink-property <propertyId> <kennitala|none> [name]
                                               Change or clear a property's landlord (a name is
                                               needed when nobody has that kennitala yet)`;

/** A wrong command or missing argument: shown with the usage text. */
export class UsageError extends Error {}
/** Input the command can't act on (unknown id, invalid name…): shown on its own. */
export class InputError extends Error {}

/** Where a command prints its lines (console.log, or a test's collector). */
export type Output = (line: string) => void;

// The app's one kennitala-like pattern (src/lib/kennitala-pattern.ts).
const KENNITALA_LIKE = new RegExp(KENNITALA_LIKE_SOURCE, "g");

/** Free text from the public may contain anyone's kennitala; don't echo it to the terminal. */
export function maskKennitalas(text: string): string {
  return text.replace(KENNITALA_LIKE, "[kennitala]");
}

// Control characters (except the newline), and characters that reorder, hide
// or break lines on a terminal: bidi controls, zero-width characters, line and
// paragraph separators.
const UNSAFE_FOR_TERMINAL =
  /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;

/**
 * Text someone else typed, made safe to print: an escape sequence in a report
 * could otherwise clear the screen, hide or overwrite lines, or (OSC 52) put a
 * command on the operator's clipboard. Line breaks become "\n"; any other
 * control character is shown as its code, e.g. \u{1b}.
 */
export function forTerminal(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(UNSAFE_FOR_TERMINAL, (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`);
}

/** Someone else's free text for printing: kennitalas masked, made safe, continuation lines indented. */
function quoted(text: string, indent: string): string {
  return forTerminal(maskKennitalas(text)).replace(/\n/g, `\n${indent}`);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidArg(value: string | undefined, label: string): string {
  if (!value || !UUID_RE.test(value)) throw new UsageError(`Give the ${label} (a UUID).`);
  return value;
}

async function listReports(db: Database, out: Output): Promise<void> {
  const rows = await db
    .select()
    .from(reports)
    .where(isNull(reports.resolvedAt))
    .orderBy(asc(reports.createdAt));
  if (rows.length === 0) {
    out("No unresolved reports.");
    return;
  }
  for (const report of rows) {
    out(
      [
        `Report ${report.id} (${report.createdAt.toISOString()})`,
        `  About:   ${report.targetKind}${report.targetId ? ` ${report.targetId}` : ""}`,
        `  Reason:  ${report.reason}`,
        `  From:    ${report.reporterId ? `user ${report.reporterId}` : "logged out"}${
          report.contactEmail ? ` <${quoted(report.contactEmail, "")}>` : ""
        }`,
        `  Details: ${quoted(report.details, "           ")}`,
        "",
      ].join("\n"),
    );
  }
  out(`${rows.length} unresolved.`);
}

async function resolveReport(db: Database, reportId: string, note: string, out: Output): Promise<void> {
  if (!note.trim()) throw new InputError("Say how the report was resolved.");
  const updated = await db
    .update(reports)
    .set({ resolvedAt: new Date(), resolution: note.trim() })
    .where(eq(reports.id, reportId))
    .returning({ id: reports.id });
  if (updated.length === 0) throw new InputError("No report with that id.");
  out("Resolved.");
}

async function removeReview(db: Database, reviewId: string, out: Output): Promise<void> {
  const skipped = await db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(reviews)
      .where(eq(reviews.id, reviewId))
      .returning({ subjectUserId: reviews.subjectUserId });
    if (!removed) throw new InputError("No review with that id.");
    // A profile without an account that only existed for this review goes too.
    return reconcileProfiles(tx, [removed.subjectUserId]);
  });
  await reconcileSkipped(skipped, db);
  out("Review removed.");
}

async function resetAccount(db: Database, userId: string, out: Output): Promise<void> {
  const result = await db.transaction(async (tx) => {
    const [person] = await tx
      .select({ name: users.name, hasAccount: sql<boolean>`${users.passwordHash} is not null` })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!person) throw new InputError("No person with that id.");
    if (!person.hasAccount) throw new InputError("That person has no account.");
    const [{ written }] = await tx.select({ written: count() }).from(reviews).where(eq(reviews.authorId, userId));
    // Never deletes reviews, theirs or about them.
    const outcome = await detachAccount(tx, userId);
    return { name: person.name, written, outcome };
  });
  const name = forTerminal(result.name);
  if (result.outcome === "deleted") {
    out(`${name} no longer has an account. Nothing referred to them, so the profile was removed too.`);
    return;
  }
  out(`${name} no longer has an account; the profile and reviews about them stay.`);
  if (result.written > 0) {
    out(`They wrote ${result.written} review(s), which stay up. Remove any with remove-review <reviewId>.`);
  }
}

/** A name as the app would store it, or an input error. */
function profileName(raw: string): string {
  const { name } = personNameKeys(raw);
  if (name.length < 2 || name.length > 80) throw new InputError("A name is 2–80 characters.");
  if (containsKennitala(name)) throw new InputError("A name can't contain a kennitala.");
  return name;
}

async function renameProfile(db: Database, userId: string, rawName: string, out: Output): Promise<void> {
  const keys = personNameKeys(profileName(rawName));
  const updated = await db.update(users).set(keys).where(eq(users.id, userId)).returning({ id: users.id });
  if (updated.length === 0) throw new InputError("No person with that id.");
  out(`New name: ${forTerminal(keys.name)}`);
}

async function relinkProperty(
  db: Database,
  propertyId: string,
  kennitalaArg: string,
  nameArg: string | undefined,
  out: Output,
): Promise<void> {
  const clear = kennitalaArg === "none";
  const kennitala = clear ? null : parseKennitalaInput(kennitalaArg);
  if (!clear && !kennitala) throw new InputError("That isn't a valid kennitala (or use none).");
  if (kennitala && !isAdultKennitala(kennitala)) throw new InputError("That kennitala belongs to someone under 18.");

  const { landlord, skipped } = await db.transaction(async (tx) => {
    // The property first, then the person (the app's lock order). Writing a
    // review of the property takes a share lock on it, so none can arrive
    // between the checks below and the change.
    const [property] = await tx
      .select({ landlordId: properties.landlordId, landlordConfirmed: properties.landlordConfirmed })
      .from(properties)
      .where(eq(properties.id, propertyId))
      .for("update");
    if (!property) throw new InputError("No property with that id.");

    let landlord: { id: string; name: string } | null = null;
    if (kennitala) {
      // The same rules as the app's relink: a landlord can't have reviewed their
      // own property, and someone who said it isn't theirs can only claim it.
      if (await hasReviewedProperty(tx, kennitala.value, propertyId)) {
        throw new InputError("That person has reviewed this property, so they can't be its landlord.");
      }
      if (await isDisclaimedLandlord(tx, kennitala.value, propertyId)) {
        throw new InputError(
          "That person has said this isn't their property. Only they can link it again (I manage this property).",
        );
      }
      landlord = await grantRoleByKennitala(tx, kennitala.value, "landlord");
      if (!landlord) {
        if (!nameArg) throw new InputError("Nobody has that kennitala yet: give their name too.");
        const name = profileName(nameArg);
        const { id } = await ensurePerson(tx, {
          kennitala: kennitala.value,
          name,
          isCompany: kennitala.type === "company",
          role: "landlord",
        });
        landlord = { id, name };
      }
    }

    const unchanged = landlord !== null && landlord.id === property.landlordId;
    await tx
      .update(properties)
      .set({
        landlordId: landlord?.id ?? null,
        // The landlord didn't confirm a link the operator made (unless it's the one they had).
        landlordConfirmed: unchanged ? property.landlordConfirmed : false,
      })
      .where(eq(properties.id, propertyId));
    const skipped =
      property.landlordId && !unchanged ? await reconcileProfiles(tx, [property.landlordId]) : [];
    return { landlord, skipped };
  });
  await reconcileSkipped(skipped, db);
  out(landlord ? `Landlord is now ${forTerminal(landlord.name)} (${landlord.id}).` : "Landlord cleared.");
}

/** A command ready to run against a database. */
export type Command = (db: Database, out?: Output) => Promise<void>;

/**
 * Check a command line (`args` as typed after `npm run admin --`) without
 * touching the database: a UsageError for an unknown command or a missing or
 * malformed argument, otherwise the command to run.
 */
export function parseCommand([command, ...args]: string[]): Command {
  switch (command) {
    case "reports":
      return (db, out = console.log) => listReports(db, out);
    case "resolve": {
      const reportId = uuidArg(args[0], "report id");
      return (db, out = console.log) => resolveReport(db, reportId, args.slice(1).join(" "), out);
    }
    case "remove-review": {
      const reviewId = uuidArg(args[0], "review id");
      return (db, out = console.log) => removeReview(db, reviewId, out);
    }
    case "reset-account": {
      const userId = uuidArg(args[0], "user id");
      return (db, out = console.log) => resetAccount(db, userId, out);
    }
    case "rename-profile": {
      const userId = uuidArg(args[0], "user id");
      return (db, out = console.log) => renameProfile(db, userId, args.slice(1).join(" "), out);
    }
    case "relink-property": {
      const propertyId = uuidArg(args[0], "property id");
      if (!args[1]) throw new UsageError("Give the landlord's kennitala, or none.");
      const [kennitala, ...name] = args.slice(1);
      return (db, out = console.log) => relinkProperty(db, propertyId, kennitala, name.join(" ") || undefined, out);
    }
    default:
      throw new UsageError(command ? `Unknown command: ${command}` : "No command given.");
  }
}

/** Check and run one command line (see parseCommand). */
export async function run(db: Database, args: string[], out: Output = console.log): Promise<void> {
  await parseCommand(args)(db, out);
}
