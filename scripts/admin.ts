// Operator tools for handling reports and fixing profiles (see docs/iceland-spec.md §10).
//
//   npm run admin -- <command>      (run `npm run admin` for the list of commands)
//
// Uses DATABASE_URL when set, otherwise the built-in local database (stop
// `npm run dev` first). Never prints a kennitala: people are shown by id and name.
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { asc, count, eq, isNull } from "drizzle-orm";
import { closeDatabase, connect, type Database } from "../src/db/connect";
import { properties, reports, reviews, sessions, users } from "../src/db/schema";
import { containsKennitala, isAdultKennitala, parseKennitalaInput } from "../src/lib/kennitala";
import { personNameKeys } from "../src/lib/text";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // File doesn't exist — that's fine.
  }
}

// src/lib/people.ts is marked `server-only`, which Next resolves to an empty
// module on the server. This script is server code too, so resolve it the same way.
if (typeof registerHooks !== "function") {
  console.error("[admin] Needs Node.js 22.15 or later.");
  process.exit(1);
}
const requireFromRoot = createRequire(path.join(process.cwd(), "package.json"));
const SERVER_ONLY = pathToFileURL(requireFromRoot.resolve("next/dist/compiled/server-only/empty.js")).href;
registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier === "server-only" ? { url: SERVER_ONLY, shortCircuit: true } : nextResolve(specifier, context),
});

const USAGE = `Usage: npm run admin -- <command>

  reports                                      List unresolved reports
  resolve <reportId> <note>                    Mark a report as resolved
  remove-review <reviewId>                     Delete a review
  reset-account <userId>                       Remove the account (email, password, city, bio,
                                               sessions) but keep the profile and its reviews
  rename-profile <userId> <name>               Correct a person's name
  relink-property <propertyId> <kennitala|none> [name]
                                               Change or clear a property's landlord (a name is
                                               needed when nobody has that kennitala yet)`;

/** A wrong command or missing argument: shown with the usage text. */
class UsageError extends Error {}
/** Input the command can't act on (unknown id, invalid name…): shown on its own. */
class InputError extends Error {}

/** Free text from the public may contain anyone's kennitala; don't echo it to the terminal. */
function maskKennitalas(text: string): string {
  return text.replace(/\d{6}[-\s]?\d{4}/g, "[kennitala]");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidArg(value: string | undefined, label: string): string {
  if (!value || !UUID_RE.test(value)) throw new UsageError(`Give the ${label} (a UUID).`);
  return value;
}

async function listReports(db: Database): Promise<void> {
  const rows = await db
    .select()
    .from(reports)
    .where(isNull(reports.resolvedAt))
    .orderBy(asc(reports.createdAt));
  if (rows.length === 0) {
    console.log("No unresolved reports.");
    return;
  }
  for (const report of rows) {
    console.log(
      [
        `Report ${report.id} (${report.createdAt.toISOString()})`,
        `  About:   ${report.targetKind}${report.targetId ? ` ${report.targetId}` : ""}`,
        `  Reason:  ${report.reason}`,
        `  From:    ${report.reporterId ? `user ${report.reporterId}` : "logged out"}${
          report.contactEmail ? ` <${report.contactEmail}>` : ""
        }`,
        `  Details: ${maskKennitalas(report.details).replace(/\n/g, "\n           ")}`,
        "",
      ].join("\n"),
    );
  }
  console.log(`${rows.length} unresolved.`);
}

async function resolveReport(db: Database, reportId: string, note: string): Promise<void> {
  if (!note.trim()) throw new InputError("Say how the report was resolved.");
  const updated = await db
    .update(reports)
    .set({ resolvedAt: new Date(), resolution: note.trim() })
    .where(eq(reports.id, reportId))
    .returning({ id: reports.id });
  if (updated.length === 0) throw new InputError("No report with that id.");
  console.log("Resolved.");
}

async function removeReview(db: Database, reviewId: string): Promise<void> {
  const { reconcileProfiles } = await import("../src/lib/people");
  await db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(reviews)
      .where(eq(reviews.id, reviewId))
      .returning({ subjectUserId: reviews.subjectUserId });
    if (!removed) throw new InputError("No review with that id.");
    // A profile without an account that only existed for this review goes too.
    await reconcileProfiles(tx, [removed.subjectUserId]);
  });
  console.log("Review removed.");
}

async function resetAccount(db: Database, userId: string): Promise<void> {
  const written = await db.transaction(async (tx) => {
    const [user] = await tx
      .update(users)
      .set({ email: null, passwordHash: null, joinedAt: null, city: null, bio: null })
      .where(eq(users.id, userId))
      .returning({ name: users.name });
    if (!user) throw new InputError("No person with that id.");
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    const [{ n }] = await tx.select({ n: count() }).from(reviews).where(eq(reviews.authorId, userId));
    console.log(`${user.name} no longer has an account; the profile and reviews about them stay.`);
    return n;
  });
  if (written > 0) {
    console.log(`They wrote ${written} review(s), which stay up. Remove any with remove-review <reviewId>.`);
  }
}

/** A name as the app would store it, or a usage error. */
function profileName(raw: string): string {
  const { name } = personNameKeys(raw);
  if (name.length < 2 || name.length > 80) throw new InputError("A name is 2–80 characters.");
  if (containsKennitala(name)) throw new InputError("A name can't contain a kennitala.");
  return name;
}

async function renameProfile(db: Database, userId: string, rawName: string): Promise<void> {
  const keys = personNameKeys(profileName(rawName));
  const updated = await db.update(users).set(keys).where(eq(users.id, userId)).returning({ id: users.id });
  if (updated.length === 0) throw new InputError("No person with that id.");
  console.log(`New name: ${keys.name}`);
}

async function relinkProperty(
  db: Database,
  propertyId: string,
  kennitalaArg: string,
  nameArg: string | undefined,
): Promise<void> {
  const { ensurePerson, grantRoleByKennitala, reconcileProfiles } = await import("../src/lib/people");
  const clear = kennitalaArg === "none";
  const kennitala = clear ? null : parseKennitalaInput(kennitalaArg);
  if (!clear && !kennitala) throw new InputError("That isn't a valid kennitala (or use none).");
  if (kennitala && !isAdultKennitala(kennitala)) throw new InputError("That kennitala belongs to someone under 18.");

  await db.transaction(async (tx) => {
    const [property] = await tx
      .select({ landlordId: properties.landlordId })
      .from(properties)
      .where(eq(properties.id, propertyId))
      .for("update");
    if (!property) throw new InputError("No property with that id.");

    let landlord: { id: string; name: string } | null = null;
    if (kennitala) {
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

    await tx
      .update(properties)
      .set({ landlordId: landlord?.id ?? null })
      .where(eq(properties.id, propertyId));
    if (property.landlordId && property.landlordId !== landlord?.id) {
      await reconcileProfiles(tx, [property.landlordId]);
    }
    console.log(landlord ? `Landlord is now ${landlord.name} (${landlord.id}).` : "Landlord cleared.");
  });
}

async function run(db: Database, [command, ...args]: string[]): Promise<void> {
  switch (command) {
    case "reports":
      return listReports(db);
    case "resolve":
      return resolveReport(db, uuidArg(args[0], "report id"), args.slice(1).join(" "));
    case "remove-review":
      return removeReview(db, uuidArg(args[0], "review id"));
    case "reset-account":
      return resetAccount(db, uuidArg(args[0], "user id"));
    case "rename-profile":
      return renameProfile(db, uuidArg(args[0], "user id"), args.slice(1).join(" "));
    case "relink-property":
      if (!args[1]) throw new UsageError("Give the landlord's kennitala, or none.");
      return relinkProperty(db, uuidArg(args[0], "property id"), args[1], args.slice(2).join(" ") || undefined);
    default:
      throw new UsageError(command ? `Unknown command: ${command}` : "No command given.");
  }
}

async function main() {
  // Never seed demo data into a database this script opens.
  process.env.SEED_DEMO_DATA = "false";
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "help" || args[0] === "--help") {
    console.log(USAGE);
    return;
  }
  const db = await connect();
  try {
    await run(db, args);
  } finally {
    await closeDatabase(db);
  }
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) {
    console.error(`${error.message}\n\n${USAGE}`);
  } else if (error instanceof InputError) {
    console.error(error.message);
  } else {
    // Database errors quote the query's parameters; mask anything kennitala-shaped.
    console.error(`[admin] Failed: ${maskKennitalas(error instanceof Error ? error.message : String(error))}`);
  }
  process.exitCode = 1;
});
